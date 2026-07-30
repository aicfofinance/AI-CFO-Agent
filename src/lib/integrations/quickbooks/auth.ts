/**
 * QuickBooks OAuth 2.0 client factory.
 *
 * This module is the single entry point for creating an authenticated
 * QuickBooks OAuth client. It does NOT handle token persistence —
 * that is the responsibility of the callback route (Step 4.3) which
 * encrypts tokens with encryptToken() before writing to the database.
 *
 * QuickBooks token lifecycle (must be understood before extending this file):
 *   - Access token:  expires in 1 hour
 *   - Refresh token: expires in 100 days
 *   - ROTATING refresh tokens: every successful refresh call returns a
 *     NEW refresh token. The old one is immediately invalidated. The
 *     caller must persist the new token pair to the database atomically
 *     after every refresh. Failing to do so locks the user out.
 *
 * Scopes used by this app: com.intuit.quickbooks.accounting (read-only).
 * Write scopes are rejected at the callback layer (Step 4.3).
 */

import OAuthClient from "intuit-oauth";
import { env } from "@/lib/env";

/**
 * The OAuth redirect URI registered in the Intuit developer console.
 * Must match exactly — including protocol, host, port, and path.
 *
 * Derived from NEXT_PUBLIC_APP_URL so the same code works in local dev,
 * preview deployments, and production without modification.
 */
const QB_REDIRECT_URI = `${env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/auth/quickbooks/callback`;

/**
 * Creates and returns a configured QuickBooks OAuthClient instance.
 *
 * Reads credentials from the validated environment object (never from
 * process.env directly). Throws a descriptive error if any of the three
 * required QB environment variables are absent so the caller receives a
 * clear message rather than a cryptic OAuth failure downstream.
 *
 * @throws {Error} When QB_CLIENT_ID, QB_CLIENT_SECRET, or QB_ENVIRONMENT
 *   are not set in the environment. This is a configuration error, not a
 *   runtime error — it should surface immediately on startup.
 *
 * @returns A fully configured OAuthClient instance ready for use in
 *   the OAuth initiation and callback flows.
 */
export function createOAuthClient(): OAuthClient {
  const clientId = env.QB_CLIENT_ID;
  const clientSecret = env.QB_CLIENT_SECRET;
  const environment = env.QB_ENVIRONMENT;

  if (!clientId || !clientSecret || !environment) {
    throw new Error(
      "QuickBooks OAuth credentials are not configured. " +
        "Ensure QB_CLIENT_ID, QB_CLIENT_SECRET, and QB_ENVIRONMENT are set in your environment.",
    );
  }

  return new OAuthClient({
    clientId,
    clientSecret,
    environment,
    redirectUri: QB_REDIRECT_URI,
  });
}
