import { generateText } from "ai";
import { and, eq, sql } from "drizzle-orm";

import { detectRateLimitError, getModel } from "@/lib/ai/models/router";
import { db } from "@/lib/platform/db/client";
import { alertConfigs, intelligenceRuns, transactions } from "@/lib/platform/db/schema";

import { insertFindingDeduped } from "./findings-writer";

/**
 * Anomaly + margin intelligence analysis (Steps 6.3 and 6.4).
 *
 * Two isolated Inngest steps in `jobs/intelligence/run.ts` drive this module:
 *   - `anomaly-detection` → {@link runAnomalyDetection} (expense spike, collections slippage)
 *   - `margin-detection`  → {@link runMarginDetection}  (gross-margin deterioration vs prior year)
 *
 * The detection logic is deterministic and computed in SQL over DECIMAL columns —
 * no monetary arithmetic is performed in JavaScript. The only JS numeric work is
 * (a) threshold *comparisons* via `parseFloat` (no value is stored) and (b) the
 * derived gross-margin percentage, which is the same documented exception used by
 * `financial/aggregations/trends.ts` (`getPeriodComparison`): a ratio derived from
 * SQL-summed strings, not a sum of money in JS.
 *
 * The AI (via `getModel(0.5)` — never a direct provider import, CLAUDE.md) only
 * phrases each finding's headline and detail. The standard financial disclaimer is
 * NOT appended here: that is an end-user streaming concern, not internal finding
 * storage.
 *
 * Rate-limit guard: every step that reaches the AI runs the two `generateText`
 * calls plus the insert inside one try/catch. On HTTP 429 — detected via
 * `detectRateLimitError()` — the run is marked `status = 'skipped'`,
 * `skipped_reason = 'rate_limit'` and the step returns cleanly. It never rethrows a
 * 429 (Inngest would retry an unchanged condition) and never fails over to a
 * different provider (CLAUDE.md, Intelligence Engine Rules). Any non-429 error is
 * rethrown so the step surfaces the genuine failure.
 */

/** Default expense-spike threshold (25%) when no `alert_configs` row exists. */
const EXPENSE_SPIKE_DEFAULT_THRESHOLD = 0.25;
/** `alert_configs.alert_type` value carrying the expense-spike threshold. */
const EXPENSE_SPIKE_ALERT_TYPE = "expense_spike";
/** An unreconciled income transaction older than this many days is slippage. */
const COLLECTIONS_SLIPPAGE_DAYS = 45;
/** Percentage-point gross-margin drop (vs prior year) that warrants an alert. */
const MARGIN_DECLINE_TRIGGER_POINTS = 10;
/** Percentage-point drop at or above which the margin alert is `high` severity. */
const MARGIN_HIGH_SEVERITY_POINTS = 30;

/**
 * The outcome of an isolated analysis step. `completed` carries how many findings
 * were written; `skipped` means the AI provider returned HTTP 429 and the run was
 * marked skipped — the runner must return cleanly without running further steps.
 */
export type IntelligenceStepResult =
  | { status: "completed"; findingsCreated: number }
  | { status: "skipped"; reason: "rate_limit" };

/** The outcome of writing a single finding (used internally by the steps). */
type FindingCreationResult = { status: "created" } | { status: "skipped"; reason: "rate_limit" };

/** A detected expense spike. Both averages are DECIMAL(15,2) strings from SQL. */
export type ExpenseSpike = {
  amount7d: string; // 7-day rolling average daily expense (DECIMAL string)
  amount30d: string; // 30-day rolling average daily expense (DECIMAL string)
};

/** A detected collections slippage condition. */
export type CollectionsSlippage = {
  daysOutstanding: number; // age in days of the oldest outstanding invoice
  invoiceCount: number; // how many unreconciled invoices exceed the age threshold
};

/** A detected gross-margin deterioration vs the same period last year. */
export type MarginDecline = {
  currentMargin: number; // current MTD gross margin, percent
  priorYearMargin: number; // same-period prior-year gross margin, percent
  declinePoints: number; // priorYearMargin - currentMargin, percentage points
};

// ── Pure decision helpers (no I/O; unit-tested in isolation) ─────────────────

/**
 * Whether the 7-day rolling average expense exceeds the 30-day average by more
 * than `thresholdFraction` (0.25 = 25%). `parseFloat` is used for the comparison
 * ONLY — no monetary value is computed or stored. A non-positive 30-day baseline
 * cannot establish a spike, so it returns `false`.
 */
export function isExpenseSpike(avg7d: string, avg30d: string, thresholdFraction: number): boolean {
  const a7 = parseFloat(avg7d);
  const a30 = parseFloat(avg30d);
  if (!Number.isFinite(a7) || !Number.isFinite(a30) || a30 <= 0) {
    return false;
  }
  return a7 > a30 * (1 + thresholdFraction);
}

/**
 * Derived gross margin as a percentage: `(revenue - expenses) / revenue * 100`.
 * Revenue and expenses arrive as DECIMAL strings summed in SQL; the ratio is the
 * documented `trends.ts` exception to the no-JS-monetary-arithmetic rule. Returns
 * `null` when revenue is non-positive (margin is undefined and cannot be compared).
 */
export function computeGrossMargin(revenue: string, expenses: string): number | null {
  const rev = parseFloat(revenue);
  const exp = parseFloat(expenses);
  if (!Number.isFinite(rev) || !Number.isFinite(exp) || rev <= 0) {
    return null;
  }
  return ((rev - exp) / rev) * 100;
}

/**
 * Whether the current gross margin has fallen more than
 * `MARGIN_DECLINE_TRIGGER_POINTS` percentage points below the prior-year margin.
 */
export function isMarginDecline(currentMargin: number, priorYearMargin: number): boolean {
  return currentMargin < priorYearMargin - MARGIN_DECLINE_TRIGGER_POINTS;
}

/**
 * Whether the org has at least 12 months of transaction history — the guard for
 * a prior-year margin comparison. `minDate` is the earliest `transaction_date`
 * (`YYYY-MM-DD`) or `null` when the org has no transactions. Sufficient when the
 * earliest transaction is on or before the same calendar date one year ago.
 */
export function hasSufficientMarginHistory(
  minDate: string | null,
  now: Date = new Date(),
): boolean {
  if (minDate === null) {
    return false;
  }
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  return new Date(`${minDate}T00:00:00Z`).getTime() <= cutoff.getTime();
}

// ── Deterministic detectors (SQL only; org-scoped) ───────────────────────────

/**
 * Detect an expense spike for an org: 7-day vs 30-day rolling average daily
 * expense. Both averages are computed in SQL as DECIMAL(15,2) strings (the sum of
 * `amount` divided by the fixed day count), so no money is summed in JavaScript.
 *
 * The threshold is read from `alert_configs` (`alert_type = 'expense_spike'`,
 * `threshold_value` a DECIMAL fraction such as 0.2500 for 25%), defaulting to
 * {@link EXPENSE_SPIKE_DEFAULT_THRESHOLD} when no row exists.
 *
 * @param orgId Current org id. Both queries are org-scoped.
 * @returns The spike (with both averages) or `null` if no spike is present.
 */
export async function detectExpenseSpike(orgId: string): Promise<ExpenseSpike | null> {
  const [config] = await db
    .select({ thresholdValue: alertConfigs.thresholdValue })
    .from(alertConfigs)
    .where(and(eq(alertConfigs.orgId, orgId), eq(alertConfigs.alertType, EXPENSE_SPIKE_ALERT_TYPE)))
    .limit(1);

  const thresholdFraction = config
    ? parseFloat(config.thresholdValue)
    : EXPENSE_SPIKE_DEFAULT_THRESHOLD;

  const [row] = await db
    .select({
      amount7d: sql<string>`(COALESCE(SUM(CASE WHEN ${transactions.transactionDate} >= CURRENT_DATE - INTERVAL '7 days' THEN ${transactions.amount}::numeric ELSE 0 END), 0) / 7)::numeric(15,2)::text`,
      amount30d: sql<string>`(COALESCE(SUM(CASE WHEN ${transactions.transactionDate} >= CURRENT_DATE - INTERVAL '30 days' THEN ${transactions.amount}::numeric ELSE 0 END), 0) / 30)::numeric(15,2)::text`,
    })
    .from(transactions)
    .where(and(eq(transactions.orgId, orgId), eq(transactions.transactionType, "expense")));

  if (!row || !isExpenseSpike(row.amount7d, row.amount30d, thresholdFraction)) {
    return null;
  }

  return { amount7d: row.amount7d, amount30d: row.amount30d };
}

/**
 * Detect collections slippage: any unreconciled income transaction (an
 * outstanding customer invoice) older than {@link COLLECTIONS_SLIPPAGE_DAYS} days.
 * The per-vendor historical average days-to-collect is a future enhancement
 * (Step 6.3 build note); the V1 heuristic fires on the presence of aged unpaid
 * invoices.
 *
 * @param orgId Current org id. The query is org-scoped.
 * @returns The slippage (oldest age + count) or `null` if none qualify.
 */
export async function detectCollectionsSlippage(
  orgId: string,
): Promise<CollectionsSlippage | null> {
  const [row] = await db
    .select({
      invoiceCount: sql<number>`COUNT(*)::int`,
      maxDaysOutstanding: sql<
        number | null
      >`MAX(CURRENT_DATE - ${transactions.transactionDate}::date)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.orgId, orgId),
        eq(transactions.transactionType, "income"),
        eq(transactions.isReconciled, false),
        sql`${transactions.transactionDate} < CURRENT_DATE - ${COLLECTIONS_SLIPPAGE_DAYS}`,
      ),
    );

  if (!row || row.invoiceCount <= 0) {
    return null;
  }

  return {
    daysOutstanding: row.maxDaysOutstanding ?? COLLECTIONS_SLIPPAGE_DAYS,
    invoiceCount: row.invoiceCount,
  };
}

/**
 * Detect gross-margin deterioration: current month-to-date gross margin versus the
 * same day range 12 months prior. Skips (returns `null`) when the org has fewer
 * than 12 months of history, when either period's revenue is non-positive, or when
 * the decline is within the {@link MARGIN_DECLINE_TRIGGER_POINTS} tolerance.
 *
 * Revenue and expense totals for both periods are summed in SQL (DECIMAL strings);
 * only the derived margin percentages are computed in JS (the `trends.ts`
 * exception).
 *
 * @param orgId Current org id. Both queries are org-scoped.
 * @returns The decline (current + prior margins + point drop) or `null`.
 */
export async function detectMarginDecline(orgId: string): Promise<MarginDecline | null> {
  const [history] = await db
    .select({ minDate: sql<string | null>`MIN(${transactions.transactionDate})` })
    .from(transactions)
    .where(eq(transactions.orgId, orgId));

  if (!hasSufficientMarginHistory(history?.minDate ?? null)) {
    return null;
  }

  // Current period: first-of-this-month → today. Prior period: the identical day
  // range shifted back one year. All four totals summed in SQL over DECIMAL.
  const [row] = await db
    .select({
      currentRevenue: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.transactionType} = 'income' AND ${transactions.transactionDate} >= date_trunc('month', CURRENT_DATE) THEN ${transactions.amount}::numeric ELSE 0 END), 0)::numeric(15,2)::text`,
      currentExpenses: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.transactionType} = 'expense' AND ${transactions.transactionDate} >= date_trunc('month', CURRENT_DATE) THEN ${transactions.amount}::numeric ELSE 0 END), 0)::numeric(15,2)::text`,
      priorRevenue: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.transactionType} = 'income' AND ${transactions.transactionDate} >= (date_trunc('month', CURRENT_DATE) - INTERVAL '1 year') AND ${transactions.transactionDate} <= (CURRENT_DATE - INTERVAL '1 year') THEN ${transactions.amount}::numeric ELSE 0 END), 0)::numeric(15,2)::text`,
      priorExpenses: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.transactionType} = 'expense' AND ${transactions.transactionDate} >= (date_trunc('month', CURRENT_DATE) - INTERVAL '1 year') AND ${transactions.transactionDate} <= (CURRENT_DATE - INTERVAL '1 year') THEN ${transactions.amount}::numeric ELSE 0 END), 0)::numeric(15,2)::text`,
    })
    .from(transactions)
    .where(eq(transactions.orgId, orgId));

  if (!row) {
    return null;
  }

  const currentMargin = computeGrossMargin(row.currentRevenue, row.currentExpenses);
  const priorYearMargin = computeGrossMargin(row.priorRevenue, row.priorExpenses);
  if (currentMargin === null || priorYearMargin === null) {
    return null;
  }

  if (!isMarginDecline(currentMargin, priorYearMargin)) {
    return null;
  }

  const round = (value: number): number => Math.round(value * 100) / 100;
  return {
    currentMargin: round(currentMargin),
    priorYearMargin: round(priorYearMargin),
    declinePoints: round(priorYearMargin - currentMargin),
  };
}

// ── AI phrasing + storage ────────────────────────────────────────────────────

/**
 * Phrases a finding via two `getModel(0.5)` calls (headline + detail) and inserts
 * it. `expires_at` is always NULL for the finding types produced here — `anomaly`
 * and `margin_alert` persist until dismissed or actioned (CLAUDE.md selective
 * expiry). On HTTP 429 the run is marked skipped and no finding is written; any
 * other error is rethrown. See the module doc comment for the full guard contract.
 */
async function generateAndStoreFinding(input: {
  orgId: string;
  intelligenceRunId: string;
  findingType: "anomaly" | "margin_alert";
  severity: "medium" | "high";
  headlinePrompt: string;
  detailPrompt: string;
  relatedData: Record<string, unknown>;
}): Promise<FindingCreationResult> {
  // Draft-level phrasing — default complexity routing (CLAUDE.md: no escalation
  // to a larger model without specific justification).
  const model = getModel(0.5);

  try {
    // Single call combining headline and detail to stay within free-tier rate limits.
    const { text: combined } = await generateText({
      model,
      prompt:
        input.headlinePrompt +
        "\n\nThen on a new line write a 2-3 sentence explanation:\n" +
        input.detailPrompt +
        "\n\nRespond with exactly two labeled lines:\nHEADLINE: <alert headline, max 110 chars>\nDETAIL: <2-3 sentence explanation>",
      maxTokens: 320,
    });
    const headlineMatch = /^HEADLINE:\s*(.+)/m.exec(combined);
    const detailMatch = /^DETAIL:\s*([\s\S]+)/m.exec(combined);
    const fallbackLines = combined
      .trim()
      .split("\n")
      .filter((l) => l.trim().length > 0);
    const headline = (headlineMatch?.[1] ?? fallbackLines[0] ?? "").trim().slice(0, 120);
    const detail = (detailMatch?.[1] ?? fallbackLines.slice(1).join(" ") ?? headline).trim();

    await insertFindingDeduped({
      orgId: input.orgId,
      intelligenceRunId: input.intelligenceRunId,
      findingType: input.findingType,
      severity: input.severity,
      // Headline is VARCHAR(120) with a DB CHECK (length <= 120); hard-cap here so
      // an over-long model response can never violate the constraint.
      headline: headline.trim().slice(0, 120),
      detail: detail.trim(),
      status: "active",
      expiresAt: null,
      relatedData: input.relatedData,
    });

    return { status: "created" };
  } catch (err) {
    if (detectRateLimitError(err)) {
      await db
        .update(intelligenceRuns)
        .set({ status: "skipped", skippedReason: "rate_limit" })
        .where(eq(intelligenceRuns.id, input.intelligenceRunId));
      return { status: "skipped", reason: "rate_limit" };
    }
    throw err;
  }
}

/**
 * Generate and store an `anomaly` finding for a detected expense spike. Severity
 * is `medium` (Step 6.3). `related_data.type` is `'expense_spike'`.
 */
export function generateExpenseSpikeFinding(
  orgId: string,
  intelligenceRunId: string,
  spike: ExpenseSpike,
): Promise<FindingCreationResult> {
  return generateAndStoreFinding({
    orgId,
    intelligenceRunId,
    findingType: "anomaly",
    severity: "medium",
    headlinePrompt:
      `Write a single alert headline for a small-business finance dashboard. ` +
      `Recent spending is running high: the 7-day average daily expense is ` +
      `$${spike.amount7d} versus a 30-day average of $${spike.amount30d}. State that ` +
      `expenses have spiked. Keep it under 110 characters. Return only the headline ` +
      `text, with no surrounding quotes and no preamble.`,
    detailPrompt:
      `Write 2-3 plain-English sentences for a small-business owner explaining an ` +
      `expense spike. The 7-day average daily expense is $${spike.amount7d}, compared ` +
      `with a 30-day average of $${spike.amount30d}. Explain what this means and suggest ` +
      `one concrete step to review recent spending. Do not give formal financial ` +
      `advice. Return only the explanation.`,
    relatedData: { type: "expense_spike", amount7d: spike.amount7d, amount30d: spike.amount30d },
  });
}

/**
 * Generate and store an `anomaly` finding for detected collections slippage.
 * Severity is `medium` (Step 6.3). `related_data.type` is `'collections_slippage'`.
 */
export function generateCollectionsSlippageFinding(
  orgId: string,
  intelligenceRunId: string,
  slippage: CollectionsSlippage,
): Promise<FindingCreationResult> {
  return generateAndStoreFinding({
    orgId,
    intelligenceRunId,
    findingType: "anomaly",
    severity: "medium",
    headlinePrompt:
      `Write a single alert headline for a small-business finance dashboard. ` +
      `${slippage.invoiceCount} customer invoice(s) remain unpaid and are more than ` +
      `${slippage.daysOutstanding} days old. State that collections are slipping. Keep it ` +
      `under 110 characters. Return only the headline text, with no surrounding quotes ` +
      `and no preamble.`,
    detailPrompt:
      `Write 2-3 plain-English sentences for a small-business owner about slow ` +
      `collections. ${slippage.invoiceCount} invoice(s) are unpaid and the oldest is ` +
      `${slippage.daysOutstanding} days outstanding. Explain the cash-flow impact and ` +
      `suggest one concrete step to accelerate collection. Do not give formal financial ` +
      `advice. Return only the explanation.`,
    relatedData: {
      type: "collections_slippage",
      daysOutstanding: slippage.daysOutstanding,
      invoiceCount: slippage.invoiceCount,
    },
  });
}

/**
 * Generate and store a `margin_alert` finding for a detected margin decline.
 * Severity is `high` when the drop is at least {@link MARGIN_HIGH_SEVERITY_POINTS}
 * points, otherwise `medium` (Step 6.4).
 */
export function generateMarginAlertFinding(
  orgId: string,
  intelligenceRunId: string,
  decline: MarginDecline,
): Promise<FindingCreationResult> {
  const severity = decline.declinePoints >= MARGIN_HIGH_SEVERITY_POINTS ? "high" : "medium";
  return generateAndStoreFinding({
    orgId,
    intelligenceRunId,
    findingType: "margin_alert",
    severity,
    headlinePrompt:
      `Write a single alert headline for a small-business finance dashboard. Gross ` +
      `margin has declined to ${decline.currentMargin}% this month from ` +
      `${decline.priorYearMargin}% in the same period last year. State that margins are ` +
      `deteriorating. Keep it under 110 characters. Return only the headline text, with ` +
      `no surrounding quotes and no preamble.`,
    detailPrompt:
      `Write 2-3 plain-English sentences for a small-business owner about a ` +
      `gross-margin decline. Current month-to-date gross margin is ` +
      `${decline.currentMargin}%, down ${decline.declinePoints} points from ` +
      `${decline.priorYearMargin}% in the same period last year. Explain what this means ` +
      `and suggest one concrete step to investigate. Do not give formal financial ` +
      `advice. Return only the explanation.`,
    relatedData: {
      currentMargin: decline.currentMargin,
      priorYearMargin: decline.priorYearMargin,
      declinePoints: decline.declinePoints,
    },
  });
}

// ── Step orchestrators (called from jobs/intelligence/run.ts) ────────────────

/**
 * Step 6.3 — anomaly detection. Runs expense-spike and collections-slippage
 * detection and writes an `anomaly` finding for each triggered condition. This is
 * the body of the isolated `anomaly-detection` `step.run()` — never combined with
 * cash flow or margin analysis (CLAUDE.md). If a finding's AI phrasing hits a 429,
 * the run is marked skipped and this returns `{ status: 'skipped' }` immediately so
 * the runner returns cleanly without dispatching later steps.
 *
 * @param orgId Current org id. Every underlying query is org-scoped.
 * @param intelligenceRunId The `intelligence_runs.id` these findings belong to.
 */
export async function runAnomalyDetection(
  orgId: string,
  intelligenceRunId: string,
): Promise<IntelligenceStepResult> {
  let findingsCreated = 0;

  const spike = await detectExpenseSpike(orgId);
  if (spike) {
    const result = await generateExpenseSpikeFinding(orgId, intelligenceRunId, spike);
    if (result.status === "skipped") {
      return result;
    }
    findingsCreated += 1;
  }

  const slippage = await detectCollectionsSlippage(orgId);
  if (slippage) {
    const result = await generateCollectionsSlippageFinding(orgId, intelligenceRunId, slippage);
    if (result.status === "skipped") {
      return result;
    }
    findingsCreated += 1;
  }

  return { status: "completed", findingsCreated };
}

/**
 * Step 6.4 — margin deterioration detection. Compares current MTD gross margin
 * against the same period a year ago and writes a `margin_alert` finding on a
 * decline beyond tolerance. Skips silently (no finding) when the org has under 12
 * months of history. This is the body of the isolated `margin-detection`
 * `step.run()` — never combined with anomaly detection (CLAUDE.md). A 429 during
 * phrasing marks the run skipped and returns `{ status: 'skipped' }`.
 *
 * @param orgId Current org id. Every underlying query is org-scoped.
 * @param intelligenceRunId The `intelligence_runs.id` this finding belongs to.
 */
export async function runMarginDetection(
  orgId: string,
  intelligenceRunId: string,
): Promise<IntelligenceStepResult> {
  const decline = await detectMarginDecline(orgId);
  if (!decline) {
    return { status: "completed", findingsCreated: 0 };
  }

  const result = await generateMarginAlertFinding(orgId, intelligenceRunId, decline);
  if (result.status === "skipped") {
    return result;
  }

  return { status: "completed", findingsCreated: 1 };
}
