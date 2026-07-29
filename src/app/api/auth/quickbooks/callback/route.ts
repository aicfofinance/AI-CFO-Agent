/**
 * GET /api/auth/quickbooks/callback
 *
 * Handles the QuickBooks OAuth 2.0 PKCE authorization callback from Intuit.
 *
 * Flow:
 *   1. Reads code, state, realmId from query params.
 *   2. Reads and validates the qb_oauth_pkce PKCE cookie.
 *   3. Validates CSRF state (stateParam must equal cookie.state).
 *   4. Authenticates the user (session must still be valid from initiate step).
 *   5. Authorizes role: owner or admin only.
 *   6. Exchanges the authorization code for tokens via a direct PKCE-aware
 *      fetch to Intuit's token endpoint. intuit-oauth's createToken() does NOT
 *      support code_verifier — the exchange is performed manually.
 *   7. Verifies no write scopes (payment/payroll) were granted. CRITICAL per
 *      CLAUDE.md Security Rules — runs on every callback without exception.
 *   8. Encrypts both tokens with encryptToken() before any DB write.
 *   9. Upserts the connections row on (org_id, provider='quickbooks').
 *  10. Clears the PKCE cookie.
 *  11. Enqueues sync/connection.requested via Inngest.
 *  12. Redirects to /onboarding/sync (first connection) or /settings/connections.
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
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { encryptToken } from "@/lib/platform/security/encryption";
import { requireAuth } from "@/lib/platform/middleware/require-auth";
import { requireRole } from "@/lib/platform/middleware/require-role";
import { RequestContextError } from "@/lib/platform/auth/session";
import { db } from "@/lib/platform/db/client";
import { connections } from "@/lib/platform/db/schema";
import { inngest } from "@/lib/inngest";
import { env } from "@/lib/env";

/** Cookie name for the PKCE + CSRF state pair — must match the initiate route. */
const PKCE_COOKIE_NAME = "qb_oauth_pkce";

/**
 * Intuit's token endpoint. Identical for sandbox and production OAuth flows.
 * The sandbox/production distinction applies to the Accounting API base URL,
 * not to the OAuth token endpoint itself.
 */
const INTUIT_TOKEN_ENDPOINT = "https://oauth.platform.intuit.com/oauth2/v1/token";

/**
 * The QB OAuth redirect URI registered in the Intuit developer console.
 * Must match exactly — including protocol, host, port, and path — in the
 * initiate route, this file, and the Intuit developer console.
 */
const QB_REDIRECT_URI = "http://localhost:3000/api/auth/quickbooks/callback";

/**
 * Zod schema for the Intuit token endpoint response.
 * `scope` is optional — Intuit may or may not echo it back in the token response.
 * `x_refresh_token_expires_in` (100 days in seconds) is informational only.
 */
const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  x_refresh_token_expires_in: z.number().int().positive().optional(),
  token_type: z.string(),
  scope: z.string().optional(),
});

/** Zod schema for the JSON value stored in the PKCE cookie by the initiate route. */
const pkceCookieSchema = z.object({
  codeVerifier: z.string().min(1),
  state: z.string().min(1),
});

/**
 * Returns true if the granted scope string contains any write-only or
 * non-accounting QuickBooks scopes.
 *
 * Allowed: com.intuit.quickbooks.accounting, openid, email, profile
 * Prohibited: com.intuit.quickbooks.payment, com.intuit.quickbooks.payroll.*
 *
 * This function is the application-layer enforcement of the product's
 * read-only data sovereignty promise. It must run on every callback.
 */
function containsWriteScopes(scope: string | undefined): boolean {
  if (!scope) return false;
  const prohibitedPrefixes = ["com.intuit.quickbooks.payment", "com.intuit.quickbooks.payroll"];
  return scope.split(" ").some((s) => prohibitedPrefixes.some((prefix) => s.startsWith(prefix)));
}

export async function GET(request: Request): Promise<NextResponse> {
  const requestId = crypto.randomUUID();
  const origin = new URL(request.url).origin;

  /**
   * Builds a redirect to /settings/connections with an error query param.
   * Token values NEVER appear in error codes or redirect URLs.
   */
  const errorRedirect = (errorCode: string): NextResponse =>
    NextResponse.redirect(`${origin}/settings/connections?error=${errorCode}`);

  // ---- Step 1: Read and validate query params ----
  const callbackUrl = new URL(request.url);
  const code = callbackUrl.searchParams.get("code");
  const stateParam = callbackUrl.searchParams.get("state");
  const realmId = callbackUrl.searchParams.get("realmId");
  const errorParam = callbackUrl.searchParams.get("error");

  // Handle OAuth denial: user clicked "Cancel" or denied access at Intuit's
  // consent screen. Intuit sends ?error=access_denied in this case.
  if (errorParam) {
    console.error({
      event: "qb_oauth_callback_user_denied",
      oauthError: errorParam,
      requestId,
    });
    return errorRedirect("access_denied");
  }

  if (!code || !stateParam || !realmId) {
    console.error({
      event: "qb_oauth_callback_missing_params",
      hasCode: !!code,
      hasState: !!stateParam,
      hasRealmId: !!realmId,
      requestId,
    });
    return errorRedirect("invalid_state");
  }

  // ---- Step 2: Read and parse the PKCE cookie ----
  const cookieStore = await cookies();
  const rawCookie = cookieStore.get(PKCE_COOKIE_NAME);

  if (!rawCookie?.value) {
    // Cookie missing: either expired (2-min TTL) or the flow was not initiated
    // from this browser session.
    console.error({
      event: "qb_oauth_callback_pkce_cookie_missing",
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
      event: "qb_oauth_callback_pkce_cookie_malformed",
      requestId,
    });
    return errorRedirect("session_expired");
  }

  // ---- Step 3: CSRF state validation ----
  // The state param Intuit echoes back must match what we generated and stored
  // in the cookie. A mismatch indicates a CSRF attempt or session confusion.
  if (stateParam !== pkceData.state) {
    console.error({
      event: "qb_oauth_callback_state_mismatch",
      requestId,
    });
    return errorRedirect("invalid_state");
  }

  // ---- Step 4: Authenticate the user ----
  // The user must still have a valid Supabase session. Sessions can expire
  // during the OAuth consent screen if it takes too long.
  const authResult = await requireAuth(request);
  if (!authResult.ok) {
    console.error({
      event: "qb_oauth_callback_auth_failed",
      requestId,
    });
    return errorRedirect("session_expired");
  }

  const { ctx } = authResult;

  // ---- Step 5: Authorize — owner or admin only ----
  try {
    requireRole(ctx, "owner", "admin");
  } catch (error) {
    if (error instanceof RequestContextError) {
      console.error({
        event: "qb_oauth_callback_role_denied",
        orgId: ctx.orgId,
        role: ctx.role,
        requestId,
      });
      return errorRedirect("unauthorized");
    }
    console.error({
      event: "qb_oauth_callback_role_check_unexpected_error",
      orgId: ctx.orgId,
      requestId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return errorRedirect("unauthorized");
  }

  const { orgId } = ctx;

  // ---- Step 6: Exchange authorization code for tokens ----
  // intuit-oauth's oauthClient.createToken() does not natively support sending
  // a PKCE code_verifier. The token exchange is performed manually via fetch()
  // to Intuit's token endpoint per PKCE RFC 7636 §4.5.
  //
  // Reference: https://developer.intuit.com/app/developer/qbo/docs/develop/
  //            authentication-and-authorization/oauth-2.0

  if (!env.QB_CLIENT_ID || !env.QB_CLIENT_SECRET) {
    console.error({
      event: "qb_oauth_callback_credentials_not_configured",
      requestId,
    });
    return errorRedirect("token_exchange_failed");
  }

  // Basic auth header: base64(clientId:clientSecret)
  const credentials = Buffer.from(`${env.QB_CLIENT_ID}:${env.QB_CLIENT_SECRET}`).toString("base64");

  const tokenRequestBody = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: QB_REDIRECT_URI,
    client_id: env.QB_CLIENT_ID,
    client_secret: env.QB_CLIENT_SECRET,
    code_verifier: pkceData.codeVerifier,
  });

  let tokenData: z.infer<typeof tokenResponseSchema>;
  try {
    const tokenResponse = await fetch(INTUIT_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${credentials}`,
        Accept: "application/json",
      },
      body: tokenRequestBody.toString(),
    });

    if (!tokenResponse.ok) {
      // QB token error responses are JSON error codes — safe to log, no tokens.
      const errorBody = await tokenResponse.text();
      console.error({
        event: "qb_oauth_callback_token_endpoint_http_error",
        httpStatus: tokenResponse.status,
        orgId,
        requestId,
        errorBody,
      });
      return errorRedirect("token_exchange_failed");
    }

    const responseJson = (await tokenResponse.json()) as unknown;
    // Zod parse throws ZodError on invalid shape — caught by the outer catch.
    tokenData = tokenResponseSchema.parse(responseJson);
  } catch (error) {
    console.error({
      event: "qb_oauth_callback_token_exchange_failed",
      orgId,
      requestId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return errorRedirect("token_exchange_failed");
  }

  // ---- Step 7: Verify scopes (CRITICAL — CLAUDE.md Security Rules) ----
  // The app ONLY requests com.intuit.quickbooks.accounting (read-only).
  // If Intuit grants payment or payroll scopes, reject the connection.
  // This check runs on every callback — never conditionally bypassed.
  if (containsWriteScopes(tokenData.scope)) {
    console.error({
      event: "qb_oauth_callback_write_scope_rejected",
      orgId,
      requestId,
      // scope string contains scope names, not token values — safe to log.
      grantedScope: tokenData.scope,
    });
    return errorRedirect("write_scope_rejected");
  }

  // ---- Step 8: Encrypt tokens before any persistence ----
  // AES-256-GCM via encryptToken() — fresh random IV per call so the same
  // plaintext yields different ciphertext each time. NEVER log the plaintext
  // access_token or refresh_token values.
  const accessTokenEncrypted = encryptToken(tokenData.access_token);
  const refreshTokenEncrypted = encryptToken(tokenData.refresh_token);
  // expires_in is seconds from now; compute the absolute timestamp for storage.
  const tokenExpiry = new Date(Date.now() + tokenData.expires_in * 1000);

  // ---- Step 9: Determine first-time vs reconnect ----
  // Drives the redirect destination after the connection is established.
  // Non-fatal lookup: if the query fails, fall back to the settings page.
  let isFirstTimeConnection = false;
  try {
    const [existingConnection] = await db
      .select({ id: connections.id })
      .from(connections)
      .where(and(eq(connections.orgId, orgId), eq(connections.provider, "quickbooks")))
      .limit(1);
    isFirstTimeConnection = !existingConnection;
  } catch (error) {
    console.error({
      event: "qb_oauth_callback_connection_lookup_failed",
      orgId,
      requestId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    // Default to settings page on lookup error.
    isFirstTimeConnection = false;
  }

  // ---- Step 10: Upsert the connections row ----
  // Conflict target: (org_id, provider) — unique index idx_connections_org_provider.
  // On conflict, update the token fields and reset sync state to 'pending'.
  //
  // The partial unique index idx_connections_one_accounting_per_org prevents
  // two active accounting connections (QB + Xero) in the same org. That
  // constraint fires as a 23505 unique_violation with a distinct constraint_name
  // when the org already has an active Xero connection and we try to insert QB.
  let connectionId: string;
  try {
    const [upserted] = await db
      .insert(connections)
      .values({
        orgId,
        provider: "quickbooks",
        accessTokenEncrypted,
        refreshTokenEncrypted,
        tokenExpiry,
        realmId,
        isActive: true,
        syncStatus: "pending",
      })
      .onConflictDoUpdate({
        target: [connections.orgId, connections.provider],
        set: {
          accessTokenEncrypted,
          refreshTokenEncrypted,
          tokenExpiry,
          realmId,
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
    // Detect the partial unique index violation for the QB/Xero mutual
    // exclusivity constraint. postgres.js exposes the PostgreSQL error code
    // (23505 = unique_violation) and constraint_name as extra properties on
    // the Error object. Both the DB index and this check must be in place per
    // CLAUDE.md Multi-tenancy Rules.
    if (error instanceof Error && "code" in error) {
      const dbError = error as Error & { code: string; constraint_name?: string };
      if (
        dbError.code === "23505" &&
        dbError.constraint_name === "idx_connections_one_accounting_per_org"
      ) {
        console.error({
          event: "qb_oauth_callback_accounting_connection_conflict",
          orgId,
          requestId,
        });
        return errorRedirect("connection_exists");
      }
    }

    console.error({
      event: "qb_oauth_callback_upsert_failed",
      orgId,
      requestId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return errorRedirect("token_exchange_failed");
  }

  // ---- Step 11: Clear the PKCE cookie ----
  // The cookie has served its purpose. Delete it to prevent any replay
  // confusion (CSRF state check already prevents replay, but defence in depth).
  cookieStore.delete(PKCE_COOKIE_NAME);

  // ---- Step 12: Enqueue initial sync via Inngest ----
  // Non-fatal: if the event fails to enqueue, the connections row is already
  // committed. The scheduled fan-out every 6 hours will pick up the pending
  // connection. Log the failure for monitoring but proceed to redirect.
  try {
    await inngest.send({
      name: "sync/connection.requested",
      data: { connectionId, orgId },
    });
  } catch (error) {
    console.error({
      event: "qb_oauth_callback_inngest_send_failed",
      connectionId,
      orgId,
      requestId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }

  // ---- Step 13: Redirect ----
  // First-time connections → onboarding sync progress page.
  // Reconnects (token refresh / re-auth) → connections settings page.
  const redirectPath = isFirstTimeConnection ? "/onboarding/sync" : "/settings/connections";

  return NextResponse.redirect(`${origin}${redirectPath}`);
}
