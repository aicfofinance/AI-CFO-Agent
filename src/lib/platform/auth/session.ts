import { eq } from "drizzle-orm";

import { createServerClient } from "@/lib/platform/auth/supabase";
import { db } from "@/lib/platform/db/client";
import { organizationMembers, subscriptions } from "@/lib/platform/db/schema";

/**
 * Per-request org context. This is the canonical source of truth for the
 * current organization on every authenticated request. Route handlers derive
 * their `org_id` filter from `orgId` here — NEVER from a request body or query
 * param (see CLAUDE.md, Multi-tenancy Rules).
 *
 * Monetary values are not part of this context, so `queriesUsed` and
 * `queriesLimit` are plain integers (they are counts, not currency).
 */
export type RequestContext = {
  userId: string;
  orgId: string;
  role: string;
  planTier: string;
  queriesUsed: number;
  queriesLimit: number;
};

/**
 * A typed failure raised while establishing request context. It carries the
 * HTTP status and error code that a route handler (or the `requireAuth` helper)
 * translates into the standard error envelope.
 *
 * The distinct `INTERNAL_ORG_CONTEXT_MISSING` case (status 500) exists because
 * a missing `orgId` on an authenticated request is a security error, not a
 * null-check: the caller must fail loudly rather than fall back to an unscoped
 * query that would cross tenant boundaries (see CLAUDE.md).
 */
export class RequestContextError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "RequestContextError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Resolves the current user, organization, role, and quota context for an
 * authenticated request. The session flows through Supabase's cookie-bound
 * server client (built in `createServerClient()`), so the `request` argument is
 * part of the call contract rather than the data source.
 *
 * Failure modes, each a distinct `RequestContextError`:
 * - No authenticated user            → 401 UNAUTHORIZED
 * - No organization membership       → 403 NO_ORG_MEMBERSHIP
 * - Membership row with a null orgId → 500 INTERNAL_ORG_CONTEXT_MISSING
 * - No subscription row for the org  → 500 INTERNAL_SUBSCRIPTION_MISSING
 */
export async function getRequestContext(request: Request): Promise<RequestContext> {
  // The auth session is read from cookies by the Supabase server client, not
  // from `request` directly; the parameter is kept to pin the canonical call
  // signature every route handler uses.
  void request;

  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    throw new RequestContextError(401, "UNAUTHORIZED", "Authentication required.");
  }

  const userId = data.user.id;

  const [membership] = await db
    .select({
      orgId: organizationMembers.orgId,
      role: organizationMembers.role,
    })
    .from(organizationMembers)
    .where(eq(organizationMembers.userId, userId))
    .limit(1);

  if (!membership) {
    throw new RequestContextError(
      403,
      "NO_ORG_MEMBERSHIP",
      "No organization membership found for this user.",
    );
  }

  // Defence in depth: an authenticated membership row without an orgId must
  // never degrade into an unscoped query. Fail with a distinct 500 so callers
  // can detect and surface the security error explicitly.
  if (!membership.orgId) {
    console.error({ event: "org_context_missing", userId });
    throw new RequestContextError(
      500,
      "INTERNAL_ORG_CONTEXT_MISSING",
      "Organization context is missing for an authenticated user.",
    );
  }

  const orgId = membership.orgId;

  const [subscription] = await db
    .select({
      planTier: subscriptions.planTier,
      queriesUsed: subscriptions.queriesUsedThisPeriod,
      queriesLimit: subscriptions.queriesLimit,
    })
    .from(subscriptions)
    .where(eq(subscriptions.orgId, orgId))
    .limit(1);

  if (!subscription) {
    console.error({ event: "subscription_missing", orgId });
    throw new RequestContextError(
      500,
      "INTERNAL_SUBSCRIPTION_MISSING",
      "Subscription record is missing for the organization.",
    );
  }

  return {
    userId,
    orgId,
    role: membership.role,
    planTier: subscription.planTier,
    queriesUsed: subscription.queriesUsed,
    queriesLimit: subscription.queriesLimit,
  };
}
