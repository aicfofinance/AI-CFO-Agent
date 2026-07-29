/**
 * Xero data import orchestration.
 *
 * ─── Account field mapping ────────────────────────────────────────────────────
 *
 * Xero field              Internal column              Null handling
 * ─────────────────────────────────────────────────────────────────────────────
 * account.accountID       accounts.externalId          null → log + skip
 * account.name            accounts.name                null/empty → log + skip
 * account.description     accounts.description         null → stored as null
 * account.type (runtime)  accounts.accountType         via XERO_ACCOUNT_TYPE_MAP
 * account.code            accounts.accountSubtype      null → stored as null
 * account.status (ACTIVE) accounts.isActive            ARCHIVED/DELETED → false
 * (no current balance)    accounts.currentBalance      always null — Xero does not
 *                                                      expose account balance in
 *                                                      the Chart of Accounts API
 *
 * Intentionally dropped Xero Account fields:
 *   - _class           Xero's ASSET/LIABILITY/etc classification — redundant with
 *                      accountType after internal normalization
 *   - taxType          Tax reference, out of V1 scope
 *   - bankAccountType  Only meaningful for BANK accounts, not stored on our row
 *   - systemAccount    Xero reserved system accounts (e.g. DEBTORS), not used
 *   - enablePaymentsToAccount — Xero internal flag, not relevant to analysis
 *   - showInExpenseClaims     — Xero internal flag, not relevant to analysis
 *   - currencyCode     Not returned on account-level by Xero's Chart of Accounts
 *                      endpoint; stored as 'USD' default
 *
 * ─── Transaction import ───────────────────────────────────────────────────────
 *
 * Two Xero endpoint types are imported: Invoices and Bank Transactions.
 * Both are paginated (page=1,2,3... with Pagination.pageCount as the sentinel).
 * `normalizeXeroInvoice()` and `normalizeXeroBankTransaction()` from normalize.ts
 * map each record to the internal `NormalizedXeroTransaction` shape.
 *
 * Error handling (CLAUDE.md):
 *   - 401 → classify as auth_expired, update connections row, rethrow
 *   - 429 → pause 30 s, retry once; if retry also fails, set status='failed', rethrow
 *   - 5xx → set status='failed', rethrow
 *
 * xero-node error shape: on non-2xx response, it rejects with:
 *   `{ response: AxiosResponse, body: unknown }`
 * so status is at `err.response.status`.
 */

import { and, eq, sql } from "drizzle-orm";
import type { Account, Invoice, BankTransaction } from "xero-node";

import { db } from "@/lib/platform/db/client";
import {
  accounts,
  connections,
  dataQualityLog,
  syncJobs,
  transactions,
} from "@/lib/platform/db/schema";
import { getXeroClient } from "@/lib/integrations/xero/client";
import {
  normalizeXeroInvoice,
  normalizeXeroBankTransaction,
} from "@/lib/integrations/xero/normalize";

// ─── Xero account type → internal account type ────────────────────────────────

/**
 * Maps the runtime string value of Xero's AccountType enum to the five internal
 * account type values used in the `accounts.account_type` column.
 *
 * Internal values: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'
 *
 * xero-node's AccountType d.ts declares numeric enums but the runtime JS uses
 * string values — use `String(account.type)` and compare here (same pattern as
 * the Invoice/BankTransaction TypeEnum in normalize.ts).
 */
const XERO_ACCOUNT_TYPE_MAP: Record<string, string> = {
  BANK: "asset", // Bank accounts
  CURRENT: "asset", // Current assets
  FIXED: "asset", // Fixed assets (property, plant, equipment)
  NONCURRENT: "asset", // Non-current assets
  INVENTORY: "asset", // Inventory
  PREPAYMENT: "asset", // Prepayments
  CURRLIAB: "liability", // Current liabilities
  LIABILITY: "liability",
  TERMLIAB: "liability", // Term liabilities
  EQUITY: "equity",
  REVENUE: "revenue",
  SALES: "revenue",
  OTHERINCOME: "revenue",
  EXPENSE: "expense",
  DIRECTCOSTS: "expense",
  OVERHEADS: "expense", // Overhead expenses
  DEPRECIATN: "expense", // Depreciation
  PAYG: "expense", // PAYG withholding (AU-specific)
};

// ─── 429 rate-limit detection ─────────────────────────────────────────────────

/**
 * xero-node rejects Promises with `{ response, body }` on non-2xx responses.
 * This utility checks whether the error represents an HTTP 429 (rate limit).
 */
function isXeroRateLimitError(err: unknown): boolean {
  if (typeof err === "object" && err !== null) {
    const obj = err as Record<string, unknown>;
    const resp = obj["response"] as Record<string, unknown> | undefined;
    if (resp?.["status"] === 429) return true;
  }
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes("429") || msg.includes("rate limit") || msg.includes("throttle")) {
      return true;
    }
  }
  return false;
}

/**
 * Wraps a Xero API call with retry-once logic for 429 responses.
 *
 * On 429: pauses 30 s, retries once. If the retry also fails, rethrows
 * so the caller can set sync_status='failed'.
 */
async function withRateLimitRetry<T>(
  label: string,
  fn: () => Promise<T>,
  connectionId: string,
  orgId: string,
): Promise<T> {
  try {
    return await fn();
  } catch (firstErr) {
    if (isXeroRateLimitError(firstErr)) {
      console.warn({
        event: "xero_rate_limit_pausing",
        label,
        connectionId,
        orgId,
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 30_000));
      try {
        return await fn();
      } catch (retryErr) {
        console.error({
          event: "xero_rate_limit_retry_failed",
          label,
          connectionId,
          orgId,
          errorMessage: retryErr instanceof Error ? retryErr.message : String(retryErr),
        });
        throw retryErr;
      }
    }
    throw firstErr;
  }
}

// ─── Account import ────────────────────────────────────────────────────────────

/**
 * Imports the Xero Chart of Accounts for the given connection.
 *
 * Fetches all accounts in a single call (no pagination — the Xero accounts
 * endpoint returns all accounts in one response, not page-by-page).
 * Upserts on `(orgId, sourceSystem, externalId)`. Calling twice is idempotent.
 *
 * Missing `accountID` or `name` → logged to `data_quality_log`, row skipped.
 * Unknown account type → stored as 'expense' (safe fallback) with a DQ log entry.
 *
 * @param connectionId - UUID primary key of the `connections` row.
 * @param syncJobId    - UUID primary key of the `sync_jobs` row for this run.
 */
export async function importXeroAccounts(connectionId: string, syncJobId: string): Promise<void> {
  const { xero, tenantId, orgId } = await getXeroClient(connectionId);

  let xeroAccounts: Account[];
  try {
    const result = await withRateLimitRetry(
      "getAccounts",
      () => xero.accountingApi.getAccounts(tenantId),
      connectionId,
      orgId,
    );
    xeroAccounts = result.body.accounts ?? [];
  } catch (err) {
    console.error({
      event: "xero_import_accounts_fetch_failed",
      connectionId,
      orgId,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  let successCount = 0;

  for (const account of xeroAccounts) {
    // Require external_id (Xero accountID). Without it we cannot deduplicate.
    if (!account.accountID) {
      await db.insert(dataQualityLog).values({
        orgId,
        syncJobId,
        sourceSystem: "xero",
        issueType: "missing_external_id",
        issueDetail: "Xero account has no accountID field; cannot upsert without a dedup key",
        // rawData intentionally omitted — may contain customer PII
      });
      continue;
    }

    // Require a non-empty name.
    const name = account.name?.trim() ?? "";
    if (!name) {
      await db.insert(dataQualityLog).values({
        orgId,
        syncJobId,
        externalId: account.accountID,
        sourceSystem: "xero",
        issueType: "missing_name",
        issueDetail: "Xero account has a null or blank name field",
        // rawData intentionally omitted
      });
      continue;
    }

    // Map the runtime string AccountType enum value to internal account type.
    const typeStr = String(account.type ?? "");
    const accountType = XERO_ACCOUNT_TYPE_MAP[typeStr] ?? "expense";

    if (!XERO_ACCOUNT_TYPE_MAP[typeStr]) {
      await db.insert(dataQualityLog).values({
        orgId,
        syncJobId,
        externalId: account.accountID,
        sourceSystem: "xero",
        issueType: "unmapped_category",
        issueDetail: `Xero account type "${typeStr}" has no internal mapping; stored as 'expense'`,
      });
    }

    // ACTIVE → true; ARCHIVED or DELETED → false.
    const isActive = String(account.status) === "ACTIVE";

    await db
      .insert(accounts)
      .values({
        orgId,
        externalId: account.accountID,
        sourceSystem: "xero",
        accountType,
        // Xero's account code (e.g. "200" or "SALES") stored in accountSubtype.
        accountSubtype: account.code ?? null,
        name,
        description: account.description ?? null,
        // Xero's Chart of Accounts endpoint does not return current balances.
        currentBalance: null,
        currencyCode: "USD", // Xero does not return currency at account level
        isActive,
        parentAccountId: null, // No parent hierarchy in Xero's COA API response
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [accounts.orgId, accounts.sourceSystem, accounts.externalId],
        set: {
          name,
          accountType,
          accountSubtype: account.code ?? null,
          description: account.description ?? null,
          isActive,
          updatedAt: new Date(),
        },
      });

    successCount++;
  }

  await db.update(syncJobs).set({ recordsSynced: successCount }).where(eq(syncJobs.id, syncJobId));

  console.log({
    event: "xero_import_accounts_complete",
    connectionId,
    orgId,
    syncJobId,
    recordsSynced: successCount,
    totalFetched: xeroAccounts.length,
  });
}

// ─── Transaction import ────────────────────────────────────────────────────────

/** Default page size for Xero paginated endpoints. */
const XERO_PAGE_SIZE = 100;

/**
 * Imports Xero Invoices and BankTransactions for the given connection.
 *
 * Paginated with page=1, 2, 3... stopping when `pagination.page >= pagination.pageCount`
 * or when the page returns an empty result (fallback for when pagination is absent).
 *
 * `ifModifiedSince` is passed when available to limit the result set to records
 * modified since the last successful sync (incremental pull). On first run
 * (`ifModifiedSince === undefined`), all available records are fetched.
 *
 * Behaviour:
 * - Normalises each record via `normalizeXeroInvoice()` or `normalizeXeroBankTransaction()`.
 * - Null normalisation results (missing required fields) → logged to `data_quality_log`.
 * - Unmapped categories (category='other' with a non-null source name) → DQ log.
 * - Upserts on `(orgId, sourceSystem, externalId)`. Idempotent — calling twice
 *   produces no new rows.
 * - Updates `sync_jobs.records_synced` after each page for live progress.
 *
 * @param connectionId   - UUID primary key of the `connections` row.
 * @param syncJobId      - UUID primary key of the `sync_jobs` row for this run.
 * @param ifModifiedSince - Optional ISO Date; only records modified after this
 *   date are returned by Xero. Omit for a full initial pull.
 */
export async function importXeroTransactions(
  connectionId: string,
  syncJobId: string,
  ifModifiedSince?: Date,
): Promise<void> {
  const { xero, tenantId, orgId } = await getXeroClient(connectionId);

  // Resolve Xero accountID → internal accounts.id for the accountId FK.
  const accountRows = await db
    .select({ externalId: accounts.externalId, id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.orgId, orgId), eq(accounts.sourceSystem, "xero")));

  const accountIdMap = new Map<string, string>(accountRows.map((row) => [row.externalId, row.id]));

  let cumulativeCount = 0;

  // ── Inner helper: upsert a batch of normalised transactions ─────────────────
  async function upsertBatch(
    entries: Array<{ norm: ReturnType<typeof normalizeXeroInvoice>; rawId: string }>,
    label: string,
  ): Promise<void> {
    const insertRows: (typeof transactions.$inferInsert)[] = [];

    for (const { norm, rawId } of entries) {
      if (norm === null) {
        await db.insert(dataQualityLog).values({
          orgId,
          syncJobId,
          externalId: rawId,
          sourceSystem: "xero",
          issueType: "missing_required_field",
          issueDetail: `Xero ${label} ${rawId}: missing required field (date, total, or id)`,
        });
        continue;
      }

      // Log unmapped categories only when a source name was available.
      if (norm.category === "other" && norm.categorySource !== null) {
        await db.insert(dataQualityLog).values({
          orgId,
          syncJobId,
          externalId: norm.externalId,
          sourceSystem: "xero",
          issueType: "unmapped_category",
          issueDetail:
            `Xero ${label} ${rawId}: account code/name "${norm.categorySource}" ` +
            "did not match any internal category; stored as 'other'",
        });
      }

      // Resolve the Xero account code to an internal account ID via the map.
      // For Xero, the category source is the account code string — look it up.
      const accountId = norm.categorySource
        ? (accountIdMap.get(norm.categorySource) ?? null)
        : null;

      insertRows.push({
        orgId,
        externalId: norm.externalId,
        sourceSystem: "xero",
        transactionDate: norm.transactionDate,
        amount: norm.amount,
        currencyCode: norm.currencyCode,
        amountBase: null, // multi-currency out of V1 scope
        transactionType: norm.transactionType,
        category: norm.category,
        subcategory: null,
        description: norm.description,
        vendorName: norm.vendorName,
        accountId,
        referenceNumber: norm.referenceNumber,
        isReconciled: norm.isReconciled,
        rawData: null, // NEVER store raw Xero data — may contain customer PII
        updatedAt: new Date(),
      });
    }

    if (insertRows.length === 0) return;

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
    await db
      .update(syncJobs)
      .set({ recordsSynced: cumulativeCount })
      .where(eq(syncJobs.id, syncJobId));
  }

  // ── Import Invoices (paginated) ──────────────────────────────────────────────
  {
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      let invoiceList: Invoice[] = [];
      let pageCount: number | undefined;

      try {
        const result = await withRateLimitRetry(
          `getInvoices page=${page}`,
          () =>
            xero.accountingApi.getInvoices(
              tenantId,
              ifModifiedSince,
              undefined, // where
              undefined, // order
              undefined, // IDs
              undefined, // invoiceNumbers
              undefined, // contactIDs
              ["AUTHORISED", "PAID"], // statuses — skip DRAFT/DELETED/VOIDED
              page,
              undefined, // includeArchived
              undefined, // createdByMyApp
              undefined, // unitdp
              undefined, // summaryOnly
              XERO_PAGE_SIZE,
            ),
          connectionId,
          orgId,
        );
        invoiceList = result.body.invoices ?? [];
        pageCount = result.body.pagination?.pageCount;
      } catch (err) {
        console.error({
          event: "xero_import_invoices_fetch_failed",
          connectionId,
          orgId,
          page,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }

      await upsertBatch(
        invoiceList.map((inv) => ({
          norm: normalizeXeroInvoice(inv),
          rawId: inv.invoiceID ?? "unknown",
        })),
        "invoice",
      );

      // Stop if we have reached the last page or got an empty result.
      if (invoiceList.length === 0) {
        hasMore = false;
      } else if (pageCount !== undefined) {
        hasMore = page < pageCount;
      } else {
        // No pagination metadata — assume done if we got fewer than page size.
        hasMore = invoiceList.length >= XERO_PAGE_SIZE;
      }
      page++;
    }
  }

  // ── Import BankTransactions (paginated) ──────────────────────────────────────
  {
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      let bankTxnList: BankTransaction[] = [];
      let pageCount: number | undefined;

      try {
        const result = await withRateLimitRetry(
          `getBankTransactions page=${page}`,
          () =>
            xero.accountingApi.getBankTransactions(
              tenantId,
              ifModifiedSince,
              undefined, // where
              undefined, // order
              page,
              undefined, // unitdp
              XERO_PAGE_SIZE,
            ),
          connectionId,
          orgId,
        );
        bankTxnList = result.body.bankTransactions ?? [];
        pageCount = result.body.pagination?.pageCount;
      } catch (err) {
        console.error({
          event: "xero_import_bank_transactions_fetch_failed",
          connectionId,
          orgId,
          page,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }

      await upsertBatch(
        bankTxnList.map((bt) => ({
          norm: normalizeXeroBankTransaction(bt),
          rawId: bt.bankTransactionID ?? "unknown",
        })),
        "bankTransaction",
      );

      if (bankTxnList.length === 0) {
        hasMore = false;
      } else if (pageCount !== undefined) {
        hasMore = page < pageCount;
      } else {
        hasMore = bankTxnList.length >= XERO_PAGE_SIZE;
      }
      page++;
    }
  }

  console.log({
    event: "xero_import_transactions_complete",
    connectionId,
    orgId,
    syncJobId,
    recordsSynced: cumulativeCount,
  });
}

// ─── Incremental sync orchestrator ────────────────────────────────────────────

/**
 * Performs an incremental sync for the given Xero connection.
 *
 * Step order:
 *   1. Read connection row (orgId, lastSyncedAt, syncStatus) from DB.
 *   2. Guard: stop if syncStatus is 'auth_expired' or 'disconnected'.
 *   3. Create sync_jobs row (jobType='incremental', status='running').
 *   4. importXeroAccounts() — refresh the Chart of Accounts.
 *   5. importXeroTransactions(ifModifiedSince=lastSyncedAt) — incremental pull;
 *      on first run (lastSyncedAt=null) fetches all available history.
 *   6. Update connections — lastSyncedAt=now, syncStatus='active'.
 *   7. Update sync_jobs — status='completed', completedAt=now, durationMs.
 *
 * On any error:
 *   - Re-reads connections.sync_status to preserve 'auth_expired' if
 *     getXeroClient() already wrote it before rethrowing.
 *   - Sets connections.sync_error_message.
 *   - Sets sync_jobs.status='failed'.
 *   - Rethrows so single-org.ts can classify and dispatch further events.
 *
 * Error classification (CLAUDE.md):
 *   - 401/403 (isXeroAuthExpiredError): getXeroClient() already writes
 *     'auth_expired' and rethrows. The catch below preserves that value.
 *   - 429: handled by withRateLimitRetry (30 s pause + one retry).
 *     If retry fails, error propagates here → sync_jobs='failed'.
 *   - 5xx/network: propagates here → sync_jobs='failed'.
 *
 * @param connectionId - UUID primary key of the `connections` row.
 */
export async function incrementalXeroSync(connectionId: string): Promise<void> {
  // ── 1. Read connection row ──────────────────────────────────────────────────
  const connectionRows = await db
    .select({
      orgId: connections.orgId,
      lastSyncedAt: connections.lastSyncedAt,
      syncStatus: connections.syncStatus,
    })
    .from(connections)
    .where(eq(connections.id, connectionId));

  const connection = connectionRows[0];
  if (!connection) {
    throw new Error(`XERO_INCREMENTAL_SYNC_CONNECTION_NOT_FOUND: connectionId=${connectionId}`);
  }

  const { orgId, lastSyncedAt, syncStatus } = connection;

  // ── 2. Guard: do not proceed if auth is expired or disconnected ─────────────
  if (syncStatus === "auth_expired" || syncStatus === "disconnected") {
    const reason =
      syncStatus === "auth_expired"
        ? "Xero token is expired — user must reconnect via OAuth"
        : "connection is disconnected";
    throw new Error(`XERO_INCREMENTAL_SYNC_BLOCKED: connectionId=${connectionId} ${reason}`);
  }

  // ── 3. Create sync_jobs row ─────────────────────────────────────────────────
  const insertedJobs = await db
    .insert(syncJobs)
    .values({
      orgId,
      connectionId,
      jobType: "incremental",
      status: "running",
      startedAt: new Date(),
    })
    .returning({ id: syncJobs.id });

  const newJob = insertedJobs[0];
  if (!newJob) {
    throw new Error(`XERO_INCREMENTAL_SYNC_JOB_INSERT_FAILED: connectionId=${connectionId}`);
  }

  const syncJobId = newJob.id;
  const startedAtMs = Date.now();

  console.log({
    event: "xero_incremental_sync_started",
    connectionId,
    orgId,
    syncJobId,
    since: lastSyncedAt?.toISOString() ?? "full-pull (first run)",
  });

  try {
    // ── 4. Import Chart of Accounts ──────────────────────────────────────────
    await importXeroAccounts(connectionId, syncJobId);

    // ── 5. Import transactions ───────────────────────────────────────────────
    // `ifModifiedSince=lastSyncedAt` limits Xero to records modified since the
    // last successful sync. On first run (null), fetches all available history.
    await importXeroTransactions(connectionId, syncJobId, lastSyncedAt ?? undefined);

    // ── 6. Update connection row ─────────────────────────────────────────────
    await db
      .update(connections)
      .set({
        lastSyncedAt: new Date(),
        syncStatus: "active",
        syncErrorMessage: null,
      })
      .where(eq(connections.id, connectionId));

    // ── 7. Mark sync job completed ───────────────────────────────────────────
    const durationMs = Date.now() - startedAtMs;
    await db
      .update(syncJobs)
      .set({
        status: "completed",
        completedAt: new Date(),
        durationMs,
      })
      .where(eq(syncJobs.id, syncJobId));

    console.log({
      event: "xero_incremental_sync_complete",
      connectionId,
      orgId,
      syncJobId,
      durationMs,
    });
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);

    console.error({
      event: "xero_incremental_sync_failed",
      connectionId,
      orgId,
      syncJobId,
      errorMessage: errMessage,
    });

    // Re-read current syncStatus to preserve 'auth_expired' if getXeroClient()
    // already wrote it during proactive token refresh or updateTenants() failure.
    const statusRows = await db
      .select({ syncStatus: connections.syncStatus })
      .from(connections)
      .where(eq(connections.id, connectionId));

    const currentStatus = statusRows[0]?.syncStatus;
    const failStatus: string = currentStatus === "auth_expired" ? "auth_expired" : "failed";

    await db
      .update(connections)
      .set({
        syncStatus: failStatus,
        syncErrorMessage: errMessage,
      })
      .where(eq(connections.id, connectionId));

    const durationMs = Date.now() - startedAtMs;
    await db
      .update(syncJobs)
      .set({
        status: "failed",
        completedAt: new Date(),
        durationMs,
      })
      .where(eq(syncJobs.id, syncJobId));

    throw err;
  }
}
