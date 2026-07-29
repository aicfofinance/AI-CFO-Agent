/**
 * Xero authenticated client factory.
 *
 * Decrypts the stored access/refresh tokens, performs a proactive refresh when
 * the access token is within 2 minutes of expiry, and returns an authenticated
 * `XeroClient` instance ready for accounting API calls.
 *
 * Token lifecycle:
 *   - Xero access tokens expire in 30 minutes (vs QB's 60 minutes).
 *   - Refresh tokens ROTATE: every successful refresh returns a new refresh
 *     token; the old one is immediately invalidated. The new pair is persisted
 *     atomically before the call returns.
 *
 * Security:
 *   - `orgId` is always read from the database `connections` row — never from
 *     caller input (CLAUDE.md multi-tenancy rules).
 *   - Token values are decrypted in memory only and never logged.
 *   - A 401 from the refresh endpoint sets `sync_status = 'auth_expired'` and
 *     rethrows so the Inngest step stops and does not retry (CLAUDE.md).
 */

import { eq } from "drizzle-orm";
import { XeroClient } from "xero-node";

import { env } from "@/lib/env";
import { db } from "@/lib/platform/db/client";
import { connections } from "@/lib/platform/db/schema";
import { decryptToken, encryptToken } from "@/lib/platform/security/encryption";
import { refreshXeroToken } from "@/lib/integrations/xero/auth";

/** Proactive refresh threshold: refresh if expiry is within 2 minutes. */
const REFRESH_THRESHOLD_MS = 2 * 60 * 1000;

/**
 * Returns the result of `getXeroClient`.
 */
export type XeroClientResult = {
  /** Authenticated XeroClient with the accountingApi ready for use. */
  xero: XeroClient;
  /** Xero tenant (organisation) ID stored in connections.realmId. */
  tenantId: string;
  /** Internal org UUID for org-scoped queries. */
  orgId: string;
};

/**
 * Builds and returns an authenticated XeroClient for the given connection.
 *
 * Step order:
 * 1. Read connection row from DB — orgId, tokens, tokenExpiry, realmId/tenantId.
 * 2. Decrypt access and refresh tokens.
 * 3. If access token is within REFRESH_THRESHOLD_MS of expiry:
 *    a. Call refreshXeroToken() with the decrypted refresh token.
 *    b. Persist the new encrypted token pair atomically to the connections row.
 *    c. Update tokenExpiry with the new expiry time.
 * 4. Create a XeroClient, set the token, call updateTenants() to authenticate
 *    the accountingApi. updateTenants() calls Xero's /connections endpoint once
 *    to set the Authorization header on every subsequent API call.
 * 5. Return { xero, tenantId, orgId }.
 *
 * Error handling (CLAUDE.md):
 *   - 401 from the refresh endpoint → set sync_status='auth_expired', rethrow.
 *     Never retry with an expired token.
 *   - Any other refresh error → set sync_status='failed', rethrow.
 *   - Missing connection row → throw with a clear message (security error).
 *
 * @param connectionId - UUID primary key of the `connections` row.
 * @throws {Error} For auth_expired, missing connection, or token decryption failure.
 */
export async function getXeroClient(connectionId: string): Promise<XeroClientResult> {
  // ── 1. Read connection row ──────────────────────────────────────────────────
  const connectionRows = await db
    .select({
      orgId: connections.orgId,
      accessTokenEncrypted: connections.accessTokenEncrypted,
      refreshTokenEncrypted: connections.refreshTokenEncrypted,
      tokenExpiry: connections.tokenExpiry,
      realmId: connections.realmId,
    })
    .from(connections)
    .where(eq(connections.id, connectionId));

  const connection = connectionRows[0];
  if (!connection) {
    throw new Error(`XERO_CLIENT_CONNECTION_NOT_FOUND: connectionId=${connectionId}`);
  }

  const { orgId, realmId } = connection;

  if (!realmId) {
    throw new Error(
      `XERO_CLIENT_MISSING_TENANT_ID: connectionId=${connectionId} — ` +
        "realmId (Xero tenantId) is null. The connection may be incomplete.",
    );
  }

  // ── 2. Decrypt tokens ──────────────────────────────────────────────────────
  // Tokens are never logged. Only { connectionId, orgId, provider } appears in logs.
  let accessToken: string;
  let refreshToken: string;
  let tokenExpiry = connection.tokenExpiry;

  try {
    accessToken = decryptToken(connection.accessTokenEncrypted);
    refreshToken = connection.refreshTokenEncrypted
      ? decryptToken(connection.refreshTokenEncrypted)
      : "";
  } catch (err) {
    console.error({
      event: "xero_client_token_decrypt_failed",
      connectionId,
      orgId,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw new Error(`XERO_CLIENT_TOKEN_DECRYPT_FAILED: connectionId=${connectionId}`);
  }

  // ── 3. Proactive refresh ───────────────────────────────────────────────────
  // Xero tokens expire in 30 minutes. Refresh proactively if within 2 minutes
  // of expiry to prevent mid-sync expiry.
  const isExpiringSoon =
    tokenExpiry !== null && tokenExpiry.getTime() - Date.now() < REFRESH_THRESHOLD_MS;

  if (isExpiringSoon || !tokenExpiry) {
    if (!refreshToken) {
      // Cannot refresh without a refresh token — treat as auth_expired.
      await db
        .update(connections)
        .set({ syncStatus: "auth_expired" })
        .where(eq(connections.id, connectionId));

      console.error({
        event: "xero_client_no_refresh_token",
        connectionId,
        orgId,
      });
      throw new Error(
        `XERO_CLIENT_AUTH_EXPIRED: connectionId=${connectionId} — ` +
          "no refresh token available; user must reconnect via OAuth.",
      );
    }

    let newTokens: Awaited<ReturnType<typeof refreshXeroToken>>;
    try {
      newTokens = await refreshXeroToken(refreshToken);
    } catch (refreshErr) {
      // Check if this is a 401 (token revoked or expired at Xero).
      const errMessage = refreshErr instanceof Error ? refreshErr.message : String(refreshErr);
      const isAuthExpired =
        errMessage.includes("HTTP 401") ||
        errMessage.includes("HTTP 400") || // Xero returns 400 for invalid refresh token
        errMessage.includes("invalid_grant");

      const newStatus = isAuthExpired ? "auth_expired" : "failed";

      await db
        .update(connections)
        .set({ syncStatus: newStatus })
        .where(eq(connections.id, connectionId));

      console.error({
        event: "xero_client_token_refresh_failed",
        connectionId,
        orgId,
        syncStatus: newStatus,
        errorMessage: errMessage,
      });

      throw new Error(
        `XERO_CLIENT_TOKEN_REFRESH_FAILED: connectionId=${connectionId} ` +
          `syncStatus=${newStatus} — ${errMessage}`,
      );
    }

    // Persist the new (rotating) token pair atomically. The old refresh token
    // is now invalid at Xero — if this update fails, the user is locked out.
    const newAccessTokenEncrypted = encryptToken(newTokens.access_token);
    const newRefreshTokenEncrypted = encryptToken(newTokens.refresh_token);
    const newExpiry = new Date(Date.now() + newTokens.expires_in * 1000);

    await db
      .update(connections)
      .set({
        accessTokenEncrypted: newAccessTokenEncrypted,
        refreshTokenEncrypted: newRefreshTokenEncrypted,
        tokenExpiry: newExpiry,
      })
      .where(eq(connections.id, connectionId));

    // Use fresh tokens for the API call below.
    accessToken = newTokens.access_token;
    tokenExpiry = newExpiry;

    console.log({
      event: "xero_client_token_refreshed",
      connectionId,
      orgId,
    });
  }

  // ── 4. Build authenticated XeroClient ─────────────────────────────────────
  // Create a XeroClient, set the token, then call updateTenants() to set the
  // Authorization header on the accountingApi. updateTenants() makes one network
  // call to Xero's /connections endpoint (which we accept as the cost of
  // correct authentication setup).
  if (!env.XERO_CLIENT_ID || !env.XERO_CLIENT_SECRET) {
    throw new Error(
      "Xero OAuth credentials are not configured. " +
        "Ensure XERO_CLIENT_ID and XERO_CLIENT_SECRET are set in your environment.",
    );
  }

  const xero = new XeroClient({
    clientId: env.XERO_CLIENT_ID,
    clientSecret: env.XERO_CLIENT_SECRET,
  });

  xero.setTokenSet({ access_token: accessToken, token_type: "Bearer" });

  try {
    await xero.updateTenants(false);
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    const isAuthExpired =
      errMessage.includes("401") ||
      errMessage.includes("403") ||
      errMessage.includes("Unauthorized");

    if (isAuthExpired) {
      await db
        .update(connections)
        .set({ syncStatus: "auth_expired" })
        .where(eq(connections.id, connectionId));
    }

    console.error({
      event: "xero_client_update_tenants_failed",
      connectionId,
      orgId,
      errorMessage: errMessage,
    });
    throw err;
  }

  return { xero, tenantId: realmId, orgId };
}
