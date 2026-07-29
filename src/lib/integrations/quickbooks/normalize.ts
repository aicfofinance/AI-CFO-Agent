/**
 * QuickBooks → internal schema normalization utilities.
 *
 * This file currently covers Chart of Accounts normalization (Step 4.5).
 * Transaction normalization will be added in Step 4.7.
 *
 * ─── Account field mapping ───────────────────────────────────────────────────
 *
 * Source field         Internal column              Null handling
 * ─────────────────────────────────────────────────────────────────────────────
 * AccountType (string) accounts.accountType         empty/null → 'asset' (safe default)
 * Name (string)        accounts.name                null/empty/whitespace → returns null
 *                                                   (caller logs to data_quality_log)
 *
 * Intentionally dropped QB account fields (not stored):
 *   - SyncToken          QB concurrency control, not needed for read-only import
 *   - FullyQualifiedName Redundant with Name for our use case
 *   - Classification     Redundant with AccountType
 *   - SubAccount         Boolean flag, not stored
 *   - TaxCodeRef         Tax reference, not in scope for V1
 *   - MetaData           QB audit timestamps, we maintain our own
 *   - sparse             Various sparse fields not relevant to financial analysis
 */

/**
 * Maps QuickBooks `AccountType` values to the internal `account_type` schema.
 *
 * Internal account_type values: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'
 *
 * Source: QuickBooks Online API v3 AccountType enum
 * Reference: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/account
 */
const QB_ACCOUNT_TYPE_MAP: Record<string, string> = {
  Bank: "asset",
  "Accounts Receivable": "asset",
  "Other Current Asset": "asset",
  "Fixed Asset": "asset",
  "Other Asset": "asset",
  "Accounts Payable": "liability",
  "Credit Card": "liability",
  "Long Term Liability": "liability",
  "Other Current Liability": "liability",
  Equity: "equity",
  Income: "revenue",
  "Other Income": "revenue",
  "Cost of Goods Sold": "expense",
  Expense: "expense",
  "Other Expense": "expense",
} as const;

/**
 * Maps a QuickBooks `AccountType` string to the internal `account_type` value.
 *
 * Any value not present in the mapping falls back to `'asset'` — this is a safe
 * default because unknown types in QB are almost always asset-side accounts
 * (bank accounts, receivables, clearing accounts). The fallback should be rare;
 * if it fires frequently it indicates a new QB account type that needs mapping.
 *
 * @param qbAccountType - The raw `AccountType` string from the QB API response.
 * @returns Internal account type string.
 */
export function normalizeAccountType(qbAccountType: string): string {
  return QB_ACCOUNT_TYPE_MAP[qbAccountType] ?? "asset";
}

/**
 * Normalizes a QB account name for storage.
 *
 * - Returns `null` if the input is falsy or whitespace-only (caller must log to
 *   `data_quality_log` and skip the account).
 * - Trims leading/trailing whitespace.
 * - Truncates to 255 characters to fit `accounts.name VARCHAR(255)`.
 *
 * @param name - The raw `Name` string from the QB API response.
 * @returns Trimmed name string (max 255 chars), or `null` if the name is absent.
 */
export function normalizeAccountName(name: string | undefined | null): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > 255 ? trimmed.slice(0, 255) : trimmed;
}
