import { and, eq, gte, lte, sql } from "drizzle-orm";
import { generateText } from "ai";

import { inngest } from "@/lib/inngest";
import { db } from "@/lib/platform/db/client";
import { connections, financialSnapshots, reports, transactions } from "@/lib/platform/db/schema";
import { getModel, detectRateLimitError } from "@/lib/ai/models/router";
import { buildReportPrompt, type ReportContent } from "@/lib/ai/prompts/report";
import { formatDate } from "@/lib/format";

/**
 * One day in milliseconds — used for last-day-of-prior-month calculation.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

/** Format a `Date` as a 'YYYY-MM-DD' string for a Postgres `date` column. */
function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Compute the gross margin percentage from two DECIMAL strings.
 * This is the documented JS-arithmetic exception (ratio computation only —
 * never a stored monetary sum). Returns null when revenue is zero or
 * non-finite, matching the `computeGrossMargin` pattern in anomaly.ts.
 */
function computeGrossMarginPct(revenue: string, expenses: string): number | null {
  const rev = parseFloat(revenue);
  const exp = parseFloat(expenses);
  if (!Number.isFinite(rev) || !Number.isFinite(exp) || rev <= 0) {
    return null;
  }
  return ((rev - exp) / rev) * 100;
}

/**
 * Compute a month-over-month percentage change from two DECIMAL strings.
 * Returns null when the prior value is zero or either value is non-finite.
 */
function computeMomPct(current: string, prior: string | null): number | null {
  if (prior === null) return null;
  const c = parseFloat(current);
  const p = parseFloat(prior);
  if (!Number.isFinite(c) || !Number.isFinite(p) || p === 0) {
    return null;
  }
  return ((c - p) / Math.abs(p)) * 100;
}

/**
 * Convert a raw JSONB category map (`{ category: amountString }`) into a
 * sorted list capped at `limit`. The `parseFloat` call is for comparison only —
 * no monetary value is computed (CLAUDE.md, Financial Data Rules).
 */
function sortedCategoryList(
  raw: unknown,
  limit: number,
): Array<{ category: string; amount: string }> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return [];
  }
  return Object.entries(raw as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .sort(([, a], [, b]) => parseFloat(b) - parseFloat(a))
    .slice(0, limit)
    .map(([category, amount]) => ({ category, amount }));
}

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

type ReportGenerateEventData = {
  orgId: string;
  periodStart: string;
  periodEnd: string;
  triggeredBy?: string;
};

// ---------------------------------------------------------------------------
// Step return types (must be JSON-serializable for Inngest memoization)
// ---------------------------------------------------------------------------

type NarrativeStepResult = {
  text: string;
  tokensUsed: number;
} | null;

// ---------------------------------------------------------------------------
// Function A: Monthly Report Cron
// ---------------------------------------------------------------------------

/**
 * Monthly report fan-out cron. Runs at 05:00 UTC on the 1st of each month.
 *
 * Queries every org with an active, successfully synced connection and
 * dispatches one `report/generate.requested` event per org for the prior
 * calendar month. The per-org generator (`monthly-report-generate`) picks up
 * each event independently.
 */
export const monthlyReportCron = inngest.createFunction(
  { id: "monthly-report-cron" },
  { cron: "0 5 1 * *" },
  async ({ step }): Promise<void> => {
    const activeOrgIds = await step.run("get-active-orgs", async (): Promise<string[]> => {
      const rows = await db
        .selectDistinct({ orgId: connections.orgId })
        .from(connections)
        .where(and(eq(connections.isActive, true), eq(connections.syncStatus, "success")));

      return rows.map((row) => row.orgId);
    });

    if (activeOrgIds.length === 0) {
      console.log({ event: "monthly_report_cron_dispatched", count: 0 });
      return;
    }

    // Compute the prior calendar month date range in UTC. This step runs on
    // the 1st, so "prior month" is the month that just ended.
    const now = new Date();
    const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const priorMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const priorMonthEnd = new Date(currentMonthStart.getTime() - DAY_MS);
    const periodStart = toYmd(priorMonthStart);
    const periodEnd = toYmd(priorMonthEnd);

    const events = activeOrgIds.map((orgId) => ({
      name: "report/generate.requested" as const,
      data: { orgId, periodStart, periodEnd, triggeredBy: "cron" as const },
    }));

    await step.sendEvent("dispatch-report-events", events);

    console.log({ event: "monthly_report_cron_dispatched", count: activeOrgIds.length });
  },
);

// ---------------------------------------------------------------------------
// Function B: Per-Org Report Generator
// ---------------------------------------------------------------------------

/**
 * Per-org monthly report generator. Triggered by `report/generate.requested`.
 *
 * Steps:
 *   1. upsert-report-row   — Create/upsert the `reports` row as "generating".
 *   2. gather-metrics      — Pull the financial_snapshots row and compute
 *                            gross margin + MoM percentage fields.
 *   3. generate-narrative  — Call `getModel(0.5)` + `generateText` to produce
 *                            the AI narrative; skip cleanly on 429.
 *   4. mark-ready          — Stamp the report as "ready" with content + narrative.
 *
 * Rate-limit handling: on HTTP 429 the report is marked `status = "failed"`,
 * `generationError = "rate_limit"` and the step returns null — never retried,
 * never failed over to another provider (CLAUDE.md, Intelligence Engine Rules).
 */
export const monthlyReportGenerate = inngest.createFunction(
  { id: "monthly-report-generate" },
  { event: "report/generate.requested" },
  async ({ event, step }): Promise<void> => {
    const { orgId, periodStart, periodEnd } = event.data as ReportGenerateEventData;

    // Human-readable label for the prompt, e.g. "July 2026".
    const periodLabel = formatDate(periodStart, { format: "month-year" });

    // ── Step 1: upsert the reports row (status = "generating") ───────────────
    const reportId = await step.run("upsert-report-row", async (): Promise<string> => {
      const [report] = await db
        .insert(reports)
        .values({
          orgId,
          reportType: "monthly_summary",
          periodStart,
          periodEnd,
          status: "generating",
          generationAttemptedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [reports.orgId, reports.periodStart, reports.reportType],
          set: {
            status: "generating",
            generationAttemptedAt: new Date(),
            generationError: null,
          },
        })
        .returning({ id: reports.id });

      if (!report) {
        throw new Error("REPORT_INSERT_FAILED");
      }

      return report.id;
    });

    // ── Step 2: gather financial metrics ─────────────────────────────────────
    // Query the current period snapshot and, if available, the prior month
    // snapshot for MoM calculation. Compute percentages in JavaScript
    // (ratio-only exception to the no-JS-arithmetic rule — CLAUDE.md).
    const metrics = await step.run("gather-metrics", async (): Promise<ReportContent | null> => {
      // Current period snapshot
      const [snapshot] = await db
        .select({
          totalRevenue: financialSnapshots.totalRevenue,
          totalExpenses: financialSnapshots.totalExpenses,
          netProfit: financialSnapshots.netProfit,
          expenseByCategory: financialSnapshots.expenseByCategory,
          revenueByCategory: financialSnapshots.revenueByCategory,
        })
        .from(financialSnapshots)
        .where(
          and(
            eq(financialSnapshots.orgId, orgId),
            eq(financialSnapshots.periodStart, periodStart),
            eq(financialSnapshots.periodType, "month"),
          ),
        )
        .limit(1);

      if (!snapshot) {
        return null;
      }

      // Prior month snapshot for MoM calculation
      const periodStartDate = new Date(`${periodStart}T00:00:00Z`);
      const priorMonthStartDate = new Date(
        Date.UTC(periodStartDate.getUTCFullYear(), periodStartDate.getUTCMonth() - 1, 1),
      );
      const priorPeriodStart = toYmd(priorMonthStartDate);

      const [priorSnapshot] = await db
        .select({
          totalRevenue: financialSnapshots.totalRevenue,
          totalExpenses: financialSnapshots.totalExpenses,
          netProfit: financialSnapshots.netProfit,
        })
        .from(financialSnapshots)
        .where(
          and(
            eq(financialSnapshots.orgId, orgId),
            eq(financialSnapshots.periodStart, priorPeriodStart),
            eq(financialSnapshots.periodType, "month"),
          ),
        )
        .limit(1);

      // Transaction count for the period (SQL COUNT — not a monetary value)
      const [countRow] = await db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(transactions)
        .where(
          and(
            eq(transactions.orgId, orgId),
            gte(transactions.transactionDate, periodStart),
            lte(transactions.transactionDate, periodEnd),
          ),
        );

      const totalRevenue = snapshot.totalRevenue ?? "0.00";
      const totalExpenses = snapshot.totalExpenses ?? "0.00";
      const netProfit = snapshot.netProfit ?? "0.00";

      return {
        totalRevenue,
        totalExpenses,
        netProfit,
        grossMarginPct: computeGrossMarginPct(totalRevenue, totalExpenses),
        momRevenuePct: computeMomPct(totalRevenue, priorSnapshot?.totalRevenue ?? null),
        momExpensesPct: computeMomPct(totalExpenses, priorSnapshot?.totalExpenses ?? null),
        momNetProfitPct: computeMomPct(netProfit, priorSnapshot?.netProfit ?? null),
        topExpenseCategories: sortedCategoryList(snapshot.expenseByCategory, 5),
        topRevenueCategories: sortedCategoryList(snapshot.revenueByCategory, 3),
        transactionCount: countRow?.count ?? 0,
      };
    });

    // ── Step 3: generate the AI narrative ────────────────────────────────────
    // If no snapshot exists for the period, mark the report failed and return.
    // On HTTP 429, mark failed with rate_limit reason and return cleanly —
    // never retry with a different provider (CLAUDE.md, Intelligence Engine Rules).
    const narrativeResult = await step.run(
      "generate-narrative",
      async (): Promise<NarrativeStepResult> => {
        if (metrics === null) {
          await db
            .update(reports)
            .set({ status: "failed", generationError: "No snapshot data for period" })
            .where(eq(reports.id, reportId));
          return null;
        }

        const model = getModel(0.5);
        const prompt = buildReportPrompt(metrics, periodLabel);

        try {
          const result = await generateText({ model, prompt, maxTokens: 600 });
          return { text: result.text, tokensUsed: result.usage.totalTokens };
        } catch (err) {
          if (detectRateLimitError(err)) {
            await db
              .update(reports)
              .set({ status: "failed", generationError: "rate_limit" })
              .where(eq(reports.id, reportId));
            return null;
          }
          await db
            .update(reports)
            .set({
              status: "failed",
              generationError: err instanceof Error ? err.message : String(err),
            })
            .where(eq(reports.id, reportId));
          throw err;
        }
      },
    );

    if (narrativeResult === null) {
      return;
    }

    // ── Step 4: mark the report ready ────────────────────────────────────────
    await step.run("mark-ready", async (): Promise<void> => {
      const model = getModel(0.5);

      await db
        .update(reports)
        .set({
          status: "ready",
          generatedAt: new Date(),
          content: metrics as Record<string, unknown>,
          plainTextSummary: narrativeResult.text,
          modelUsed: model.modelId,
          tokensUsed: narrativeResult.tokensUsed,
        })
        .where(eq(reports.id, reportId));
    });
  },
);
