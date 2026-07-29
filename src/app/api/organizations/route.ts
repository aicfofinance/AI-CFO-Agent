import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z, ZodError } from "zod";

import { createServerClient } from "@/lib/platform/auth/supabase";
import { db } from "@/lib/platform/db/client";
import {
  consentLog,
  organizationMembers,
  organizations,
  subscriptions,
} from "@/lib/platform/db/schema";

/**
 * POST /api/organizations — create the caller's organization.
 *
 * This is the one authenticated endpoint that CANNOT use
 * `getRequestContext()`: the caller has a Supabase session but no org yet, and
 * `getRequestContext()` would throw 403 NO_ORG_MEMBERSHIP. Instead it reads the
 * user directly from the Supabase server client and derives the org from the
 * validated request body.
 *
 * On success it inserts, in a single transaction so the four rows commit or roll
 * back together (CLAUDE.md — atomic org creation):
 *   - `organizations`
 *   - `organization_members` (role: owner)
 *   - `consent_log` (the "not financial advice" acknowledgement)
 *   - `subscriptions` (trial tier, 20-query quota, 30-day period)
 *
 * Returns 201 with the org, 401 with no session, 400 on validation failure, and
 * 409 if the user already belongs to an organization.
 *
 * Requires session. Returns 401 if unauthenticated.
 */

const TRIAL_QUERY_LIMIT = 20;
const TRIAL_PERIOD_DAYS = 30;
const PRODUCT_VERSION = "v1";
const CONSENT_TYPE = "not_financial_advice";
const CONSENT_TEXT =
  "This product reads my QuickBooks or Xero data. It never modifies my books. It provides AI-generated analysis, not financial advice.";

/**
 * Request body. `consentGiven` is `z.literal(true)` — it must be exactly `true`,
 * not merely truthy, so an omitted or `false` consent fails validation with a
 * 400 rather than silently recording a non-consent.
 */
const CreateOrganizationSchema = z.object({
  name: z.string().min(1).max(100),
  industry: z.string().min(1).max(50),
  revenueBand: z.string().min(1).max(20),
  consentGiven: z.literal(true),
});

/**
 * Derives a URL-safe slug from the org name and appends a short random suffix.
 * The suffix guarantees uniqueness against the `idx_organizations_slug` unique
 * index — two orgs named "Acme, Inc." must not collide on insert.
 */
function buildSlug(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  const suffix = crypto.randomUUID().slice(0, 8);
  return base ? `${base}-${suffix}` : suffix;
}

/**
 * Extracts a single client IP for the `consent_log.ip_address` INET column.
 * `x-forwarded-for` may be a comma-separated chain (`client, proxy1, ...`); the
 * first entry is the originating client. Falls back to loopback when absent.
 */
function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first && first.length > 0 ? first : "127.0.0.1";
}

export async function POST(request: Request): Promise<NextResponse> {
  const request_id = crypto.randomUUID();

  try {
    // Org-creation cannot use getRequestContext() (no org exists yet), so the
    // user is read straight from the session-bound Supabase server client.
    const supabase = await createServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Authentication required.", request_id } },
        { status: 401 },
      );
    }

    const body: unknown = await request.json();
    const { name, industry, revenueBand } = CreateOrganizationSchema.parse(body);

    // One org per user in V1: a second attempt is a 409, not a duplicate insert.
    const [existing] = await db
      .select({ orgId: organizationMembers.orgId })
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, user.id))
      .limit(1);

    if (existing) {
      return NextResponse.json(
        {
          error: {
            code: "ORGANIZATION_EXISTS",
            message: "This user already belongs to an organization.",
            request_id,
          },
        },
        { status: 409 },
      );
    }

    const now = new Date();
    const periodEnd = new Date(now.getTime() + TRIAL_PERIOD_DAYS * 24 * 60 * 60 * 1000);

    const created = await db.transaction(async (tx) => {
      const [org] = await tx
        .insert(organizations)
        .values({
          name,
          slug: buildSlug(name),
          industry,
          annualRevenueBand: revenueBand,
          planTier: "trial",
        })
        .returning({
          id: organizations.id,
          name: organizations.name,
          slug: organizations.slug,
          industry: organizations.industry,
          annualRevenueBand: organizations.annualRevenueBand,
        });

      if (!org) {
        // Defence in depth: a failed insert must abort the transaction rather
        // than proceed to create members/consent/subscription rows for a
        // non-existent org.
        throw new Error("Organization insert returned no row.");
      }

      await tx.insert(organizationMembers).values({
        orgId: org.id,
        userId: user.id,
        role: "owner",
        acceptedAt: now,
      });

      await tx.insert(consentLog).values({
        orgId: org.id,
        userId: user.id,
        consentType: CONSENT_TYPE,
        consentText: CONSENT_TEXT,
        productVersion: PRODUCT_VERSION,
        ipAddress: clientIp(request),
      });

      await tx.insert(subscriptions).values({
        orgId: org.id,
        planTier: "trial",
        status: "trialing",
        queriesUsedThisPeriod: 0,
        queriesLimit: TRIAL_QUERY_LIMIT,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
      });

      return org;
    });

    return NextResponse.json(
      {
        data: {
          id: created.id,
          name: created.name,
          slug: created.slug,
          industry: created.industry,
          revenueBand: created.annualRevenueBand,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Request body is invalid.",
            details: error.issues,
            request_id,
          },
        },
        { status: 400 },
      );
    }

    console.error({
      event: "organization_create_failed",
      errorMessage: error instanceof Error ? error.message : String(error),
      request_id,
    });
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred.",
          request_id,
        },
      },
      { status: 500 },
    );
  }
}
