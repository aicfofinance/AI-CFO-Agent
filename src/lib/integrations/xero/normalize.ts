/**
 * Xero transaction normalizer.
 *
 * Converts `Invoice` and `BankTransaction` objects returned by xero-node into
 * the internal `NormalizedXeroTransaction` shape for upsert into the
 * `transactions` table.
 *
 * ─── Field Mapping ────────────────────────────────────────────────────────────
 *
 * INVOICE mapping:
 *   invoice.invoiceID         → externalId   "invoice-{invoiceID}"
 *   invoice.date              → transactionDate  YYYY-MM-DD string (date-only field, no conversion needed)
 *   invoice.total             → amount        Math.abs(total).toFixed(2); null total → return null
 *   invoice.currencyCode      → currencyCode  String; defaults to 'USD' if absent
 *   invoice.type (runtime str)→ transactionType  see INVOICE_TYPE_MAP below
 *   lineItems[0].accountCode  → categorySource (fed to mapToInternalCategory)
 *   lineItems[0].description  → description  null if absent
 *   contact.name              → vendorName   null if absent
 *   invoice.invoiceNumber     → referenceNumber  null if absent
 *   invoice.status === 'PAID' → isReconciled
 *
 * BANK TRANSACTION mapping:
 *   bankTxn.bankTransactionID → externalId   "banktxn-{bankTransactionID}"
 *   bankTxn.date              → transactionDate  YYYY-MM-DD string (date-only field)
 *   bankTxn.total             → amount        Math.abs(total).toFixed(2); null total → return null
 *   bankTxn.currencyCode      → currencyCode  String; defaults to 'USD' if absent
 *   bankTxn.type (runtime str)→ transactionType  see BANK_TX_TYPE_MAP below
 *   lineItems[0].accountCode  → categorySource (fed to mapToInternalCategory)
 *   lineItems[0].description  → description  null if absent
 *   contact.name              → vendorName   null if absent
 *   bankTxn.reference         → referenceNumber  null if absent
 *   bankTxn.isReconciled      → isReconciled  false if absent
 *
 * INTENTIONALLY DROPPED FIELDS:
 *   invoice.dueDate           — not used in internal schema
 *   invoice.lineAmountTypes   — tax treatment metadata, not needed
 *   invoice.subTotal          — we use `total` (tax-inclusive)
 *   invoice.totalTax          — not needed
 *   invoice.amountDue         — we snapshot full transaction amount
 *   invoice.repeatingInvoiceID— not needed
 *   bankTxn.bankAccount       — account metadata, not stored on transaction row
 *   bankTxn.lineAmountTypes   — see above
 *   bankTxn.subTotal          — see above
 *
 * NULL HANDLING:
 *   - A null/undefined `total` (amount) → return null (transaction is dropped).
 *   - A null/undefined `date` → return null (transaction cannot be placed in time).
 *   - A null/undefined `invoiceID` / `bankTransactionID` → return null (cannot dedup).
 *   - A null `currencyCode` → defaults to 'USD' with a console warning.
 *   - A null `contact.name` → vendorName: null (acceptable, not required).
 *   - Unknown or missing `type` → return null (transaction type cannot be determined).
 *
 * ─── xero-node Enum Runtime Warning ──────────────────────────────────────────
 *
 * xero-node's TypeScript declarations use numeric enums for Invoice.TypeEnum
 * and BankTransaction.TypeEnum. At runtime, however, the JavaScript values are
 * string literals ('ACCREC', 'SPEND', etc.) — not numbers. TypeScript's enum
 * comparison would always fail at runtime. We therefore use `String(tx.type)`
 * and compare against a string literal map to preserve correctness.
 */

import type { Invoice, BankTransaction } from "xero-node";

import { mapToInternalCategory } from "@/lib/financial/normalization/categories";
import type { NormalizedXeroTransaction } from "@/types/integrations";

// ─── Type maps ────────────────────────────────────────────────────────────────

/**
 * Maps the runtime string value of `Invoice.TypeEnum` to an internal
 * transaction type. Unknown values are mapped to null (caller must drop the row).
 */
const INVOICE_TYPE_MAP: Record<string, string> = {
  ACCREC: "income", // Accounts-receivable invoice (sales)
  ACCRECCREDIT: "income", // Credit note against AR invoice
  AROVERPAYMENT: "income", // AR overpayment
  ARPREPAYMENT: "income", // AR prepayment
  ACCPAY: "expense", // Accounts-payable bill (purchase)
  ACCPAYCREDIT: "expense", // Credit note against AP bill
  APOVERPAYMENT: "expense", // AP overpayment
  APPREPAYMENT: "expense", // AP prepayment
};

/**
 * Maps the runtime string value of `BankTransaction.TypeEnum` to an internal
 * transaction type. Transfer types map to 'transfer'; unknown → null.
 */
const BANK_TX_TYPE_MAP: Record<string, string> = {
  RECEIVE: "income", // Money received into bank account
  RECEIVEOVERPAYMENT: "income",
  RECEIVEPREPAYMENT: "income",
  SPEND: "expense", // Money spent from bank account
  SPENDOVERPAYMENT: "expense",
  SPENDPREPAYMENT: "expense",
  RECEIVETRANSFER: "transfer",
  SPENDTRANSFER: "transfer",
};

// ─── Invoice normalizer ───────────────────────────────────────────────────────

/**
 * Normalizes a Xero `Invoice` record into the internal transaction shape.
 *
 * Returns null for transactions that cannot be safely placed in the ledger:
 *   - Missing invoiceID (cannot be deduplicated)
 *   - Missing or zero date (cannot be placed in time)
 *   - Null `total` (amount unknown)
 *   - Unknown type (direction cannot be determined)
 *
 * @param invoice - A Xero Invoice object as returned by xero-node's accountingApi.
 */
export function normalizeXeroInvoice(invoice: Invoice): NormalizedXeroTransaction | null {
  // Guard: required identity and financial fields.
  if (!invoice.invoiceID) return null;
  if (!invoice.date) return null;
  if (invoice.total === null || invoice.total === undefined) return null;

  // Runtime string value of the TypeEnum (see module-level warning).
  const typeStr = String(invoice.type);
  const transactionType = INVOICE_TYPE_MAP[typeStr];
  if (!transactionType) {
    console.warn({
      event: "xero_normalize_invoice_unknown_type",
      invoiceID: invoice.invoiceID,
      type: typeStr,
    });
    return null;
  }

  const externalId = `invoice-${invoice.invoiceID}`;
  const amount = Math.abs(invoice.total).toFixed(2);

  // Currency: CurrencyCode is an enum, but at runtime it's a string.
  const currencyCode =
    invoice.currencyCode !== null && invoice.currencyCode !== undefined
      ? String(invoice.currencyCode)
      : "USD";

  // Category: use the first line item's account code as the category source.
  const firstLine = invoice.lineItems?.[0];
  const categorySource = firstLine?.accountCode ?? firstLine?.description ?? null;
  const category = mapToInternalCategory(categorySource);

  const description = firstLine?.description ?? null;
  const vendorName = invoice.contact?.name ?? null;
  const referenceNumber = invoice.invoiceNumber ?? null;
  const isReconciled = String(invoice.status) === "PAID";

  return {
    externalId,
    transactionDate: invoice.date,
    amount,
    currencyCode,
    transactionType,
    category,
    description,
    vendorName,
    referenceNumber,
    isReconciled,
    categorySource,
  };
}

// ─── BankTransaction normalizer ───────────────────────────────────────────────

/**
 * Normalizes a Xero `BankTransaction` record into the internal transaction shape.
 *
 * Returns null for transactions that cannot be safely placed in the ledger:
 *   - Missing bankTransactionID (cannot be deduplicated)
 *   - Missing date (cannot be placed in time)
 *   - Null `total` (amount unknown)
 *   - Unknown type (direction cannot be determined)
 *
 * @param bankTxn - A Xero BankTransaction object as returned by xero-node's accountingApi.
 */
export function normalizeXeroBankTransaction(
  bankTxn: BankTransaction,
): NormalizedXeroTransaction | null {
  // Guard: required identity and financial fields.
  if (!bankTxn.bankTransactionID) return null;
  if (!bankTxn.date) return null;
  if (bankTxn.total === null || bankTxn.total === undefined) return null;

  // Runtime string value of the TypeEnum (see module-level warning).
  const typeStr = String(bankTxn.type);
  const transactionType = BANK_TX_TYPE_MAP[typeStr];
  if (!transactionType) {
    console.warn({
      event: "xero_normalize_banktxn_unknown_type",
      bankTransactionID: bankTxn.bankTransactionID,
      type: typeStr,
    });
    return null;
  }

  const externalId = `banktxn-${bankTxn.bankTransactionID}`;
  const amount = Math.abs(bankTxn.total).toFixed(2);

  const currencyCode =
    bankTxn.currencyCode !== null && bankTxn.currencyCode !== undefined
      ? String(bankTxn.currencyCode)
      : "USD";

  // Category: use the first line item's account code as the category source.
  const firstLine = bankTxn.lineItems?.[0];
  const categorySource = firstLine?.accountCode ?? firstLine?.description ?? null;
  const category = mapToInternalCategory(categorySource);

  const description = firstLine?.description ?? null;
  const vendorName = bankTxn.contact?.name ?? null;
  const referenceNumber = bankTxn.reference ?? null;
  const isReconciled = bankTxn.isReconciled ?? false;

  return {
    externalId,
    transactionDate: bankTxn.date,
    amount,
    currencyCode,
    transactionType,
    category,
    description,
    vendorName,
    referenceNumber,
    isReconciled,
    categorySource,
  };
}
