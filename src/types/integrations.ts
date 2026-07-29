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

/**
 * Shape of the Xero token endpoint response (both initial exchange and refresh).
 *
 * Token lifecycle:
 *   - access_token:  30 minutes (expires_in = 1800)
 *   - refresh_token: 60 days, ROTATING — every refresh call returns a new
 *     refresh token; the old one is immediately invalidated. The new pair
 *     MUST be persisted atomically before the old token is discarded.
 */
export type XeroTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
};

/**
 * A normalised Xero transaction ready for insertion into the `transactions`
 * table. All monetary values are exact decimal strings; dates are 'YYYY-MM-DD'.
 *
 * NOTE: CLAUDE.md requires normalize.ts to return `NormalizedTransaction` from
 * `src/types/financial.ts`. That file is an empty stub at this implementation
 * stage (owned by backend-engineer). This type fulfils the same contract and
 * should be unified with `financial.ts` when backend-engineer adds
 * `NormalizedTransaction` there.
 */
export type NormalizedXeroTransaction = {
  /** Prefixed Xero UUID: 'invoice-{id}' or 'banktxn-{id}'. */
  externalId: string;
  /** 'YYYY-MM-DD' date string from the Xero response. */
  transactionDate: string;
  /** Always a positive decimal string (e.g. '125.00'). */
  amount: string;
  /** ISO 4217 currency code (e.g. 'USD', 'GBP'). */
  currencyCode: string;
  /** One of: 'income' | 'expense' | 'transfer' | 'adjustment'. */
  transactionType: string;
  /** One of the 15 internal categories or 'other'. */
  category: string;
  description: string | null;
  vendorName: string | null;
  referenceNumber: string | null;
  isReconciled: boolean;
  /**
   * The raw account name or description submitted to `mapToInternalCategory()`.
   * Non-null means a name was available; used to decide whether to write to
   * `data_quality_log` (only log when we had a name but could not map it).
   */
  categorySource: string | null;
};

/**
 * A Xero tenant (organisation) connection as returned by the /connections
 * endpoint. Used to resolve the tenantId after OAuth.
 */
export type XeroTenantConnection = {
  id: string;
  tenantId: string;
  tenantType: string;
  tenantName?: string;
};

// ─── CSV ──────────────────────────────────────────────────────────────────────

// CSV types will be added in the CSV import steps.
