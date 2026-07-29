import { NonRetriableError } from "inngest";

import { recomputeSnapshots } from "@/lib/financial/aggregations/dashboard";
import { inngest } from "@/lib/inngest";
import { incrementalSync } from "@/lib/integrations/quickbooks/import";

/**
 * Event data shape for `sync/org.requested`.
 * Dispatched by `syncFanOut` (fan-out.ts) and by the manual sync trigger
 * (`POST /api/connections/[id]/sync`).
 */
type SyncOrgEventData = {
  connectionId: string;
  orgId: string;
};

/**
 * Per-org sync job. Triggered by `sync/org.requested`.
 *
 * Executes three ordered steps — the ordering is non-negotiable per CLAUDE.md:
 *   1. pull-transactions   — imports QB data via incrementalSync()
 *   2. recompute-snapshots — aggregates transactions into financial_snapshots
 *                            (stub until Step 4.10; replaced by recomputeSnapshots())
 *   3. trigger-intelligence-run — dispatches `intelligence/run.requested` so the
 *                                  nightly intelligence engine runs against fresh data
 *
 * Step 2 MUST complete before Step 3 fires. Inngest's sequential step execution
 * guarantees this: each `await step.run(...)` or `await step.sendEvent(...)` is
 * a checkpoint; the next line only executes after the previous step is recorded
 * as complete.
 *
 * Error handling (per CLAUDE.md "API errors … are classified before handling"):
 *   - auth_expired: `incrementalSync()` sets `connections.sync_status = 'auth_expired'`
 *     before throwing. Detected here and rethrown as `NonRetriableError` so Inngest
 *     does not retry — retrying with an expired token only produces more 401s.
 *   - All other errors: logged and rethrown so Inngest retries the job.
 *   - If `pull-transactions` fails for any reason, `recompute-snapshots` and
 *     `trigger-intelligence-run` do NOT run — throwing exits the handler.
 */
export const syncSingleOrg = inngest.createFunction(
  { id: "sync-single-org" },
  { event: "sync/org.requested" },
  async ({ event, step }): Promise<void> => {
    // event.data is typed as `any` by the unparameterised Inngest client.
    // Assert the known shape — fan-out.ts and the manual sync trigger both
    // dispatch exactly this payload.
    const { connectionId, orgId } = event.data as SyncOrgEventData;

    // ── Step 1: pull-transactions ──────────────────────────────────────────────
    // incrementalSync() fetches QB Chart of Accounts + transactions since the
    // last successful sync, upserts them, and updates connection + sync_jobs rows.
    // On first run (last_synced_at = null), it performs a full 13-month pull.
    try {
      await step.run("pull-transactions", async (): Promise<void> => {
        await incrementalSync(connectionId);
      });
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err);

      // CLAUDE.md: "401 → sync_status = 'auth_expired', stop, never retry."
      // incrementalSync() already writes sync_status='auth_expired' to the DB.
      // Both paths that indicate this are checked:
      //   • INCREMENTAL_SYNC_BLOCKED: thrown by the guard at the top of
      //     incrementalSync() when syncStatus is already 'auth_expired'.
      //   • auth_expired in the message: set by getQuickBooksClient() when a
      //     token refresh fails mid-sync.
      const isAuthExpired =
        errMessage.includes("auth_expired") || errMessage.includes("INCREMENTAL_SYNC_BLOCKED");

      console.error({
        event: "sync_pull_transactions_failed",
        connectionId,
        orgId,
        isAuthExpired,
        errorMessage: errMessage,
      });

      if (isAuthExpired) {
        // NonRetriableError tells Inngest to mark this run as permanently failed
        // without scheduling additional retries.
        throw new NonRetriableError(
          `Connection ${connectionId} auth expired — user must reconnect via OAuth`,
        );
      }

      // For all other errors (429 exhausted, 5xx, network), rethrow so Inngest
      // retries the job. incrementalSync() handles the sync_job row failure state.
      throw err;
    }

    // ── Step 2: recompute-snapshots ────────────────────────────────────────────
    // Aggregate the freshly imported transactions into `financial_snapshots`
    // (7 monthly rows) via backend-engineer's recomputeSnapshots(). All monetary
    // aggregation happens in SQL; the upsert is idempotent on
    // (org_id, period_start, period_type) so a re-sync updates rows in place.
    await step.run("recompute-snapshots", async (): Promise<void> => {
      await recomputeSnapshots(orgId);
    });

    // ── Step 3: trigger-intelligence-run ──────────────────────────────────────
    // Dispatch the intelligence engine event AFTER recompute-snapshots completes.
    // The intelligence engine reads from financial_snapshots — it must run against
    // freshly aggregated data, not stale snapshots from the previous sync cycle.
    await step.sendEvent("trigger-intelligence-run", {
      name: "intelligence/run.requested",
      data: { orgId },
    });
  },
);
