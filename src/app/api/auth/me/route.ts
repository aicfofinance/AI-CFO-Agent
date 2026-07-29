import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z, ZodError } from "zod";

import { createServerClient } from "@/lib/platform/auth/supabase";
import { getRequestContext, RequestContextError } from "@/lib/platform/auth/session";
import { db } from "@/lib/platform/db/client";
import { organizations } from "@/lib/platform/db/schema";
import type { AuthMeResponse } from "@/types/api";

/**
 * /api/auth/me — the current user's identity, org context, and profile.
 *
 * GET    returns the org context plus the two mutable profile fields.
 * PATCH  updates `displayName` (→ `organizations.name`) and/or `timezone`.
 * DELETE deletes the caller's organization after confirming their email.
 *
 * All three establish the session via `getRequestContext()` (401/403/500 in the
 * standard envelope) and scope every write to the org from that context — never
 * from request input (CLAUDE.md, Multi-tenancy Rules). The product has no
 * separate `display_name` column, so `displayName` maps to `organizations.name`.
 */

const UpdateProfileSchema = z
  .object({
    displayName: z.string().min(1).max(255).optional(),
    timezone: z.string().min(1).max(50).optional(),
  })
  .refine((body) => body.displayName !== undefined || body.timezone !== undefined, {
    message: "At least one of 'displayName' or 'timezone' must be provided.",
  });

const DeleteAccountSchema = z.object({
  confirmationEmail: z.string().email(),
});

/** Maps a `RequestContextError` (or unexpected error) to the standard envelope. */
function errorResponse(error: unknown, request_id: string, event: string): NextResponse {
  if (error instanceof RequestContextError) {
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
          message: "Request body is invalid.",
          details: error.issues,
          request_id,
        },
      },
      { status: 400 },
    );
  }
  console.error({
    event,
    errorMessage: error instanceof Error ? error.message : String(error),
    request_id,
  });
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred.", request_id } },
    { status: 500 },
  );
}

/**
 * GET /api/auth/me
 *
 * Requires session. Returns 401 if unauthenticated, 403 if the user has no org
 * membership. Returns `{ data: AuthMeResponse }` combining the org context with
 * the org's `name` (surfaced as `displayName`) and `timezone`.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const request_id = crypto.randomUUID();

  try {
    const ctx = await getRequestContext(request);

    const [org] = await db
      .select({ name: organizations.name, timezone: organizations.timezone })
      .from(organizations)
      .where(eq(organizations.id, ctx.orgId))
      .limit(1);

    if (!org) {
      // An authenticated membership pointing at a non-existent org is a data
      // integrity error, not an empty result — fail loudly.
      console.error({ event: "auth_me_org_missing", orgId: ctx.orgId, request_id });
      return NextResponse.json(
        {
          error: {
            code: "INTERNAL_ORG_CONTEXT_MISSING",
            message: "Organization record is missing for an authenticated user.",
            request_id,
          },
        },
        { status: 500 },
      );
    }

    const data: AuthMeResponse = {
      userId: ctx.userId,
      orgId: ctx.orgId,
      role: ctx.role,
      planTier: ctx.planTier,
      queriesUsed: ctx.queriesUsed,
      queriesLimit: ctx.queriesLimit,
      displayName: org.name,
      timezone: org.timezone,
    };

    return NextResponse.json({ data }, { status: 200 });
  } catch (error) {
    return errorResponse(error, request_id, "auth_me_get_failed");
  }
}

/**
 * PATCH /api/auth/me
 *
 * Requires session. Accepts `{ displayName?, timezone? }` (at least one). Maps
 * `displayName` to `organizations.name`. Returns 401/403 on auth failure, 400 on
 * validation failure, and `{ data: { displayName, timezone } }` on success.
 */
export async function PATCH(request: Request): Promise<NextResponse> {
  const request_id = crypto.randomUUID();

  try {
    const ctx = await getRequestContext(request);

    const body: unknown = await request.json();
    const { displayName, timezone } = UpdateProfileSchema.parse(body);

    const update: { name?: string; timezone?: string } = {};
    if (displayName !== undefined) {
      update.name = displayName;
    }
    if (timezone !== undefined) {
      update.timezone = timezone;
    }

    const [updated] = await db
      .update(organizations)
      .set(update)
      .where(eq(organizations.id, ctx.orgId))
      .returning({ name: organizations.name, timezone: organizations.timezone });

    if (!updated) {
      console.error({ event: "auth_me_patch_org_missing", orgId: ctx.orgId, request_id });
      return NextResponse.json(
        {
          error: {
            code: "INTERNAL_ORG_CONTEXT_MISSING",
            message: "Organization record is missing for an authenticated user.",
            request_id,
          },
        },
        { status: 500 },
      );
    }

    return NextResponse.json(
      { data: { displayName: updated.name, timezone: updated.timezone } },
      { status: 200 },
    );
  } catch (error) {
    return errorResponse(error, request_id, "auth_me_patch_failed");
  }
}

/**
 * DELETE /api/auth/me
 *
 * Requires session and the `owner` role. The body must carry a
 * `confirmationEmail` that matches the authenticated user's email exactly
 * (case-insensitive) — a guard against accidental deletion. On success the
 * caller's organization is deleted; the `ON DELETE CASCADE` on `org_id` removes
 * members, subscriptions, transactions, and all other org-scoped rows.
 *
 * The Supabase auth user itself is NOT deleted here — that requires a privileged
 * admin operation and is out of scope for this endpoint.
 *
 * Returns 401/403 on auth failure, 400 on validation failure, 403 if the caller
 * is not the owner, and 422 if the confirmation email does not match.
 */
export async function DELETE(request: Request): Promise<NextResponse> {
  const request_id = crypto.randomUUID();

  try {
    const ctx = await getRequestContext(request);

    if (ctx.role !== "owner") {
      return NextResponse.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "Only an organization owner may delete the organization.",
            request_id,
          },
        },
        { status: 403 },
      );
    }

    const body: unknown = await request.json();
    const { confirmationEmail } = DeleteAccountSchema.parse(body);

    // The email is read from the verified session, never from the request body.
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const sessionEmail = user?.email;
    if (!sessionEmail || sessionEmail.toLowerCase() !== confirmationEmail.toLowerCase()) {
      return NextResponse.json(
        {
          error: {
            code: "CONFIRMATION_MISMATCH",
            message: "The confirmation email does not match the signed-in account.",
            request_id,
          },
        },
        { status: 422 },
      );
    }

    await db.delete(organizations).where(eq(organizations.id, ctx.orgId));

    return NextResponse.json({ data: { message: "Organization deleted." } }, { status: 200 });
  } catch (error) {
    return errorResponse(error, request_id, "auth_me_delete_failed");
  }
}
