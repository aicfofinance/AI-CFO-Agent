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

import { eq } from "drizzle-orm";

import { db } from "@/lib/platform/db/client";
import { accounts, connections, dataQualityLog, syncJobs } from "@/lib/platform/db/schema";
import { getQuickBooksClient } from "@/lib/integrations/quickbooks/client";
import {
  normalizeAccountName,
  normalizeAccountType,
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
