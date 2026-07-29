/**
 * QuickBooks API client factory.
 *
 * This module is the single entry point for obtaining an authenticated
 * node-quickbooks client instance. It handles:
 *   1. Fetching the persisted (encrypted) OAuth tokens from the database.
 *   2. Proactive token refresh when the access token is within 5 minutes of
 *      expiry — preventing a mid-sync 401 for long-running import jobs.
 *   3. Atomic persistence of the new token pair on refresh — QuickBooks uses
 *      ROTATING refresh tokens: every successful refresh call invalidates the
 *      old refresh token and issues a new one. Failing to write the new token
 *      pair back before returning would lock the org out permanently.
 *   4. Error classification per CLAUDE.md:
 *      - Refresh failure → `sync_status = 'auth_expired'`, re-throw so the
 *        caller (single-org.ts) can stop the sync job without retrying.
 *
 * Security invariants maintained throughout:
 *   - Plaintext access_token and refresh_token values are never logged.
 *   - Tokens are decrypted only for the duration of this function call.
 *   - Log lines contain only { connectionId, orgId } for correlation.
 */

import QuickBooks from "node-quickbooks";

import { eq } from "drizzle-orm";

import { db } from "@/lib/platform/db/client";
import { connections } from "@/lib/platform/db/schema";
import { decryptToken, encryptToken } from "@/lib/platform/security/encryption";
import { createOAuthClient } from "@/lib/integrations/quickbooks/auth";
import { env } from "@/lib/env";

/**
 * Milliseconds before access-token expiry at which a proactive refresh is
 * triggered. Five minutes gives an in-progress sync job enough runway to
 * complete without hitting a mid-run 401 on a nearly-expired token.
 */
const PROACTIVE_REFRESH_BUFFER_MS = 5 * 60 * 1000;

/**
 * Returns an authenticated node-quickbooks client for the given connection.
 *
 * Decrypts the stored access token (and refresh token if present), performs a
 * proactive refresh if the token is expired or within the refresh buffer window,
 * and returns a configured QuickBooks instance using the (possibly refreshed)
 * plaintext tokens.
 *
 * @param connectionId - UUID primary key of the `connections` row.
 * @returns An authenticated `QuickBooks` client instance.
 *
 * @throws {Error} with message `'CONNECTION_NOT_FOUND'` if no row exists.
 * @throws {Error} with message `'REALM_ID_MISSING'` if the row has no realm_id.
 * @throws {Error} with message `'QB_CREDENTIALS_NOT_CONFIGURED'` if
 *   `QB_CLIENT_ID` or `QB_CLIENT_SECRET` are absent from the environment.
 * @throws Re-throws the error from `oauthClient.refresh()` after setting
 *   `sync_status = 'auth_expired'` — the caller must not retry with a dead token.
 */
export async function getQuickBooksClient(connectionId: string): Promise<QuickBooks> {
  // ── 1. Load the connection row ────────────────────────────────────────────

  const rows = await db.select().from(connections).where(eq(connections.id, connectionId));

  const connection = rows[0];
  if (!connection) {
    throw new Error("CONNECTION_NOT_FOUND");
  }

  if (!connection.realmId) {
    throw new Error("REALM_ID_MISSING");
  }

  const { orgId, realmId } = connection;

  // ── 2. Validate QB app credentials are configured ────────────────────────
  // createOAuthClient() also validates these, but we surface the error here
  // for a cleaner error message before decrypting tokens unnecessarily.

  const clientId = env.QB_CLIENT_ID;
  const clientSecret = env.QB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("QB_CREDENTIALS_NOT_CONFIGURED: QB_CLIENT_ID and QB_CLIENT_SECRET must be set");
  }

  // ── 3. Decrypt stored tokens ──────────────────────────────────────────────
  // NEVER log the plaintext values of these variables.

  let accessToken = decryptToken(connection.accessTokenEncrypted);
  let refreshToken: string | null = connection.refreshTokenEncrypted
    ? decryptToken(connection.refreshTokenEncrypted)
    : null;

  // ── 4. Check expiry and refresh proactively if needed ────────────────────

  const now = Date.now();
  // If tokenExpiry is null we treat the token as already expired (conservative)
  // so that a missing expiry forces a refresh rather than sending a dead token.
  const expiryMs = connection.tokenExpiry ? connection.tokenExpiry.getTime() : 0;
  const isExpiredOrExpiring = expiryMs - now < PROACTIVE_REFRESH_BUFFER_MS;

  if (isExpiredOrExpiring) {
    const oauthClient = createOAuthClient();

    // Set current tokens so the refresh request is authenticated correctly.
    oauthClient.setToken({
      access_token: accessToken,
      refresh_token: refreshToken ?? "",
    });

    try {
      const refreshResponse = await oauthClient.refresh();
      const newToken = refreshResponse.getToken();

      // Encrypt the new token pair before any await so we never hold
      // plaintext tokens across async boundaries longer than necessary.
      const newAccessTokenEncrypted = encryptToken(newToken.access_token);
      const newRefreshTokenEncrypted = newToken.refresh_token
        ? encryptToken(newToken.refresh_token)
        : null;

      // expires_in is in seconds; add to current time for absolute expiry.
      const newTokenExpiry = new Date(Date.now() + newToken.expires_in * 1000);

      // Persist the new token pair. This MUST succeed before we return the
      // client — if the write fails, the next call will attempt a refresh
      // using the still-valid old refresh token (the new one was issued but
      // never stored, so Intuit will accept the old one until it is used).
      if (newRefreshTokenEncrypted !== null) {
        await db
          .update(connections)
          .set({
            accessTokenEncrypted: newAccessTokenEncrypted,
            refreshTokenEncrypted: newRefreshTokenEncrypted,
            tokenExpiry: newTokenExpiry,
            syncStatus: "active",
          })
          .where(eq(connections.id, connectionId));
      } else {
        await db
          .update(connections)
          .set({
            accessTokenEncrypted: newAccessTokenEncrypted,
            tokenExpiry: newTokenExpiry,
            syncStatus: "active",
          })
          .where(eq(connections.id, connectionId));
      }

      console.log({
        event: "qb_token_refreshed",
        connectionId,
        orgId,
      });

      // Use the freshly decrypted tokens for the QB client below.
      accessToken = newToken.access_token;
      if (newToken.refresh_token) {
        refreshToken = newToken.refresh_token;
      }
    } catch (error) {
      // Refresh failed — token is dead. Mark the connection so the fan-out
      // job skips it on the next run, and notify the caller to stop the sync.
      // Do not retry: retrying with an expired token produces more 401s.
      console.error({
        event: "qb_token_refresh_failed",
        connectionId,
        orgId,
        errorMessage: error instanceof Error ? error.message : String(error),
      });

      await db
        .update(connections)
        .set({ syncStatus: "auth_expired" })
        .where(eq(connections.id, connectionId));

      throw error;
    }
  }

  // ── 5. Instantiate and return the QuickBooks client ──────────────────────

  const isSandbox = env.QB_ENVIRONMENT !== "production";

  return new QuickBooks(
    clientId,
    clientSecret,
    accessToken,
    false, // tokenSecret — not used for OAuth 2.0
    realmId,
    isSandbox,
    false, // debug — keep off in all environments
    null, // minorversion — use library default (4)
    "2.0", // OAuth version
    refreshToken, // refresh_token — for QB's internal use
  );
}
