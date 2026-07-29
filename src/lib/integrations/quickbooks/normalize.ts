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

// ─── Transaction category normalization (Step 4.6) ───────────────────────────

/**
 * QB field mapping for transaction categories.
 *
 * Source field                         Internal column         Null handling
 * ──────────────────────────────────────────────────────────────────────────────
 * AccountRef.name (root or line item)  transactions.category   no match → 'other'
 * ItemRef.name (invoice line items)    transactions.category   fallback only
 *
 * Matching strategy:
 *   1. `accountRefName` is scanned first against the ordered keyword list.
 *   2. If `accountRefName` does not match, `itemRefName` is scanned as a fallback.
 *   3. The first matching entry wins; entries are ordered from most-specific to
 *      least-specific to prevent false positives (e.g., 'service charge' is
 *      checked before the broader 'service' keyword).
 *   4. If neither name matches any pattern, the function returns `'other'`.
 *
 * Callers are responsible for logging transactions where category = 'other'
 * (and where a name was available but unrecognised) to `data_quality_log`.
 * This ensures unmapped QB accounts are observable without being silently lost.
 *
 * Intentionally dropped QB category fields for V1:
 *   - Sub-account names    Flattened to parent account name; sub-account detail
 *                          not required for the 15-category schema.
 *   - Tax-line details     Only the containing account name keyword is used;
 *                          individual tax line code values are out of scope.
 */

/**
 * Ordered list of QB account-name keyword patterns mapped to internal
 * transaction categories.
 *
 * Ordering constraints:
 *   - Multi-word phrases (e.g. 'contract labor') come before single keywords
 *     that could partially match them (e.g. 'labor').
 *   - 'service charge' precedes 'service' to prevent "Service Charge" from
 *     falling through to 'revenue'.
 *   - 'cost of goods' precedes both 'cost' and 'goods'.
 */
const QB_CATEGORY_PATTERNS: ReadonlyArray<{
  readonly patterns: string[];
  readonly category: string;
}> = [
  { patterns: ["advertising", "marketing"], category: "advertising_marketing" },
  {
    patterns: ["contract labor", "subcontract", "freelance", "contractor"],
    category: "contractors",
  },
  { patterns: ["payroll", "salaries", "salary", "wages", "wage"], category: "payroll" },
  { patterns: ["rent", "lease"], category: "rent_lease" },
  // 'utilit' catches 'utility', 'utilities', 'utilitarian' etc.
  {
    patterns: [
      "utilit",
      "electric",
      "gas and electric",
      "water and sewer",
      "telephone",
      "internet",
    ],
    category: "utilities",
  },
  { patterns: ["insurance"], category: "insurance" },
  { patterns: ["travel", "airfare", "lodging", "hotel"], category: "travel" },
  { patterns: ["meals", "entertainment", "dining", "restaurant"], category: "meals_entertainment" },
  // 'office supplies' must come before the broader 'supplies' to avoid
  // false-matching "Janitorial Supplies" → 'office_supplies'.
  { patterns: ["office supplies", "office supply", "stationery"], category: "office_supplies" },
  {
    patterns: ["software", "subscription", "saas", "computer and internet", "cloud service"],
    category: "software_subscriptions",
  },
  // Multi-word bank-charge phrases before the bare 'service' keyword.
  {
    patterns: [
      "bank charge",
      "bank fee",
      "service charge",
      "service fee",
      "merchant fee",
      "processing fee",
      "finance charge",
      "payment processing",
    ],
    category: "bank_charges",
  },
  {
    patterns: ["professional", "legal", "accounting", "audit", "consulting"],
    category: "professional_services",
  },
  { patterns: ["tax", "license", "permit", "registration"], category: "taxes_licenses" },
  // 'cost of goods' and its variants before any shorter keyword.
  {
    patterns: ["cost of goods", "cogs", "cost of sales"],
    category: "cost_of_goods_sold",
  },
  // Broad income/revenue keywords — checked last to avoid short-circuiting
  // more specific patterns above (e.g. 'service' also appears in bank charges).
  { patterns: ["income", "revenue", "sales", "services"], category: "revenue" },
];

/**
 * Maps a QB AccountRef name (and optional ItemRef name) to one of the 15
 * internal transaction categories.
 *
 * Returns `'other'` when neither name matches any known pattern. The caller
 * must log this case to `data_quality_log` when a non-null name was supplied,
 * so unmapped QB account names are observable in the data quality dashboard.
 *
 * @param accountRefName - `AccountRef.name` from the QB transaction or line item.
 *   This is the chart-of-accounts entry (e.g. "Advertising & Marketing").
 * @param itemRefName    - `ItemRef.name` from invoice/credit-memo line items.
 *   Checked as a fallback when `accountRefName` produces no match.
 * @returns One of the 15 internal category strings or `'other'`.
 */
export function normalizeQBCategory(
  accountRefName: string | undefined | null,
  itemRefName?: string | undefined | null,
): string {
  for (const candidate of [accountRefName, itemRefName]) {
    if (!candidate) continue;
    const lower = candidate.toLowerCase();
    for (const { patterns, category } of QB_CATEGORY_PATTERNS) {
      for (const pattern of patterns) {
        if (lower.includes(pattern)) {
          return category;
        }
      }
    }
  }
  return "other";
}
