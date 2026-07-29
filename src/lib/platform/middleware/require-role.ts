import { RequestContextError, type RequestContext } from "@/lib/platform/auth/session";

/**
 * Asserts that the current context holds one of the allowed roles. Call this
 * after `requireAuth` has produced a `RequestContext`:
 *
 * ```ts
 * requireRole(ctx, "owner", "admin");
 * ```
 *
 * Throws a `RequestContextError` (403 FORBIDDEN) when the role is not permitted.
 * Authorization failure is 403, never 404 — the resource's existence is never
 * leaked (see CLAUDE.md, API Rules).
 */
export function requireRole(ctx: RequestContext, ...roles: string[]): void {
  if (!roles.includes(ctx.role)) {
    throw new RequestContextError(
      403,
      "FORBIDDEN",
      "You do not have permission to perform this action.",
    );
  }
}
