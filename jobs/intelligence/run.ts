import { and, desc, eq, sql } from "drizzle-orm";

import type {
  CashFlowProjection,
  CashFlowRiskFindingResult,
} from "@/lib/financial/intelligence/cash-flow";
import {
  buildCashFlowProjection,
  generateCashFlowRiskFinding,
  isCashFlowRisk,
  storeCashFlowProjection,
} from "@/lib/financial/intelligence/cash-flow";
import { runAnomalyDetection, runMarginDetection } from "@/lib/financial/intelligence/anomaly";
import { runArAgingAnalysis } from "@/lib/financial/intelligence/ar-aging-intelligence";
import { runDuplicateSubscriptionScan } from "@/lib/financial/intelligence/duplicates";
import type { EmailDispatchDecision } from "@/jobs/intelligence/email";
import { computeEmailDispatch } from "@/jobs/intelligence/email";
import { db } from "@/lib/platform/db/client";
import {
  connections,
  findings,
  intelligenceRuns,
  syncJobs,
  transactions,
} from "@/lib/platform/db/schema";
import { inngest } from "@/lib/inngest";

/**
 * Event data shape for `intelligence/run.requested`.
 *
 * Dispatched by the per-org sync job (`jobs/sync/single-org.ts`) after snapshots
 * are recomputed, and — later — by the nightly intelligence fan-out. `runType`
 * distinguishes a scheduled/nightly run from a user-triggered one; it is optional
 * and defaults to a scheduled run when omitted.
 */
type IntelligenceRunEventData = {
  orgId: string;
  runType?: "scheduled" | "manual";
};

/**
 * The two pre-analysis guards' combined result. Guards are NOT analysis steps —
 * combining the history and sync checks in a single `step.run()` is intentional
 * and does not violate the Phase 6 "one analysis type per step" rule, which
 * governs the AI-backed analysis steps (cash flow, anomaly, margin, AR aging,
 * duplicates) added in Steps 6.2–6.7.
 */
type GuardResult = { skip: true; reason: "insufficient_history" | "sync_failed" } | { skip: false };

/** Minimum days of transaction history required to run the intelligence engine. */
const MINIMUM_HISTORY_DAYS = 60;

/**
 * The proactive intelligence engine's per-org runner. Triggered by
 * `intelligence/run.requested`.
 *
 * This step (6.0) establishes the run record and the two entry guards. The
 * analysis steps (cash flow projection, anomaly detection, margin detection, AR
 * aging analysis, duplicate subscription scan) are each added in a later step as
 * their own isolated `step.run()` call — never combined — because Vercel Hobby
 * imposes a 10-second per-invocation timeout and each analysis must complete in
 * under 8 seconds in isolation (CLAUDE.md).
 *
 * Guard 1 (insufficient history): the engine never runs on an org with fewer
 * than 60 days of transaction data. On failure the run is marked
 * `status = 'skipped'`, `skipped_reason = 'insufficient_history'` and the handler
 * returns cleanly — it never throws (a throw would cause Inngest to retry a
 * condition that will not change on retry).
 *
 * Guard 2 (sync failed): the engine never runs on data from a failed or
 * in-progress sync. If the most recent `sync_jobs` row for this org is not
 * `completed`, the run is marked `status = 'skipped'`,
 * `skipped_reason = 'sync_failed'` and the handler returns cleanly.
 */
export const intelligenceRun = inngest.createFunction(
  { id: "intelligence-run" },
  { event: "intelligence/run.requested" },
  async ({ event, step }): Promise<void> => {
    // event.data is typed as `any` by the unparameterised Inngest client. Assert
    // the known shape — every dispatcher of this event sends exactly this payload.
    const { orgId, runType } = event.data as IntelligenceRunEventData;

    // ── Step 1: create the intelligence_runs row (status = 'running') ──────────
    // `run_type` is VARCHAR with domain {scheduled, triggered}; a user-triggered
    // ("manual") request maps to 'triggered', anything else to 'scheduled'.
    const runId = await step.run("create-run", async (): Promise<string> => {
      const [run] = await db
        .insert(intelligenceRuns)
        .values({
          orgId,
          runType: runType === "manual" ? "triggered" : "scheduled",
          status: "running",
          startedAt: new Date(),
        })
        .returning({ id: intelligenceRuns.id });

      if (!run) {
        // Insert always returns the row on success; a missing row is an
        // unexpected database failure, not a normal control-flow branch.
        throw new Error("INTELLIGENCE_RUN_INSERT_FAILED");
      }

      return run.id;
    });

    // ── Step 2: guards (history + sync status) ─────────────────────────────────
    const guard = await step.run("check-guards", async (): Promise<GuardResult> => {
      // Guard 1: at least 60 days of transaction history. The day count is
      // computed in SQL (`CURRENT_DATE - MIN(transaction_date)` yields an integer
      // day count in Postgres). An org with no transactions returns NULL, which is
      // treated as insufficient history.
      const [history] = await db
        .select({
          daysAvailable: sql<number | null>`CURRENT_DATE - MIN(${transactions.transactionDate})`,
        })
        .from(transactions)
        .where(eq(transactions.orgId, orgId));

      const daysAvailable = history?.daysAvailable ?? null;

      if (daysAvailable === null || daysAvailable < MINIMUM_HISTORY_DAYS) {
        return { skip: true, reason: "insufficient_history" };
      }

      // Guard 2: the most recent sync for this org must have completed. Running
      // analysis on data from a failed or in-progress sync would surface findings
      // against an inconsistent dataset.
      const [latestSync] = await db
        .select({ status: syncJobs.status })
        .from(syncJobs)
        .where(eq(syncJobs.orgId, orgId))
        .orderBy(desc(syncJobs.startedAt))
        .limit(1);

      if (!latestSync || latestSync.status !== "completed") {
        return { skip: true, reason: "sync_failed" };
      }

      return { skip: false };
    });

    if (guard.skip) {
      const reason = guard.reason;
      await step.run("mark-skipped", async (): Promise<void> => {
        await db
          .update(intelligenceRuns)
          .set({ status: "skipped", skippedReason: reason })
          .where(eq(intelligenceRuns.id, runId));
      });
      return;
    }

    // ── Step 6.2: cash flow projection (isolated analysis step) ────────────────
    // Its own `step.run()` — never combined with anomaly, margin, AR-aging, or
    // duplicate analysis (CLAUDE.md, Intelligence Engine Rules). Building and
    // persisting a 30-day projection is deterministic arithmetic (no AI) and
    // completes well under the 8-second Vercel Hobby budget in isolation. The
    // projection is returned so the finding decision below runs against it; its
    // fields are all strings/arrays and survive Inngest's JSON memoization.
    const projection = await step.run(
      "cash-flow-projection",
      async (): Promise<CashFlowProjection> => {
        const proj = await buildCashFlowProjection(orgId, 30);
        await storeCashFlowProjection(orgId, proj);
        return proj;
      },
    );

    // A `cash_flow_risk` finding is warranted only when the projected minimum
    // balance breaches the buffer threshold (projected to go negative in-window).
    if (isCashFlowRisk(projection)) {
      const findingResult = await step.run(
        "cash-flow-risk-finding",
        (): Promise<CashFlowRiskFindingResult> =>
          generateCashFlowRiskFinding(orgId, runId, projection),
      );

      // Rate-limit skip: the AI provider returned 429. `generateCashFlowRiskFinding`
      // has already marked the run `status = 'skipped'`, `skipped_reason =
      // 'rate_limit'`. Return cleanly — never throw (Inngest would retry an
      // unchanged condition) and never fail over to another provider (CLAUDE.md).
      if (findingResult.status === "skipped") {
        return;
      }
    }

    // ── Step 6.3: anomaly detection (isolated analysis step) ───────────────────
    // Expense spike + collections slippage. Its own `step.run()` — never combined
    // with cash flow or margin analysis (CLAUDE.md, Intelligence Engine Rules) so
    // it completes well under the 8-second Vercel Hobby budget in isolation. On a
    // 429 the run has already been marked `status = 'skipped'`, `skipped_reason =
    // 'rate_limit'` inside `runAnomalyDetection`; return cleanly — never throw, never
    // fail over to another provider.
    const anomalyResult = await step.run("anomaly-detection", () =>
      runAnomalyDetection(orgId, runId),
    );
    if (anomalyResult.status === "skipped") {
      return;
    }

    // ── Step 6.4: margin deterioration detection (isolated analysis step) ──────
    // Current MTD gross margin vs the same period a year ago. Separate `step.run()`,
    // never combined with anomaly detection. Skips silently when the org has fewer
    // than 12 months of history. Same 429 skip contract as above.
    const marginResult = await step.run("margin-detection", () => runMarginDetection(orgId, runId));
    if (marginResult.status === "skipped") {
      return;
    }

    // ── Step 6.5: AR aging collections-opportunity analysis (isolated step) ────
    // Overdue receivables (unreconciled income past the net-30 grace window) →
    // a `collections_opportunity` finding whose `related_data` carries the
    // per-invoice detail (id, amount, client name, days outstanding) the Phase 9
    // agentic layer uses to pre-populate an invoice-acceleration draft. Its own
    // `step.run()` — never combined with anomaly, margin, or duplicate analysis
    // (CLAUDE.md). Same 429 skip contract as above.
    const arAgingResult = await step.run("ar-aging-analysis", () =>
      runArAgingAnalysis(orgId, runId),
    );
    if (arAgingResult.status === "skipped") {
      return;
    }

    // ── Step 6.6: duplicate subscription scan (isolated step) ──────────────────
    // The same vendor billed across two different expense accounts with amounts
    // within 10% in the recent billing window → a `duplicate_subscription`
    // finding. Separate `step.run()`, never combined with AR aging (CLAUDE.md).
    // Same 429 skip contract as above.
    const duplicatesResult = await step.run("duplicate-subscription-scan", () =>
      runDuplicateSubscriptionScan(orgId, runId),
    );
    if (duplicatesResult.status === "skipped") {
      return;
    }

    // ── Step 6.7: mark the run completed (isolated final step) ─────────────────
    // All analysis steps have run without a rate-limit skip. Count the findings
    // actually written for this run (deduplication in `insertFindingDeduped` means
    // this can be fewer than the number of conditions detected — a same-day re-run
    // writes nothing), stamp the run `completed` with that count, and record the
    // connection's `last_intelligence_run_at`. Its own `step.run()`, consistent
    // with the one-concern-per-step structure of the analysis steps above.
    await step.run("mark-completed", async (): Promise<void> => {
      const [countResult] = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(findings)
        .where(eq(findings.intelligenceRunId, runId));
      const findingsGenerated = countResult?.count ?? 0;

      await db
        .update(intelligenceRuns)
        .set({ status: "completed", findingsGenerated })
        .where(eq(intelligenceRuns.id, runId));

      await db
        .update(connections)
        .set({ lastIntelligenceRunAt: new Date() })
        .where(eq(connections.orgId, orgId));
    });

    // ── Step 6.8: severity-gated intelligence email dispatch ───────────────────
    // After findings are written, decide whether to dispatch `intelligence/email.
    // requested`. Only `high`/`critical` findings warrant an email — `medium`/`low`
    // are in-app only (CLAUDE.md — email only on high/critical). The severity read
    // and the decision run inside a `step.run()`; `step.sendEvent` is then called at
    // the top level (Inngest step tools must never be nested inside a `step.run()`
    // callback). A run containing any `critical` finding emails immediately; a
    // `high`-only run is delayed 2 hours via a future event `ts` so a later critical
    // run can pre-empt with an urgent email. (`ts` is Inngest v3's mechanism for a
    // future-scheduled event — there is no `delay`/`delaySeconds` field on a sent
    // event payload.)
    const emailDispatch = await step.run(
      "check-email-severity",
      async (): Promise<EmailDispatchDecision> => {
        const highCritical = await db
          .select({ severity: findings.severity })
          .from(findings)
          .where(
            and(
              eq(findings.orgId, orgId),
              eq(findings.intelligenceRunId, runId),
              sql`${findings.severity} IN ('high', 'critical')`,
            ),
          );

        return computeEmailDispatch(highCritical.map((f) => f.severity));
      },
    );

    if (emailDispatch.send) {
      await step.sendEvent("send-intelligence-email", {
        name: "intelligence/email.requested",
        data: { orgId, runId },
        // `delaySeconds === 0` (critical) → send now (omit `ts`); otherwise schedule
        // the event 2 hours out.
        ...(emailDispatch.delaySeconds > 0
          ? { ts: Date.now() + emailDispatch.delaySeconds * 1000 }
          : {}),
      });
    }
  },
);
