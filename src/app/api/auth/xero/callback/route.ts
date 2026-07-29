/**
 * GET /api/auth/xero/callback
 *
 * Handles the Xero OAuth 2.0 PKCE authorization callback.
 *
 * Flow:
 *   1.  Reads code and state from query params.
 *   2.  Reads and validates the xero_oauth_pkce PKCE cookie.
 *   3.  Validates CSRF state (stateParam must equal cookie.state).
 *   4.  Authenticates the user (session must still be valid from initiate step).
 *   5.  Authorizes role: owner or admin only.
 *   6.  Exchanges the authorization code for tokens via fetch() to Xero's
 *       token endpoint with PKCE code_verifier and Basic auth.
 *   7.  Verifies no write scopes were granted (CRITICAL — CLAUDE.md Security
 *       Rules). Runs on every callback without exception.
 *   8.  Fetches the Xero tenant ID from /connections endpoint.
 *   9.  Checks QB/Xero mutual exclusivity — returns 409 redirect if the org
 *       already has an active accounting connection (DB layer also enforces this
 *       via idx_connections_one_accounting_per_org). Both layers required.
 *  10.  Encrypts both tokens with encryptToken() before any DB write.
 *  11.  Upserts the connections row on (org_id, provider='xero').
 *  12.  Clears the PKCE cookie.
 *  13.  Enqueues sync/org.requested via Inngest.
 *  14.  Redirects to /onboarding/sync (first connection) or /settings/connections.
 *
 * All redirects use NextResponse.redirect(). Token values NEVER appear in
 * redirect URLs, logs, or API responses.
 *
 * Requires auth: Yes — user session must be valid when the callback fires.
 * Role required: owner or admin.
 * Returns: redirect (never a JSON body — this is an OAuth callback).
 */

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { and, eq, or } from "drizzle-orm";
import { z } from "zod";

import { encryptToken } from "@/lib/platform/security/encryption";
import { requireAuth } from "@/lib/platform/middleware/require-auth";
import { requireRole } from "@/lib/platform/middleware/require-role";
import { RequestContextError } from "@/lib/platform/auth/session";
import { db } from "@/lib/platform/db/client";
import { connections } from "@/lib/platform/db/schema";
import { inngest } from "@/lib/inngest";
import { env } from "@/lib/env";
import {
  exchangeXeroCode,
  getXeroTenantId,
  getXeroTenantName,
  containsXeroWriteScopes,
} from "@/lib/integrations/xero/auth";

/** Cookie name for the Xero PKCE + CSRF state pair — must match the initiate route. */
const PKCE_COOKIE_NAME = "xero_oauth_pkce";

/**
 * The Xero OAuth redirect URI registered in the Xero developer portal.
 * Must match exactly — including protocol, host, port, and path — in both the
 * initiate route and this callback.
 */
const XERO_REDIRECT_URI =
  env.NODE_ENV === "production"
    ? "https://app.aicfoagent.com/api/auth/xero/callback"
    : "http://localhost:3000/api/auth/xero/callback";

/** Zod schema for the JSON value stored in the PKCE cookie by the initiate route. */
const pkceCookieSchema = z.object({
  codeVerifier: z.string().min(1),
  state: z.string().min(1),
});

export async function GET(request: Request): Promise<NextResponse> {
  const requestId = crypto.randomUUID();
  const origin = new URL(request.url).origin;

  /**
   * Builds a redirect to /settings/connections with an error query param.
   * Token values NEVER appear in error codes or redirect URLs.
   */
  const errorRedirect = (errorCode: string): NextResponse =>
    NextResponse.redirect(`${origin}/settings/connections?error=${errorCode}`);

  // ── Step 1: Read and validate query params ───────────────────────────────────
  const callbackUrl = new URL(request.url);
  const code = callbackUrl.searchParams.get("code");
  const stateParam = callbackUrl.searchParams.get("state");
  const errorParam = callbackUrl.searchParams.get("error");

  // Handle OAuth denial: user clicked "Cancel" or denied access at Xero's
  // consent screen. Xero sends ?error=access_denied in this case.
  if (errorParam) {
    console.error({
      event: "xero_oauth_callback_user_denied",
      oauthError: errorParam,
      requestId,
    });
    return errorRedirect("access_denied");
  }

  if (!code || !stateParam) {
    console.error({
      event: "xero_oauth_callback_missing_params",
      hasCode: !!code,
      hasState: !!stateParam,
      requestId,
    });
    return errorRedirect("invalid_state");
  }

  // ── Step 2: Read and parse the PKCE cookie ───────────────────────────────────
  const cookieStore = await cookies();
  const rawCookie = cookieStore.get(PKCE_COOKIE_NAME);

  if (!rawCookie?.value) {
    // Cookie missing: either expired (2-min TTL) or flow was not initiated from
    // this browser session.
    console.error({
      event: "xero_oauth_callback_pkce_cookie_missing",
      requestId,
    });
    return errorRedirect("session_expired");
  }

  let pkceData: { codeVerifier: string; state: string };
  try {
    const parsed = JSON.parse(rawCookie.value) as unknown;
    pkceData = pkceCookieSchema.parse(parsed);
  } catch {
    console.error({
      event: "xero_oauth_callback_pkce_cookie_malformed",
      requestId,
    });
    return errorRedirect("session_expired");
  }

  // ── Step 3: CSRF state validation ────────────────────────────────────────────
  // The state param Xero echoes back must match what we generated and stored
  // in the cookie. A mismatch indicates a CSRF attempt or session confusion.
  if (stateParam !== pkceData.state) {
    console.error({
      event: "xero_oauth_callback_state_mismatch",
      requestId,
    });
    return errorRedirect("invalid_state");
  }

  // ── Step 4: Authenticate the user ────────────────────────────────────────────
  const authResult = await requireAuth(request);
  if (!authResult.ok) {
    console.error({
      event: "xero_oauth_callback_auth_failed",
      requestId,
    });
    return errorRedirect("session_expired");
  }

  const { ctx } = authResult;

  // ── Step 5: Authorize — owner or admin only ───────────────────────────────────
  try {
    requireRole(ctx, "owner", "admin");
  } catch (error) {
    if (error instanceof RequestContextError) {
      console.error({
        event: "xero_oauth_callback_role_denied",
        orgId: ctx.orgId,
        role: ctx.role,
        requestId,
      });
      return errorRedirect("unauthorized");
    }
    console.error({
      event: "xero_oauth_callback_role_check_unexpected_error",
      orgId: ctx.orgId,
      requestId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return errorRedirect("unauthorized");
  }

  const { orgId } = ctx;

  // ── Step 6: Exchange authorization code for tokens ───────────────────────────
  // exchangeXeroCode() performs the PKCE token exchange via fetch() with Basic
  // auth (clientId:clientSecret). Rotating refresh tokens are returned — both
  // the access_token and refresh_token must be persisted.
  let tokenData: Awaited<ReturnType<typeof exchangeXeroCode>>;
  try {
    tokenData = await exchangeXeroCode(code, pkceData.codeVerifier, XERO_REDIRECT_URI);
  } catch (error) {
    console.error({
      event: "xero_oauth_callback_token_exchange_failed",
      orgId,
      requestId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return errorRedirect("token_exchange_failed");
  }

  // ── Step 7: Verify scopes (CRITICAL — CLAUDE.md Security Rules) ─────────────
  // The app ONLY requests read scopes. If Xero grants write scopes (accounting.
  // transactions without .read, payroll.*, files.*), reject the connection.
  // This check runs on every callback — never conditionally bypassed.
  if (containsXeroWriteScopes(tokenData.scope)) {
    console.error({
      event: "xero_oauth_callback_write_scope_rejected",
      orgId,
      requestId,
      // scope string contains scope names, not token values — safe to log.
      grantedScope: tokenData.scope,
    });
    return errorRedirect("write_scope_rejected");
  }

  // ── Step 8: Resolve the Xero tenant ID ──────────────────────────────────────
  // The tenantId is required for every Xero accounting API call. It is stored
  // in connections.realmId (VARCHAR 100, same column as QB's realmId).
  // getXeroTenantName() is non-fatal: null is acceptable for providerCompanyName.
  let tenantId: string;
  let tenantName: string | null = null;

  try {
    tenantId = await getXeroTenantId(tokenData.access_token);
    tenantName = await getXeroTenantName(tokenData.access_token);
  } catch (error) {
    console.error({
      event: "xero_oauth_callback_tenant_id_fetch_failed",
      orgId,
      requestId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return errorRedirect("tenant_fetch_failed");
  }

  // ── Step 9: QB/Xero mutual exclusivity check (application layer) ────────────
  // CLAUDE.md: "The QB/Xero mutual exclusivity constraint is enforced at both
  // layers. The database has a partial unique index preventing two active
  // accounting connections for the same org. The application layer in the Xero
  // callback must also check and return 409. Both must be in place."
  //
  // We check for an ACTIVE QuickBooks OR Xero accounting connection for this org
  // (excluding the case where Xero is being reconnected — same provider).
  try {
    const [existingAccountingConnection] = await db
      .select({ id: connections.id, provider: connections.provider })
      .from(connections)
      .where(
        and(
          eq(connections.orgId, orgId),
          eq(connections.isActive, true),
          or(eq(connections.provider, "quickbooks"), eq(connections.provider, "xero")),
        ),
      )
      .limit(1);

    // If there is an existing ACTIVE accounting connection that is NOT the Xero
    // provider being connected, block with a 409-equivalent redirect.
    // (If it IS an existing Xero connection, we allow the upsert in Step 11 to
    // rotate tokens — this is a reconnect, not a conflict.)
    if (existingAccountingConnection && existingAccountingConnection.provider !== "xero") {
      console.error({
        event: "xero_oauth_callback_accounting_connection_conflict",
        orgId,
        existingProvider: existingAccountingConnection.provider,
        requestId,
      });
      return errorRedirect("connection_exists");
    }
  } catch (error) {
    console.error({
      event: "xero_oauth_callback_exclusivity_check_failed",
      orgId,
      requestId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return errorRedirect("token_exchange_failed");
  }

  // ── Step 10: Encrypt tokens before any persistence ───────────────────────────
  // AES-256-GCM via encryptToken() — fresh random IV per call so the same
  // plaintext yields different ciphertext each time. NEVER log the plaintext
  // access_token or refresh_token values.
  const accessTokenEncrypted = encryptToken(tokenData.access_token);
  const refreshTokenEncrypted = encryptToken(tokenData.refresh_token);
  // expires_in is seconds from now; compute the absolute timestamp for storage.
  const tokenExpiry = new Date(Date.now() + tokenData.expires_in * 1000);

  // ── Step 11: Determine first-time vs reconnect ───────────────────────────────
  let isFirstTimeConnection = false;
  try {
    const [existingXeroConnection] = await db
      .select({ id: connections.id })
      .from(connections)
      .where(and(eq(connections.orgId, orgId), eq(connections.provider, "xero")))
      .limit(1);
    isFirstTimeConnection = !existingXeroConnection;
  } catch (error) {
    console.error({
      event: "xero_oauth_callback_connection_lookup_failed",
      orgId,
      requestId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    // Default to settings page on lookup error.
    isFirstTimeConnection = false;
  }

  // ── Step 12: Upsert the connections row ──────────────────────────────────────
  // Conflict target: (org_id, provider) — unique index idx_connections_org_provider.
  // On conflict, update token fields and reset sync state to 'pending'.
  //
  // The DB-layer partial unique index (idx_connections_one_accounting_per_org) is
  // the second enforcement point for QB/Xero exclusivity. If the application-layer
  // check above is bypassed (race condition), the DB constraint fires as a 23505
  // unique_violation with the constraint name 'idx_connections_one_accounting_per_org'.
  let connectionId: string;
  try {
    const [upserted] = await db
      .insert(connections)
      .values({
        orgId,
        provider: "xero",
        accessTokenEncrypted,
        refreshTokenEncrypted,
        tokenExpiry,
        realmId: tenantId, // Xero tenantId stored in realmId column
        providerCompanyName: tenantName,
        isActive: true,
        syncStatus: "pending",
      })
      .onConflictDoUpdate({
        target: [connections.orgId, connections.provider],
        set: {
          accessTokenEncrypted,
          refreshTokenEncrypted,
          tokenExpiry,
          realmId: tenantId,
          providerCompanyName: tenantName,
          isActive: true,
          syncStatus: "pending",
          syncErrorMessage: null,
        },
      })
      .returning({ id: connections.id });

    if (!upserted?.id) {
      throw new Error("Upsert returned no row — unexpected database state.");
    }

    connectionId = upserted.id;
  } catch (error) {
    // Detect the partial unique index violation for QB/Xero mutual exclusivity.
    // postgres.js / pg exposes the PostgreSQL error code (23505 = unique_violation)
    // and constraint_name as extra properties on the Error object.
    if (error instanceof Error && "code" in error) {
      const dbError = error as Error & { code: string; constraint_name?: string };
      if (
        dbError.code === "23505" &&
        dbError.constraint_name === "idx_connections_one_accounting_per_org"
      ) {
        console.error({
          event: "xero_oauth_callback_accounting_connection_conflict_db",
          orgId,
          requestId,
        });
        return errorRedirect("connection_exists");
      }
    }

    console.error({
      event: "xero_oauth_callback_upsert_failed",
      orgId,
      requestId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return errorRedirect("token_exchange_failed");
  }

  // ── Step 13: Clear the PKCE cookie ───────────────────────────────────────────
  cookieStore.delete(PKCE_COOKIE_NAME);

  // ── Step 14: Enqueue initial sync via Inngest ─────────────────────────────────
  // Non-fatal: if the event fails to enqueue, the connection row is committed.
  // The scheduled fan-out every 6 hours will pick up the pending connection.
  try {
    await inngest.send({
      name: "sync/org.requested",
      data: { connectionId, orgId },
    });
  } catch (error) {
    console.error({
      event: "xero_oauth_callback_inngest_send_failed",
      connectionId,
      orgId,
      requestId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }

  // ── Step 15: Redirect ─────────────────────────────────────────────────────────
  // First-time connections → onboarding sync progress page.
  // Reconnects (token refresh / re-auth) → connections settings page.
  const redirectPath = isFirstTimeConnection ? "/onboarding/sync" : "/settings/connections";

  return NextResponse.redirect(`${origin}${redirectPath}`);
}
