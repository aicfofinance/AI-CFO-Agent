/**
 * QuickBooks CSV transaction normalizer.
 *
 * Converts `ParsedCSVRow` objects (from `parser.ts`) into the internal
 * `NormalizedCSVTransaction` shape for upsert into the `transactions` table.
 *
 * ─── Field Mapping ─────────────────────────────────────────────────────────────
 *
 * Source column (QB CSV)     Internal field            Null / missing handling
 * ─────────────────────────────────────────────────────────────────────────────
 * Date                       transactionDate           empty → return null
 * Transaction Type           transactionType           via QB_TYPE_MAP; unmapped → 'other'
 * Num                        referenceNumber           empty → null (acceptable)
 * Name                       vendorName                empty → null (acceptable)
 * Memo/Description           description               empty → null (acceptable)
 * Amount (positive string)   amount                    empty → return null
 * Account                    categorySource →          null source → category='other', no DQ log
 *                              mapToInternalCategory()   non-null unmapped → category='other',
 *                              → category               caller logs to data_quality_log
 * (derived)                  externalId                'csv-' + sha256(date+type+amount+vendor)[0:16]
 * (constant)                 currencyCode              always 'USD' (QB CSV is USD-only in V1)
 * (constant)                 isReconciled              always false (CSV Clr column is unreliable)
 *
 * INTENTIONALLY DROPPED QB CSV COLUMNS:
 *   Clr     — reconciliation flag not reliable across QB export versions
 *   Split   — split-transaction indicator, not stored in internal schema
 *   Balance — running account balance, not a property of the transaction itself
 *
 * NULL HANDLING SUMMARY:
 *   - transactionDate empty  → return null (cannot place transaction in time)
 *   - amount empty/falsy     → return null (amount unknown)
 *   - transactionType empty  → return null (direction cannot be determined)
 *   - vendorName empty       → null (not required)
 *   - referenceNumber empty  → null (not required)
 *   - description empty      → null (not required)
 *   - categorySource null    → category='other', no DQ log entry needed
 *     (caller logs only when a non-null categorySource maps to 'other')
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createHash } from "crypto";

import { mapToInternalCategory } from "@/lib/financial/normalization/categories";
import type { NormalizedCSVTransaction } from "@/types/integrations";
import type { ParsedCSVRow } from "./parser";

// ─── QB Transaction Type → internal transactionType ───────────────────────────

/**
 * Maps QuickBooks transaction type strings (as they appear in the Transaction
 * Detail Report export) to the four-value internal `transaction_type` domain.
 *
 * Types absent from this map fall through to `'other'`, which is logged to
 * `data_quality_log` by the caller (`route.ts`) when encountered.
 */
const QB_TYPE_MAP: Record<string, string> = {
  Invoice: "income",
  "Sales Receipt": "income",
  "Credit Memo": "income",
  Bill: "expense",
  Check: "expense",
  Expense: "expense",
  "Credit Card Expense": "expense",
  Purchase: "expense",
  "Bill Payment (Check)": "expense",
  "Bill Payment (Credit Card)": "expense",
  Transfer: "transfer",
};

// ─── Normalizer ────────────────────────────────────────────────────────────────

/**
 * Normalizes a single `ParsedCSVRow` from a QB Transaction Detail Report into
 * the `NormalizedCSVTransaction` shape ready for upsert into `transactions`.
 *
 * Returns null when `transactionDate`, `amount`, or `transactionType` are
 * missing — those fields are required for a transaction to be safely stored.
 *
 * The `externalId` is a deterministic sha256-based hash so that re-uploading
 * the same CSV does not create duplicate rows: the upsert in the route handler
 * targets `(orgId, sourceSystem, externalId)`.
 *
 * @param row - A parsed row from `parseQBCSV()`.
 * @returns A normalized transaction shape, or null when required fields are absent.
 */
export function normalizeCSVRow(row: ParsedCSVRow): NormalizedCSVTransaction | null {
  // Guard: required identity and financial fields.
  if (!row.transactionDate) return null;
  if (!row.amount) return null;
  if (!row.transactionType) return null;

  const transactionType = QB_TYPE_MAP[row.transactionType] ?? "other";

  const category = mapToInternalCategory(row.categorySource);

  // Build a deterministic external ID from the transaction's identity fields.
  // 16 hex characters (64 bits) gives negligible collision probability within a
  // single org+source space while keeping the value compact for the VARCHAR(100)
  // column.
  const hashInput = `${row.transactionDate}${row.transactionType}${row.amount}${row.vendorName ?? ""}`;
  const externalId = "csv-" + createHash("sha256").update(hashInput).digest("hex").slice(0, 16);

  return {
    externalId,
    transactionDate: row.transactionDate,
    amount: row.amount,
    currencyCode: "USD",
    transactionType,
    category,
    description: row.description,
    vendorName: row.vendorName,
    referenceNumber: row.referenceNumber,
    isReconciled: false,
    categorySource: row.categorySource,
  };
}
