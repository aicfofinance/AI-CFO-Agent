/**
 * Integration types — QB, Xero, and CSV API response shapes.
 *
 * This file is the sole owner of integration-layer type definitions.
 * Owned by: integration-engineer
 *
 * Types are added here as integration steps are implemented. Keeping
 * all external-API shapes in one file makes the mapping from external
 * fields → internal columns auditable in a single location.
 */

// ─── QuickBooks ───────────────────────────────────────────────────────────────

/**
 * QuickBooks environment values as returned by the OAuth flow.
 * Mirrors the QB_ENVIRONMENT env variable constraint.
 */
export type QBEnvironment = "sandbox" | "production";

/**
 * Minimal shape of a successful QB OAuth token exchange response.
 * Full token data is held internally by the OAuthClient Token instance.
 */
export type QBTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in: number;
  token_type: string;
  realmId?: string;
};

// ─── Xero ─────────────────────────────────────────────────────────────────────

// Xero types will be added in Phase 12 (Step 12.0+).

// ─── CSV ──────────────────────────────────────────────────────────────────────

// CSV types will be added in the CSV import steps.
