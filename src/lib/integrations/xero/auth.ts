/**
 * Xero OAuth 2.0 authorization utilities.
 *
 * Token lifecycle (must be understood before extending this file):
 *   - Access token:  expires in 30 minutes (expires_in = 1800).
 *   - Refresh token: expires in 60 days, ROTATING — every successful refresh
 *     call returns a NEW refresh token. The old one is immediately invalidated.
 *     The caller MUST persist the new token pair to the database atomically
 *     after every refresh. Failing to do so locks the user out.
 *
 * We implement the OAuth2 exchange manually (not via xero-node's OIDC flow)
 * to avoid in-memory openid-client state management problems between the
 * stateless initiate and callback requests. PKCE (S256 method) is applied
 * manually — identical to the QB OAuth pattern (Step 4.2/4.3).
 *
 * Scopes used: offline_access, accounting.transactions.read,
 *              accounting.accounts.read (read-only).
 * The callback rejects any granted write scopes per CLAUDE.md Security Rules.
 */

import { env } from "@/lib/env";
import type { XeroTokenResponse, XeroTenantConnection } from "@/types/integrations";

/** Xero OpenID Connect authorization endpoint. */
const XERO_AUTH_ENDPOINT = "https://login.xero.com/identity/connect/authorize";

/** Xero token endpoint (used for both initial exchange and refresh). */
export const XERO_TOKEN_ENDPOINT = "https://identity.xero.com/connect/token";

/** Xero connections endpoint — returns the list of tenant (org) connections. */
const XERO_CONNECTIONS_ENDPOINT = "https://api.xero.com/connections";

/**
 * Read-only scopes requested from Xero.
 * `offline_access` is required to receive a refresh token.
 * `accounting.transactions.read` and `accounting.accounts.read` are the only
 * data scopes — no write scopes are ever requested.
 */
const XERO_SCOPES =
  "offline_access accounting.transactions.read accounting.accounts.read openid email profile";

/**
 * Builds the Xero OAuth2 authorization URL with PKCE (S256) challenge.
 *
 * PKCE parameters are appended manually because we generate them independently
 * of xero-node's OIDC client to avoid state management issues between requests.
 *
 * @param state       - Random CSRF state token stored in the httpOnly cookie.
 * @param codeChallenge - SHA-256(base64url(codeVerifier)), base64url-encoded.
 * @param redirectUri - Must match the URI registered in the Xero developer portal.
 * @throws {Error} When XERO_CLIENT_ID is not configured.
 */
export function buildXeroAuthUrl(
  state: string,
  codeChallenge: string,
  redirectUri: string,
): string {
  if (!env.XERO_CLIENT_ID) {
    throw new Error(
      "Xero OAuth is not configured. Ensure XERO_CLIENT_ID is set in your environment.",
    );
  }

  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.XERO_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: XERO_SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  return `${XERO_AUTH_ENDPOINT}?${params.toString()}`;
}

/**
 * Exchanges an authorization code for access + refresh tokens.
 *
 * Uses HTTP Basic auth (clientId:clientSecret) as required by Xero's token
 * endpoint. The code_verifier is sent to complete the PKCE exchange.
 *
 * @param code        - Authorization code from the Xero callback query param.
 * @param codeVerifier - The PKCE code verifier stored in the httpOnly cookie.
 * @param redirectUri - Must match the URI used in the authorization request.
 * @throws {Error} When the token endpoint returns a non-200 status.
 */
export async function exchangeXeroCode(
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<XeroTokenResponse> {
  if (!env.XERO_CLIENT_ID || !env.XERO_CLIENT_SECRET) {
    throw new Error(
      "Xero OAuth credentials are not configured. " +
        "Ensure XERO_CLIENT_ID and XERO_CLIENT_SECRET are set in your environment.",
    );
  }

  const credentials = Buffer.from(`${env.XERO_CLIENT_ID}:${env.XERO_CLIENT_SECRET}`).toString(
    "base64",
  );

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });

  const response = await fetch(XERO_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
      Accept: "application/json",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    // Xero token error responses are JSON error codes — safe to log, no tokens.
    const errorBody = await response.text();
    throw new Error(`Xero token exchange failed: HTTP ${response.status} — ${errorBody}`);
  }

  return (await response.json()) as XeroTokenResponse;
}

/**
 * Refreshes an expired Xero access token using the stored refresh token.
 *
 * ROTATING refresh tokens: the response always includes a new refresh_token.
 * The caller MUST persist both the new access_token and new refresh_token
 * atomically. The old refresh token is immediately invalidated by Xero.
 *
 * @param refreshToken - The plaintext (decrypted) refresh token.
 * @throws {Error} When the refresh endpoint returns a non-200 status.
 */
export async function refreshXeroToken(refreshToken: string): Promise<XeroTokenResponse> {
  if (!env.XERO_CLIENT_ID || !env.XERO_CLIENT_SECRET) {
    throw new Error(
      "Xero OAuth credentials are not configured. " +
        "Ensure XERO_CLIENT_ID and XERO_CLIENT_SECRET are set in your environment.",
    );
  }

  const credentials = Buffer.from(`${env.XERO_CLIENT_ID}:${env.XERO_CLIENT_SECRET}`).toString(
    "base64",
  );

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const response = await fetch(XERO_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
      Accept: "application/json",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Xero token refresh failed: HTTP ${response.status} — ${errorBody}`);
  }

  return (await response.json()) as XeroTokenResponse;
}

/**
 * Returns the first Xero organisation (tenant) ID accessible to the token.
 *
 * Xero requires a tenantId on every accounting API call. After OAuth, there
 * is typically one tenant (the connected organisation). If the user has
 * multiple organisations under their Xero account, we take the first
 * ORGANISATION-type tenant.
 *
 * The tenantId is stored in `connections.realmId` so this call is only needed
 * once — during the OAuth callback.
 *
 * @param accessToken - The plaintext access token (not encrypted).
 * @throws {Error} When no tenants are accessible or the /connections call fails.
 */
export async function getXeroTenantId(accessToken: string): Promise<string> {
  const response = await fetch(XERO_CONNECTIONS_ENDPOINT, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Xero /connections call failed: HTTP ${response.status} — ${errorBody}`);
  }

  const tenants = (await response.json()) as XeroTenantConnection[];

  // Prefer an ORGANISATION-type tenant (as opposed to PRACTICE or other types).
  const first = tenants.find((t) => t.tenantType === "ORGANISATION") ?? tenants[0];
  if (!first) {
    throw new Error(
      "No Xero tenants found for this access token. " +
        "The user must grant access to at least one Xero organisation.",
    );
  }

  return first.tenantId;
}

/**
 * Returns the first Xero organisation name for `connections.providerCompanyName`.
 * Returns null if no tenants exist or tenantName is absent.
 *
 * @param accessToken - The plaintext access token (not encrypted).
 */
export async function getXeroTenantName(accessToken: string): Promise<string | null> {
  try {
    const response = await fetch(XERO_CONNECTIONS_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) return null;

    const tenants = (await response.json()) as XeroTenantConnection[];
    const first = tenants.find((t) => t.tenantType === "ORGANISATION") ?? tenants[0];
    return first?.tenantName ?? null;
  } catch {
    return null;
  }
}

/**
 * Returns `true` if the granted scope string contains any Xero write scopes.
 *
 * Allowed: offline_access, accounting.transactions.read,
 *          accounting.accounts.read, openid, email, profile
 * Prohibited: accounting.transactions (write), payroll.*, files.*
 *
 * This function is the application-layer enforcement of the product's
 * read-only data sovereignty promise. It runs on every callback.
 */
export function containsXeroWriteScopes(scope: string | undefined): boolean {
  if (!scope) return false;
  const prohibited = [
    "accounting.transactions ", // write (not .read)
    "accounting.transactions\t", // edge case
    "payroll.",
    "files.",
    "accounting.budgets",
  ];
  const normalised = ` ${scope} `;
  return prohibited.some((p) => normalised.includes(p));
}
