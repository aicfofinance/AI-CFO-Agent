/**
 * QuickBooks data import orchestration — Chart of Accounts (Step 4.5).
 *
 * Transaction import will be added in Steps 4.6–4.7.
 *
 * ─── QB Account field mapping ────────────────────────────────────────────────
 *
 * QB field              Internal column              Null handling
 * ─────────────────────────────────────────────────────────────────────────────
 * Id (string)           accounts.externalId          null → log + skip account
 * Name (string)         accounts.name                null/empty → log + skip account
 * Description (string?) accounts.description         null/absent → stored as null
 * AccountType (string)  accounts.accountType         via normalizeAccountType()
 * AccountSubType (str?) accounts.accountSubtype      null/absent → stored as null
 * CurrentBalance (num?) accounts.currentBalance      null/absent → stored as null;
 *                                                    present → .toFixed(2) string
 *                                                    (no arithmetic, just formatting)
 * CurrencyRef.value     accounts.currencyCode        absent → 'USD' default
 * Active (boolean?)     accounts.isActive            absent → true default
 * ParentRef.value       accounts.parentAccountId     not resolved in this step;
 *                                                    QB Id → internal UUID requires
 *                                                    a two-pass import; stored null
 *
 * Intentionally dropped QB fields (not stored):
 *   - SyncToken          QB concurrency control, not needed for read-only import
 *   - FullyQualifiedName Redundant with Name for our use case
 *   - Classification     Redundant with AccountType
 *   - SubAccount         Boolean flag, not stored
 *   - TaxCodeRef         Tax reference, out of V1 scope
 *   - MetaData           QB audit timestamps, we maintain our own
 */

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/platform/db/client";
import {
  accounts,
  connections,
  dataQualityLog,
  syncJobs,
  transactions,
} from "@/lib/platform/db/schema";
import { getQuickBooksClient } from "@/lib/integrations/quickbooks/client";
import {
  normalizeAccountName,
  normalizeAccountType,
  normalizeQBCategory,
} from "@/lib/integrations/quickbooks/normalize";

/**
 * Minimal shape of a QuickBooks Account object returned by `findAccounts()`.
 *
 * Only the fields consumed by this import function are typed here. The QB API
 * returns additional fields that are intentionally ignored (see module JSDoc).
 *
 * Do not import this type from an external package — it is defined locally
 * because node-quickbooks ships no TypeScript types and no @types/* package
 * exists for it.
 */
type QBAccount = {
  Id: string;
  Name: string;
  Description?: string;
  AccountType: string;
  AccountSubType?: string;
  CurrentBalance?: number | null;
  CurrencyRef?: { value: string };
  Active?: boolean;
  ParentRef?: { value: string };
};

/**
 * Typed wrapper for the `findAccounts` QB API response.
 * `Account` is absent (not just empty array) when the company has no accounts.
 */
type FindAccountsResult = {
  QueryResponse: {
    Account?: QBAccount[];
  };
};

/**
 * Imports all Chart of Accounts from QuickBooks for the given connection.
 *
 * Behaviour:
 * - Fetches all QB accounts in a single `findAccounts` call (node-quickbooks
 *   handles pagination internally via its `fetchAll` logic).
 * - Upserts each account on the unique index `(orgId, sourceSystem, externalId)`.
 *   Calling this function twice is idempotent — the second call produces no new rows.
 * - Logs malformed accounts (missing Id or Name) to `data_quality_log` and
 *   continues processing the remaining accounts without aborting.
 * - Updates `sync_jobs.records_synced` with the count of successfully upserted
 *   accounts at the end of the run.
 *
 * Error handling:
 * - QB API errors (network failures, 401, 429, 5xx) are rethrown after logging.
 *   The Inngest step in `single-org.ts` is responsible for classifying these and
 *   marking the sync job with the appropriate status.
 * - Per-account validation errors are non-fatal: logged and skipped.
 *
 * Security:
 * - `orgId` is read from the database connection row, never from caller input.
 * - QB account raw data is NOT written to `data_quality_log` to avoid storing PII
 *   (vendor names, account descriptions may contain customer information).
 *
 * @param connectionId - UUID primary key of the `connections` row.
 * @param syncJobId    - UUID primary key of the `sync_jobs` row for this run.
 */
export async function importAccounts(connectionId: string, syncJobId: string): Promise<void> {
  // ── 1. Obtain authenticated QB client ─────────────────────────────────────
  // getQuickBooksClient() handles token decryption, proactive refresh, and
  // auth_expired classification — see client.ts for the full details.
  const qbo = await getQuickBooksClient(connectionId);

  // ── 2. Resolve orgId from the database ───────────────────────────────────
  // orgId MUST come from the database, never from caller-supplied input.
  // CLAUDE.md: "A missing orgId from getRequestContext() is a security error."
  // The same principle applies here: if the connection row is gone, stop.
  const connectionRows = await db
    .select({ orgId: connections.orgId })
    .from(connections)
    .where(eq(connections.id, connectionId));

  const connectionRow = connectionRows[0];
  if (!connectionRow) {
    throw new Error(`IMPORT_ACCOUNTS_CONNECTION_NOT_FOUND: connectionId=${connectionId}`);
  }

  const { orgId } = connectionRow;

  // ── 3. Fetch all accounts from QuickBooks ─────────────────────────────────
  // node-quickbooks uses callbacks; wrap in a Promise for async/await usage.
  // node-quickbooks internally paginates when `fetchAll` is set in criteria —
  // passing `{}` triggers its default pagination which fetches all records.
  // QB errors are rethrown so the Inngest step can handle 401/429/5xx correctly.
  let qbAccounts: QBAccount[];

  try {
    qbAccounts = await new Promise<QBAccount[]>((resolve, reject) => {
      qbo.findAccounts({}, (err: unknown, result: unknown) => {
        if (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
          return;
        }
        const typedResult = result as FindAccountsResult;
        resolve(typedResult?.QueryResponse?.Account ?? []);
      });
    });
  } catch (err) {
    console.error({
      event: "qb_import_accounts_fetch_failed",
      connectionId,
      orgId,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    // Rethrow — the Inngest step classifies QB error codes and updates sync status.
    throw err;
  }

  // ── 4. Process each account: validate → normalize → upsert ───────────────
  let successCount = 0;

  for (const account of qbAccounts) {
    // 4a. Require external_id (QB Account.Id). Without it we cannot deduplicate.
    if (!account.Id) {
      await db.insert(dataQualityLog).values({
        orgId,
        syncJobId,
        sourceSystem: "quickbooks",
        issueType: "missing_external_id",
        issueDetail: "QB account record has no Id field; cannot upsert without a dedup key",
        // rawData intentionally omitted — account data may contain customer PII
      });
      continue;
    }

    // 4b. Require a non-empty name.
    const name = normalizeAccountName(account.Name);
    if (name === null) {
      await db.insert(dataQualityLog).values({
        orgId,
        syncJobId,
        externalId: account.Id,
        sourceSystem: "quickbooks",
        issueType: "missing_name",
        issueDetail: "QB account has a null or blank Name field",
        // rawData intentionally omitted — may contain PII
      });
      continue;
    }

    // 4c. Normalize account type using the QB → internal mapping table.
    const accountType = normalizeAccountType(account.AccountType ?? "");

    // 4d. Convert QB's numeric CurrentBalance to a DECIMAL-compatible string.
    // QB returns a JS number; we use .toFixed(2) for formatting only —
    // no arithmetic is performed on the value (CLAUDE.md financial data rules).
    const currentBalance: string | null =
      account.CurrentBalance != null ? account.CurrentBalance.toFixed(2) : null;

    // 4e. Upsert the account row. On conflict (same org+source+externalId),
    // update the mutable fields. createdAt and the conflict key columns are
    // never overwritten. updatedAt must be set explicitly because Drizzle does
    // not auto-update it on conflict (there is no DB trigger on the upsert path).
    await db
      .insert(accounts)
      .values({
        orgId,
        externalId: account.Id,
        sourceSystem: "quickbooks",
        accountType,
        accountSubtype: account.AccountSubType ?? null,
        name,
        description: account.Description ?? null,
        currentBalance,
        currencyCode: account.CurrencyRef?.value ?? "USD",
        isActive: account.Active ?? true,
        // parentAccountId: QB ParentRef.value is a QB string Id, not our UUID.
        // Resolving it to a UUID requires a second pass after all accounts are
        // inserted. Left null here — a future step can resolve parent refs.
        parentAccountId: null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [accounts.orgId, accounts.sourceSystem, accounts.externalId],
        set: {
          name,
          accountType,
          accountSubtype: account.AccountSubType ?? null,
          currentBalance,
          isActive: account.Active ?? true,
          updatedAt: new Date(),
        },
      });

    successCount++;
  }

  // ── 5. Record the count of successfully processed accounts ────────────────
  // This is the authoritative sync count for the accounts phase of this job.
  // Transaction import (Step 4.6) will add its own count in a separate update.
  await db.update(syncJobs).set({ recordsSynced: successCount }).where(eq(syncJobs.id, syncJobId));

  console.log({
    event: "qb_import_accounts_complete",
    connectionId,
    orgId,
    syncJobId,
    recordsSynced: successCount,
    totalFetched: qbAccounts.length,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 4.6 — Transaction import (initial 13-month pull)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * QB Transaction entity types.
 *
 * ─── Transaction field mapping ───────────────────────────────────────────────
 *
 * QB entity        QB field               Internal column        Null handling
 * ─────────────────────────────────────────────────────────────────────────────
 * All types        Id (string)            transactions.externalId  null → skip
 *                                          prefixed: 'purchase-{Id}', etc.
 * All types        TxnDate (string)       transactions.transactionDate  null → skip
 * All types        TotalAmt or Amount     transactions.amount      abs().toFixed(2)
 * All types        CurrencyRef?.value     transactions.currencyCode  absent → 'USD'
 * All types        DocNumber?             transactions.referenceNumber  absent → null
 * All types        PrivateNote?           transactions.description  absent → null
 *
 * Purchase         VendorRef/EntityRef.name  transactions.vendorName  absent → null
 *                  Line[].AccountBasedExpenseLineDetail.AccountRef.name → category
 *                  Line[].AccountBasedExpenseLineDetail.AccountRef.value → accountId
 *
 * Invoice          CustomerRef.name       transactions.vendorName  absent → null
 *                  Line[].SalesItemLineDetail.ItemRef.name → category (itemRefName)
 *
 * Payment          CustomerRef.name       transactions.vendorName  absent → null
 *                  DepositToAccountRef.value → accountId  absent → null
 *                  category hardcoded: 'revenue'
 *
 * Bill             VendorRef.name         transactions.vendorName  absent → null
 *                  Line[].AccountBasedExpenseLineDetail.AccountRef.name → category
 *                  Line[].AccountBasedExpenseLineDetail.AccountRef.value → accountId
 *
 * BillPayment      VendorRef.name         transactions.vendorName  absent → null
 *                  CheckPayment.BankAccountRef.value or
 *                  CreditCardPayment.CCAccountRef.value → accountId  absent → null
 *                  category: 'other' (no expense account name at root level)
 *
 * CreditMemo       CustomerRef.name       transactions.vendorName  absent → null
 *                  Line[].SalesItemLineDetail.ItemRef.name → category
 *                  category fallback: 'revenue' when no specific match
 *
 * JournalEntry     (none)                 transactions.vendorName  always null
 *                  first Debit line's AccountRef.name → category
 *                  first Debit line's AccountRef.value → accountId
 *                  TotalAmt absent → treated as 0
 *
 * Deposit          (none)                 transactions.vendorName  always null
 *                  DepositToAccountRef.value or Line[].DepositLineDetail.AccountRef.value
 *                  → accountId  absent → null
 *                  category fallback: 'revenue' when no specific match
 *
 * Transfer         (none)                 transactions.vendorName  always null
 *                  FromAccountRef.value → accountId  absent → null
 *                  category: 'other' — transfers have no expense/income category
 *
 * Intentionally dropped QB transaction fields (not stored):
 *   - LinkedTxn           Cross-references to parent/child transactions
 *   - Line[].Id           QB line-item IDs, not needed for financial analysis
 *   - SyncToken           QB concurrency control, read-only import doesn't need it
 *   - MetaData            QB audit timestamps, we maintain our own
 *   - rawData             NEVER stored — may contain customer names/PII
 */

/** Shared reference sub-object used across QB transaction entity types. */
type QBRef = { value: string; name?: string };

/** Fields present on every QB transaction entity type. */
type QBEntityBase = {
  Id: string;
  TxnDate: string; // 'YYYY-MM-DD'
  CurrencyRef?: QBRef;
  DocNumber?: string;
  PrivateNote?: string;
};

type QBPurchase = QBEntityBase & {
  TotalAmt: number;
  VendorRef?: QBRef;
  EntityRef?: QBRef & { type?: string }; // fallback vendor for card purchases
  AccountRef?: QBRef; // payment account (bank / credit card)
  Line?: Array<{
    Amount?: number;
    Description?: string;
    AccountBasedExpenseLineDetail?: { AccountRef?: QBRef };
  }>;
};

type QBInvoice = QBEntityBase & {
  TotalAmt: number;
  CustomerRef?: QBRef;
  Line?: Array<{
    Amount?: number;
    Description?: string;
    SalesItemLineDetail?: { ItemRef?: QBRef };
  }>;
};

type QBPayment = QBEntityBase & {
  TotalAmt: number;
  CustomerRef?: QBRef;
  DepositToAccountRef?: QBRef;
};

type QBBill = QBEntityBase & {
  TotalAmt: number;
  VendorRef?: QBRef;
  Line?: Array<{
    Amount?: number;
    Description?: string;
    AccountBasedExpenseLineDetail?: { AccountRef?: QBRef };
  }>;
};

type QBBillPayment = QBEntityBase & {
  TotalAmt: number;
  VendorRef?: QBRef;
  CheckPayment?: { BankAccountRef?: QBRef };
  CreditCardPayment?: { CCAccountRef?: QBRef };
};

type QBCreditMemo = QBEntityBase & {
  TotalAmt: number;
  CustomerRef?: QBRef;
  Line?: Array<{
    Amount?: number;
    Description?: string;
    SalesItemLineDetail?: { ItemRef?: QBRef };
  }>;
};

type QBJournalEntry = QBEntityBase & {
  TotalAmt?: number; // absent on some QB journal entries
  Line?: Array<{
    Amount?: number;
    Description?: string;
    JournalEntryLineDetail?: {
      AccountRef?: QBRef;
      PostingType?: string; // 'Debit' | 'Credit'
    };
  }>;
};

type QBDeposit = QBEntityBase & {
  TotalAmt: number;
  DepositToAccountRef?: QBRef;
  Line?: Array<{
    Amount?: number;
    Description?: string;
    DepositLineDetail?: { AccountRef?: QBRef };
  }>;
};

/** QB Transfer uses 'Amount' not 'TotalAmt' and has no vendor reference. */
type QBTransfer = QBEntityBase & {
  Amount: number;
  FromAccountRef?: QBRef;
  ToAccountRef?: QBRef;
};

/**
 * Criteria element for QB Query API pagination and filtering.
 *
 * Mirrors `QBCriteriaItem` in `src/types/node-quickbooks.d.ts`. Defined
 * locally to avoid TypeScript import-path ambiguity with `export =` modules.
 */
type QBCriteriaItem =
  | { field: "STARTPOSITION"; value: number }
  | { field: "MAXRESULTS"; value: number }
  | { field: "orderBy"; value: string }
  | { field: string; value: string | number; operator?: string };

/**
 * Normalised fields extracted from a QB transaction entity, ready for DB
 * insertion. All monetary values are decimal strings; dates are 'YYYY-MM-DD'.
 */
type QBExtractedFields = {
  externalId: string; // prefixed QB Id: 'purchase-123', 'invoice-456', etc.
  transactionDate: string; // 'YYYY-MM-DD'
  amount: string; // always positive decimal string (e.g. '125.00')
  currencyCode: string;
  category: string; // 'other' when no pattern match found
  description: string | null;
  vendorName: string | null;
  accountRefValue: string | null; // QB account Id for FK resolution
  referenceNumber: string | null;
  /** The raw account/item name submitted to normalizeQBCategory(). Non-null
   *  means a name was available; used to decide whether to write to
   *  data_quality_log (only log when we had a name but could not map it). */
  categorySource: string | null;
};

/** Maximum QB records per API page (QB hard cap). */
const PAGE_SIZE = 1000;

// ── Entity-type-specific field extractors ─────────────────────────────────────
//
// Each function takes a raw `unknown` value from the node-quickbooks callback
// and returns `QBExtractedFields | null`. The cast to a specific QB type is
// safe because each extractor is only ever called for the matching entity type.
// Returning null indicates the record is missing required fields and should be
// logged to data_quality_log by the caller.

function extractPurchase(raw: unknown): QBExtractedFields | null {
  const e = raw as QBPurchase;
  if (!e?.Id || !e?.TxnDate) return null;

  // Category: first expense-line account name is most specific.
  // Fallback: root AccountRef.name (the payment vehicle, e.g. "Visa Credit Card").
  const firstExpenseLine = e.Line?.find((l) => l.AccountBasedExpenseLineDetail?.AccountRef);
  const lineAccountRef = firstExpenseLine?.AccountBasedExpenseLineDetail?.AccountRef;
  const accountRefName = lineAccountRef?.name ?? e.AccountRef?.name ?? null;
  const accountRefValue = lineAccountRef?.value ?? e.AccountRef?.value ?? null;

  return {
    externalId: `purchase-${e.Id}`,
    transactionDate: e.TxnDate,
    amount: Math.abs(e.TotalAmt).toFixed(2),
    currencyCode: e.CurrencyRef?.value ?? "USD",
    category: normalizeQBCategory(accountRefName),
    description: e.PrivateNote ?? null,
    vendorName: e.VendorRef?.name ?? e.EntityRef?.name ?? null,
    accountRefValue,
    referenceNumber: e.DocNumber ?? null,
    categorySource: accountRefName,
  };
}

function extractInvoice(raw: unknown): QBExtractedFields | null {
  const e = raw as QBInvoice;
  if (!e?.Id || !e?.TxnDate) return null;

  // Invoices lack a root AccountRef; category comes from the first line item's
  // product/service name (ItemRef.name), passed as the itemRefName argument.
  const firstSalesLine = e.Line?.find((l) => l.SalesItemLineDetail?.ItemRef);
  const itemRefName = firstSalesLine?.SalesItemLineDetail?.ItemRef?.name ?? null;

  return {
    externalId: `invoice-${e.Id}`,
    transactionDate: e.TxnDate,
    amount: Math.abs(e.TotalAmt).toFixed(2),
    currencyCode: e.CurrencyRef?.value ?? "USD",
    category: normalizeQBCategory(null, itemRefName),
    description: e.PrivateNote ?? null,
    vendorName: e.CustomerRef?.name ?? null,
    accountRefValue: null,
    referenceNumber: e.DocNumber ?? null,
    categorySource: itemRefName,
  };
}

function extractPayment(raw: unknown): QBExtractedFields | null {
  const e = raw as QBPayment;
  if (!e?.Id || !e?.TxnDate) return null;

  return {
    externalId: `payment-${e.Id}`,
    transactionDate: e.TxnDate,
    amount: Math.abs(e.TotalAmt).toFixed(2),
    currencyCode: e.CurrencyRef?.value ?? "USD",
    // Customer payments received are always income; no account name to map
    // so the category defaults directly to 'revenue'.
    category: "revenue",
    description: e.PrivateNote ?? null,
    vendorName: e.CustomerRef?.name ?? null,
    accountRefValue: e.DepositToAccountRef?.value ?? null,
    referenceNumber: e.DocNumber ?? null,
    categorySource: null, // hardcoded 'revenue'; no source name
  };
}

function extractBill(raw: unknown): QBExtractedFields | null {
  const e = raw as QBBill;
  if (!e?.Id || !e?.TxnDate) return null;

  const firstExpenseLine = e.Line?.find((l) => l.AccountBasedExpenseLineDetail?.AccountRef);
  const lineAccountRef = firstExpenseLine?.AccountBasedExpenseLineDetail?.AccountRef;
  const accountRefName = lineAccountRef?.name ?? null;
  const accountRefValue = lineAccountRef?.value ?? null;

  return {
    externalId: `bill-${e.Id}`,
    transactionDate: e.TxnDate,
    amount: Math.abs(e.TotalAmt).toFixed(2),
    currencyCode: e.CurrencyRef?.value ?? "USD",
    category: normalizeQBCategory(accountRefName),
    description: e.PrivateNote ?? null,
    vendorName: e.VendorRef?.name ?? null,
    accountRefValue,
    referenceNumber: e.DocNumber ?? null,
    categorySource: accountRefName,
  };
}

function extractBillPayment(raw: unknown): QBExtractedFields | null {
  const e = raw as QBBillPayment;
  if (!e?.Id || !e?.TxnDate) return null;

  // BillPayment settles an existing bill — the expense category belongs to
  // the original Bill, not the payment. No account name is available at this
  // level so category defaults to 'other' with categorySource = null (no log).
  const bankAccountRef =
    e.CheckPayment?.BankAccountRef ?? e.CreditCardPayment?.CCAccountRef ?? null;

  return {
    externalId: `billpayment-${e.Id}`,
    transactionDate: e.TxnDate,
    amount: Math.abs(e.TotalAmt).toFixed(2),
    currencyCode: e.CurrencyRef?.value ?? "USD",
    category: "other",
    description: e.PrivateNote ?? null,
    vendorName: e.VendorRef?.name ?? null,
    accountRefValue: bankAccountRef?.value ?? null,
    referenceNumber: e.DocNumber ?? null,
    categorySource: null,
  };
}

function extractCreditMemo(raw: unknown): QBExtractedFields | null {
  const e = raw as QBCreditMemo;
  if (!e?.Id || !e?.TxnDate) return null;

  const firstSalesLine = e.Line?.find((l) => l.SalesItemLineDetail?.ItemRef);
  const itemRefName = firstSalesLine?.SalesItemLineDetail?.ItemRef?.name ?? null;
  const mappedCategory = normalizeQBCategory(null, itemRefName);

  return {
    externalId: `creditmemo-${e.Id}`,
    transactionDate: e.TxnDate,
    amount: Math.abs(e.TotalAmt).toFixed(2),
    currencyCode: e.CurrencyRef?.value ?? "USD",
    // Credit memos reduce outstanding customer balances (income adjustment).
    // When no specific product/service pattern matches, default to 'revenue'.
    category: mappedCategory === "other" ? "revenue" : mappedCategory,
    description: e.PrivateNote ?? null,
    vendorName: e.CustomerRef?.name ?? null,
    accountRefValue: null,
    referenceNumber: e.DocNumber ?? null,
    categorySource: itemRefName,
  };
}

function extractJournalEntry(raw: unknown): QBExtractedFields | null {
  const e = raw as QBJournalEntry;
  if (!e?.Id || !e?.TxnDate) return null;

  // Use the first Debit line's account for category/FK resolution; if no debit
  // line exists, fall back to the first line regardless of PostingType.
  const debitLine =
    e.Line?.find((l) => l.JournalEntryLineDetail?.PostingType === "Debit") ??
    e.Line?.find((l) => l.JournalEntryLineDetail?.AccountRef);
  const accountRef = debitLine?.JournalEntryLineDetail?.AccountRef ?? null;
  const accountRefName = accountRef?.name ?? null;

  // TotalAmt may be absent on manually-entered journal entries.
  const rawAmount = e.TotalAmt ?? 0;

  return {
    externalId: `je-${e.Id}`,
    transactionDate: e.TxnDate,
    amount: Math.abs(rawAmount).toFixed(2),
    currencyCode: e.CurrencyRef?.value ?? "USD",
    category: normalizeQBCategory(accountRefName),
    description: e.PrivateNote ?? null,
    vendorName: null, // journal entries don't have a single vendor
    accountRefValue: accountRef?.value ?? null,
    referenceNumber: e.DocNumber ?? null,
    categorySource: accountRefName,
  };
}

function extractDeposit(raw: unknown): QBExtractedFields | null {
  const e = raw as QBDeposit;
  if (!e?.Id || !e?.TxnDate) return null;

  const firstDepositLine = e.Line?.find((l) => l.DepositLineDetail?.AccountRef);
  const lineAccountRef = firstDepositLine?.DepositLineDetail?.AccountRef ?? null;
  const accountRefName = lineAccountRef?.name ?? null;
  const mappedCategory = normalizeQBCategory(accountRefName);

  return {
    externalId: `deposit-${e.Id}`,
    transactionDate: e.TxnDate,
    amount: Math.abs(e.TotalAmt).toFixed(2),
    currencyCode: e.CurrencyRef?.value ?? "USD",
    // Deposits are income events; fall back to 'revenue' when no pattern matches.
    category: mappedCategory === "other" ? "revenue" : mappedCategory,
    description: e.PrivateNote ?? null,
    vendorName: null,
    accountRefValue: e.DepositToAccountRef?.value ?? lineAccountRef?.value ?? null,
    referenceNumber: e.DocNumber ?? null,
    categorySource: accountRefName,
  };
}

function extractTransfer(raw: unknown): QBExtractedFields | null {
  const e = raw as QBTransfer;
  if (!e?.Id || !e?.TxnDate) return null;

  return {
    externalId: `transfer-${e.Id}`,
    transactionDate: e.TxnDate,
    amount: Math.abs(e.Amount).toFixed(2),
    currencyCode: e.CurrencyRef?.value ?? "USD",
    // Transfers between accounts have no expense/income category.
    category: "other",
    description: e.PrivateNote ?? null,
    vendorName: null,
    accountRefValue: e.FromAccountRef?.value ?? null,
    referenceNumber: e.DocNumber ?? null,
    categorySource: null,
  };
}

// ── 429 detection ──────────────────────────────────────────────────────────────

/**
 * Returns `true` if `err` represents a QB API rate-limit (HTTP 429) response.
 *
 * node-quickbooks surfaces errors in several shapes depending on whether the
 * error originates from the HTTP layer or from QB's Fault response:
 *   1. An `Error` instance whose message text contains '429', 'rate limit',
 *      or 'throttle'.
 *   2. A plain object with `statusCode` or `status` equal to 429.
 *   3. A QB Fault response with `Fault.type === 'THROTTLE'`.
 */
function isRateLimitError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes("429") || msg.includes("rate limit") || msg.includes("throttle")) {
      return true;
    }
  }
  if (typeof err === "object" && err !== null) {
    const obj = err as Record<string, unknown>;
    if (obj["statusCode"] === 429 || obj["status"] === 429) return true;
    const fault = obj["Fault"] as Record<string, unknown> | undefined;
    if (fault?.["type"] === "THROTTLE") return true;
    if (typeof obj["message"] === "string") {
      const msg = (obj["message"] as string).toLowerCase();
      if (msg.includes("429") || msg.includes("rate limit") || msg.includes("throttle")) {
        return true;
      }
    }
  }
  return false;
}

// ── Main export ────────────────────────────────────────────────────────────────

/**
 * Imports all QB transaction entities for the given connection.
 *
 * Nine QB entity types are queried in sequence: Purchase, Invoice, Payment,
 * Bill, BillPayment, CreditMemo, JournalEntry, Deposit, Transfer. Each type
 * is paginated in batches of 1,000 rows using QB's STARTPOSITION/MAXRESULTS
 * query modifiers (1-based; QB hard cap is 1,000 per page).
 *
 * ExternalIds are prefixed with the entity type (e.g. 'purchase-123') to
 * prevent cross-type collisions in the `(orgId, sourceSystem, externalId)`
 * unique index.
 *
 * Behaviour:
 * - Upserts on `idx_transactions_org_external`. Calling twice is idempotent —
 *   the second call produces no new rows and updates existing ones in place.
 * - Updates `sync_jobs.records_synced` after each 1,000-row QB page so
 *   callers can observe import progress before completion.
 * - Logs unmapped categories to `data_quality_log` (stored as 'other') when
 *   a non-null account/item name was available but did not match any pattern.
 * - Handles HTTP 429 with a 30-second pause and a single retry per CLAUDE.md.
 * - All other QB API errors (401, 5xx) are rethrown to the Inngest step in
 *   `single-org.ts` for classification and sync_status updates.
 *
 * Security:
 * - `orgId` is resolved from the `connections` database row — never from
 *   caller-supplied input (CLAUDE.md multi-tenancy rules).
 * - `rawData` is always stored as NULL — QB responses may contain customer
 *   names, addresses, and other PII.
 *
 * @param connectionId - UUID primary key of the `connections` row.
 * @param syncJobId    - UUID primary key of the `sync_jobs` row for this run.
 * @param since        - Optional lower bound for TxnDate filter. Pass
 *   `new Date(Date.now() - 13 * 30 * 24 * 60 * 60 * 1000)` for the initial
 *   13-month pull. Omit to fetch all available transaction history.
 */
export async function importTransactions(
  connectionId: string,
  syncJobId: string,
  since?: Date,
): Promise<void> {
  // ── 1. Obtain authenticated QB client ──────────────────────────────────────
  // getQuickBooksClient() handles token decryption, proactive refresh, and
  // auth_expired classification — see client.ts.
  const qbo = await getQuickBooksClient(connectionId);

  // ── 2. Resolve orgId from the database ────────────────────────────────────
  // orgId MUST come from the database, never from caller-supplied input.
  const connectionRows = await db
    .select({ orgId: connections.orgId })
    .from(connections)
    .where(eq(connections.id, connectionId));

  const connectionRow = connectionRows[0];
  if (!connectionRow) {
    throw new Error(`IMPORT_TRANSACTIONS_CONNECTION_NOT_FOUND: connectionId=${connectionId}`);
  }
  const { orgId } = connectionRow;

  // ── 3. Build QB externalId → internal account UUID lookup map ─────────────
  // Resolves AccountRef.value → accounts.id FK on each transaction row.
  // Built once here and reused across all entity types to avoid N+1 queries.
  const accountRows = await db
    .select({ externalId: accounts.externalId, id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.orgId, orgId), eq(accounts.sourceSystem, "quickbooks")));

  const accountIdMap = new Map<string, string>(accountRows.map((row) => [row.externalId, row.id]));

  // ── 4. Build TxnDate lower-bound criteria (applied to all entity types) ───
  const sinceCriteria: QBCriteriaItem[] =
    since !== undefined
      ? [
          {
            field: "TxnDate",
            value: since.toISOString().slice(0, 10),
            operator: ">=",
          },
        ]
      : [];

  // Running total of successfully upserted rows across all entity types and
  // batches. Written to sync_jobs.records_synced after every QB page.
  let cumulativeCount = 0;

  // ── 5. Inner pagination helper — shared across all nine entity types ───────
  //
  // Paginates one QB entity type through all available pages:
  //   • Wraps the QB callback-based fetch in a Promise.
  //   • Handles HTTP 429 with a 30-second pause and a single retry.
  //   • Normalises each raw entity to a DB insert row via `extract`.
  //   • Batch-upserts up to PAGE_SIZE rows using ON CONFLICT DO UPDATE.
  //   • Updates sync_jobs.records_synced after each page.
  //
  // Closes over: qbo, orgId, syncJobId, sinceCriteria, accountIdMap,
  //              cumulativeCount (mutated via closure).
  async function processEntityType<T extends { Id: string; TxnDate: string }>(
    label: string,
    txnType: "income" | "expense" | "transfer" | "adjustment",
    fetchPage: (criteria: QBCriteriaItem[]) => Promise<T[]>,
    extract: (entity: T) => QBExtractedFields | null,
  ): Promise<void> {
    let startPosition = 1;

    while (true) {
      const criteria: QBCriteriaItem[] = [
        ...sinceCriteria,
        { field: "STARTPOSITION", value: startPosition },
        { field: "MAXRESULTS", value: PAGE_SIZE },
      ];

      // Fetch one page with 429 retry.
      let batch: T[];
      try {
        batch = await fetchPage(criteria);
      } catch (firstErr) {
        if (isRateLimitError(firstErr)) {
          // CLAUDE.md: 429 → pause 30 s, retry once, then fail.
          console.warn({
            event: "qb_import_transactions_rate_limit",
            label,
            connectionId,
            orgId,
            startPosition,
          });
          await new Promise<void>((resolve) => setTimeout(resolve, 30_000));
          try {
            batch = await fetchPage(criteria);
          } catch (retryErr) {
            console.error({
              event: "qb_import_transactions_rate_limit_retry_failed",
              label,
              connectionId,
              orgId,
              errorMessage: retryErr instanceof Error ? retryErr.message : String(retryErr),
            });
            throw retryErr;
          }
        } else {
          // 401 and 5xx errors are rethrown; single-org.ts classifies them
          // and updates sync_status (auth_expired / failed).
          console.error({
            event: "qb_import_transactions_fetch_failed",
            label,
            connectionId,
            orgId,
            errorMessage: firstErr instanceof Error ? firstErr.message : String(firstErr),
          });
          throw firstErr;
        }
      }

      if (batch.length === 0) break;

      // Normalise each entity in the batch to a DB-ready row.
      const insertRows: (typeof transactions.$inferInsert)[] = [];

      for (const entity of batch) {
        // Require a QB Id for deduplication on the unique index.
        if (!entity.Id) {
          await db.insert(dataQualityLog).values({
            orgId,
            syncJobId,
            sourceSystem: "quickbooks",
            issueType: "missing_external_id",
            issueDetail: `QB ${label} record has no Id field; cannot upsert without a dedup key`,
            // rawData intentionally omitted — may contain customer PII
          });
          continue;
        }

        const extracted = extract(entity);
        if (extracted === null) {
          // extract() returns null when a required field like TxnDate is absent.
          await db.insert(dataQualityLog).values({
            orgId,
            syncJobId,
            externalId: entity.Id,
            sourceSystem: "quickbooks",
            issueType: "missing_required_field",
            issueDetail: `QB ${label} ${entity.Id}: missing required field (TxnDate or TotalAmt)`,
          });
          continue;
        }

        // Log unmapped categories — but only when a source name was available.
        // Transactions with no account/item name (categorySource = null) default
        // silently to 'other'; there is nothing actionable to log in that case.
        if (extracted.category === "other" && extracted.categorySource !== null) {
          await db.insert(dataQualityLog).values({
            orgId,
            syncJobId,
            externalId: extracted.externalId,
            sourceSystem: "quickbooks",
            issueType: "unmapped_category",
            issueDetail:
              `QB ${label} ${entity.Id}: account/item name ` +
              `"${extracted.categorySource}" did not match any internal category; ` +
              `stored as 'other'`,
            // rawData intentionally omitted — may contain customer PII
          });
        }

        // Resolve QB AccountRef.value → internal account UUID.
        const accountId = extracted.accountRefValue
          ? (accountIdMap.get(extracted.accountRefValue) ?? null)
          : null;

        insertRows.push({
          orgId,
          externalId: extracted.externalId,
          sourceSystem: "quickbooks",
          transactionDate: extracted.transactionDate,
          // postedDate: not available from QB transaction entities at this level.
          amount: extracted.amount,
          currencyCode: extracted.currencyCode,
          amountBase: null, // multi-currency conversion is out of V1 scope
          transactionType: txnType,
          category: extracted.category,
          subcategory: null,
          description: extracted.description,
          vendorName: extracted.vendorName,
          accountId,
          referenceNumber: extracted.referenceNumber,
          isReconciled: false,
          rawData: null, // NEVER store raw QB response — may contain customer PII
          updatedAt: new Date(),
        });
      }

      // Batch upsert: ON CONFLICT (orgId, sourceSystem, externalId) DO UPDATE.
      // Mutable fields are updated on conflict; dedup-key columns and createdAt
      // are never overwritten. Running twice produces no new rows.
      if (insertRows.length > 0) {
        await db
          .insert(transactions)
          .values(insertRows)
          .onConflictDoUpdate({
            target: [transactions.orgId, transactions.sourceSystem, transactions.externalId],
            set: {
              transactionDate: sql`excluded.transaction_date`,
              amount: sql`excluded.amount`,
              currencyCode: sql`excluded.currency_code`,
              transactionType: sql`excluded.transaction_type`,
              category: sql`excluded.category`,
              subcategory: sql`excluded.subcategory`,
              description: sql`excluded.description`,
              vendorName: sql`excluded.vendor_name`,
              accountId: sql`excluded.account_id`,
              referenceNumber: sql`excluded.reference_number`,
              isReconciled: sql`excluded.is_reconciled`,
              updatedAt: sql`excluded.updated_at`,
            },
          });

        cumulativeCount += insertRows.length;
      }

      // Update records_synced after each batch so callers see live progress.
      await db
        .update(syncJobs)
        .set({ recordsSynced: cumulativeCount })
        .where(eq(syncJobs.id, syncJobId));

      // Fewer than PAGE_SIZE results means we have reached the last page.
      if (batch.length < PAGE_SIZE) break;
      startPosition += PAGE_SIZE;
    }
  }

  // ── 6. Process each QB entity type in sequence ────────────────────────────
  // Each type is fully paginated before the next starts. The callback pattern
  // is identical across all nine types; only the method name and QueryResponse
  // key differ.

  await processEntityType<QBPurchase>(
    "purchase",
    "expense",
    (criteria) =>
      new Promise<QBPurchase[]>((resolve, reject) => {
        qbo.findPurchases(criteria, (err: unknown, result: unknown) => {
          if (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
            return;
          }
          const r = result as { QueryResponse?: { Purchase?: QBPurchase[] } };
          resolve(r?.QueryResponse?.Purchase ?? []);
        });
      }),
    extractPurchase,
  );

  await processEntityType<QBInvoice>(
    "invoice",
    "income",
    (criteria) =>
      new Promise<QBInvoice[]>((resolve, reject) => {
        qbo.findInvoices(criteria, (err: unknown, result: unknown) => {
          if (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
            return;
          }
          const r = result as { QueryResponse?: { Invoice?: QBInvoice[] } };
          resolve(r?.QueryResponse?.Invoice ?? []);
        });
      }),
    extractInvoice,
  );

  await processEntityType<QBPayment>(
    "payment",
    "income",
    (criteria) =>
      new Promise<QBPayment[]>((resolve, reject) => {
        qbo.findPayments(criteria, (err: unknown, result: unknown) => {
          if (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
            return;
          }
          const r = result as { QueryResponse?: { Payment?: QBPayment[] } };
          resolve(r?.QueryResponse?.Payment ?? []);
        });
      }),
    extractPayment,
  );

  await processEntityType<QBBill>(
    "bill",
    "expense",
    (criteria) =>
      new Promise<QBBill[]>((resolve, reject) => {
        qbo.findBills(criteria, (err: unknown, result: unknown) => {
          if (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
            return;
          }
          const r = result as { QueryResponse?: { Bill?: QBBill[] } };
          resolve(r?.QueryResponse?.Bill ?? []);
        });
      }),
    extractBill,
  );

  await processEntityType<QBBillPayment>(
    "billpayment",
    "expense",
    (criteria) =>
      new Promise<QBBillPayment[]>((resolve, reject) => {
        qbo.findBillPayments(criteria, (err: unknown, result: unknown) => {
          if (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
            return;
          }
          const r = result as { QueryResponse?: { BillPayment?: QBBillPayment[] } };
          resolve(r?.QueryResponse?.BillPayment ?? []);
        });
      }),
    extractBillPayment,
  );

  await processEntityType<QBCreditMemo>(
    "creditmemo",
    "income",
    (criteria) =>
      new Promise<QBCreditMemo[]>((resolve, reject) => {
        qbo.findCreditMemos(criteria, (err: unknown, result: unknown) => {
          if (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
            return;
          }
          const r = result as { QueryResponse?: { CreditMemo?: QBCreditMemo[] } };
          resolve(r?.QueryResponse?.CreditMemo ?? []);
        });
      }),
    extractCreditMemo,
  );

  await processEntityType<QBJournalEntry>(
    "journalentry",
    "adjustment",
    (criteria) =>
      new Promise<QBJournalEntry[]>((resolve, reject) => {
        qbo.findJournalEntries(criteria, (err: unknown, result: unknown) => {
          if (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
            return;
          }
          const r = result as { QueryResponse?: { JournalEntry?: QBJournalEntry[] } };
          resolve(r?.QueryResponse?.JournalEntry ?? []);
        });
      }),
    extractJournalEntry,
  );

  await processEntityType<QBDeposit>(
    "deposit",
    "income",
    (criteria) =>
      new Promise<QBDeposit[]>((resolve, reject) => {
        qbo.findDeposits(criteria, (err: unknown, result: unknown) => {
          if (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
            return;
          }
          const r = result as { QueryResponse?: { Deposit?: QBDeposit[] } };
          resolve(r?.QueryResponse?.Deposit ?? []);
        });
      }),
    extractDeposit,
  );

  await processEntityType<QBTransfer>(
    "transfer",
    "transfer",
    (criteria) =>
      new Promise<QBTransfer[]>((resolve, reject) => {
        qbo.findTransfers(criteria, (err: unknown, result: unknown) => {
          if (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
            return;
          }
          const r = result as { QueryResponse?: { Transfer?: QBTransfer[] } };
          resolve(r?.QueryResponse?.Transfer ?? []);
        });
      }),
    extractTransfer,
  );

  console.log({
    event: "qb_import_transactions_complete",
    connectionId,
    orgId,
    syncJobId,
    recordsSynced: cumulativeCount,
  });
}
