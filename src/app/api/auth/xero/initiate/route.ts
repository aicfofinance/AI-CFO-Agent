/**
 * GET /api/auth/xero/initiate
 *
 * Initiates the Xero OAuth 2.0 PKCE authorization flow.
 * Requires an authenticated session with owner or admin role.
 *
 * PKCE flow:
 *   1. Generates a random code verifier (base64url, 43 chars).
 *   2. Derives a code challenge via SHA-256 (S256 method).
 *   3. Generates a CSRF state token.
 *   4. Stores { codeVerifier, state } in a 2-minute httpOnly cookie.
 *   5. Returns the Xero authorization URL with PKCE params appended.
 *
 * The callback reads xero_oauth_pkce to validate the CSRF state and exchange
 * the code for tokens using the stored verifier.
 *
 * Scopes: offline_access accounting.transactions.read accounting.accounts.read
 *         openid email profile (read-only).
 * Write-scope enforcement runs in the callback for defence in depth.
 *
 * Requires auth: Yes.
 * Returns 401 if unauthenticated, 403 if insufficient role (not admin/owner).
 */

import { createHash, randomBytes } from "node:crypto";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { buildXeroAuthUrl } from "@/lib/integrations/xero/auth";
import { RequestContextError } from "@/lib/platform/auth/session";
import { requireAuth } from "@/lib/platform/middleware/require-auth";
import { requireRole } from "@/lib/platform/middleware/require-role";
import { env } from "@/lib/env";

/** Cookie name for the Xero PKCE + CSRF state pair. */
const PKCE_COOKIE_NAME = "xero_oauth_pkce";

/** 2-minute TTL in seconds. Never extend this — see CLAUDE.md Security Rules. */
const PKCE_COOKIE_MAX_AGE_SECONDS = 120;

/**
 * Xero OAuth redirect URI. Must match exactly what is registered in the Xero
 * developer portal (protocol, host, port, and path).
 */
const XERO_REDIRECT_URI =
  env.NODE_ENV === "production"
    ? "https://app.aicfoagent.com/api/auth/xero/callback"
    : "http://localhost:3000/api/auth/xero/callback";

export async function GET(request: Request): Promise<NextResponse> {
  const requestId = crypto.randomUUID();

  // ── 1. Authenticate ────────────────────────────────────────────────────────
  const authResult = await requireAuth(request);
  if (!authResult.ok) return authResult.response;

  // ── 2. Authorise (owner or admin only) ─────────────────────────────────────
  try {
    requireRole(authResult.ctx, "owner", "admin");
  } catch (error) {
    if (error instanceof RequestContextError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message, request_id: requestId } },
        { status: error.status },
      );
    }
    console.error({
      event: "xero_oauth_initiate_role_check_error",
      errorMessage: error instanceof Error ? error.message : String(error),
      requestId,
    });
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred.",
          request_id: requestId,
        },
      },
      { status: 500 },
    );
  }

  // ── 3. Generate PKCE code verifier + S256 challenge ─────────────────────────
  // Code verifier: 32 random bytes as base64url → 43 URL-safe characters (RFC 7636).
  const codeVerifier = randomBytes(32).toString("base64url");
  // Code challenge: base64url(SHA-256(ASCII(codeVerifier))) per RFC 7636 §4.2.
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

  // ── 4. Generate CSRF state token ────────────────────────────────────────────
  // 16 random bytes → 32 hex characters.
  const state = randomBytes(16).toString("hex");

  // ── 5. Build the Xero authorization URL ─────────────────────────────────────
  let authorizationUrl: string;
  try {
    authorizationUrl = buildXeroAuthUrl(state, codeChallenge, XERO_REDIRECT_URI);
  } catch (error) {
    console.error({
      event: "xero_oauth_initiate_url_build_failed",
      errorMessage: error instanceof Error ? error.message : String(error),
      requestId,
    });
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to initialize Xero OAuth client.",
          request_id: requestId,
        },
      },
      { status: 500 },
    );
  }

  // ── 6. Persist PKCE state in httpOnly cookie (2-minute TTL) ─────────────────
  // The code verifier is stored server-side in the cookie (not the challenge).
  // The callback reads this to complete the PKCE exchange with Xero.
  const cookieStore = await cookies();
  cookieStore.set(PKCE_COOKIE_NAME, JSON.stringify({ codeVerifier, state }), {
    httpOnly: true,
    sameSite: "strict",
    secure: env.NODE_ENV === "production",
    maxAge: PKCE_COOKIE_MAX_AGE_SECONDS,
    path: "/",
  });

  return NextResponse.json({ data: { authorizationUrl } });
}
