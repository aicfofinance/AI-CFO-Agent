import { NextResponse } from "next/server";
import { z, ZodError } from "zod";

import { getRequestContext, RequestContextError } from "@/lib/platform/auth/session";
import { db } from "@/lib/platform/db/client";
import { findings } from "@/lib/platform/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * Accepted dismissal reasons. The `findings.dismiss_reason` column is a plain
 * VARCHAR(30) (no DB CHECK), so the enum is enforced at the application layer
 * here via Zod. `.parse()` throws a `ZodError` on an out-of-set value, which the
 * handler translates into a 400.
 */
const DISMISS_REASONS = [
  "acknowledged",
  "not_relevant",
  "already_handled",
  "false_positive",
] as const;

const DismissRequestSchema = z.object({
  reason: z.enum(DISMISS_REASONS),
});

/**
 * POST /api/intelligence/findings/:id/dismiss
 *
 * Requires session. Returns 401 if unauthenticated, 403 if the user has no org
 * membership, 400 if the body fails validation, 404 if the finding does not
 * exist in the caller's org, 409 if the finding is not currently `active`, 500
 * on unexpected error.
 *
 * On success sets `status = 'dismissed'`, `dismissed_at = NOW()`,
 * `dismissed_by = userId`, and `dismiss_reason`, then returns
 * `{ data: { id, status: 'dismissed' } }`. A dismissed finding no longer appears
 * in `GET /api/intelligence/feed` (which filters `status = 'active'`).
 *
 * The finding is looked up with `WHERE id = :id AND org_id = :orgId` — a finding
 * that belongs to another org simply does not match, yielding a 404 that never
 * reveals its existence (CLAUDE.md, Multi-tenancy Rules). The org is always
 * sourced from `getRequestContext()`, never from user input.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const request_id = crypto.randomUUID();

  try {
    const { orgId, userId } = await getRequestContext(request);
    const { id } = await params;

    const body: unknown = await request.json();
    const { reason } = DismissRequestSchema.parse(body);

    // Scope the lookup to the caller's org. A cross-org id yields no row → 404,
    // which does not leak whether the finding exists elsewhere.
    const [finding] = await db
      .select({ id: findings.id, status: findings.status })
      .from(findings)
      .where(and(eq(findings.id, id), eq(findings.orgId, orgId)))
      .limit(1);

    if (!finding) {
      return NextResponse.json(
        {
          error: {
            code: "NOT_FOUND",
            message: "Finding not found.",
            request_id,
          },
        },
        { status: 404 },
      );
    }

    if (finding.status !== "active") {
      return NextResponse.json(
        {
          error: {
            code: "FINDING_NOT_ACTIVE",
            message: "This finding has already been dismissed or is not active.",
            request_id,
          },
        },
        { status: 409 },
      );
    }

    await db
      .update(findings)
      .set({
        status: "dismissed",
        dismissedAt: new Date(),
        dismissedBy: userId,
        dismissReason: reason,
      })
      .where(and(eq(findings.id, id), eq(findings.orgId, orgId)));

    return NextResponse.json({ data: { id, status: "dismissed" } }, { status: 200 });
  } catch (error) {
    if (error instanceof RequestContextError) {
      console.error({ event: "finding_dismiss_auth_failed", code: error.code, request_id });
      return NextResponse.json(
        { error: { code: error.code, message: error.message, request_id } },
        { status: error.status },
      );
    }

    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Request body is invalid: 'reason' must be a supported dismissal reason.",
            details: error.issues,
            request_id,
          },
        },
        { status: 400 },
      );
    }

    console.error({
      event: "finding_dismiss_failed",
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
