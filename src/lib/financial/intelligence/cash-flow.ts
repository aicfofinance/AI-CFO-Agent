import { generateText } from "ai";
import { and, eq, isNotNull, sql } from "drizzle-orm";

import { detectRateLimitError, getModel } from "@/lib/ai/models/router";
import { getCashPosition } from "@/lib/financial/calculations/cash-flow";
import { db } from "@/lib/platform/db/client";
import { cashFlowProjections, intelligenceRuns, transactions } from "@/lib/platform/db/schema";

import { buildArAgingSchedule } from "./ar-aging";
import { insertFindingDeduped } from "./findings-writer";

/**
 * A vendor charge that repeats on a stable monthly-ish cycle with a stable
 * amount — a recurring expense (a subscription, a retainer, a SaaS bill).
 *
 * `expectedAmount` is a DECIMAL(15,2) value that stays a string end-to-end. It
 * is the median of the observed occurrences, selected as-is from the sorted
 * amount list — no monetary arithmetic is performed to produce it (CLAUDE.md,
 * Financial Data Rules). The stored/returned value is one of the original DB
 * strings, never a computed float.
 */
export type RecurringExpense = {
  vendorName: string;
  expectedAmount: string; // DECIMAL string — median of the observed occurrences
  nextExpectedDate: string; // ISO date string (YYYY-MM-DD)
  cycledays: number; // approx 30 for monthly subscriptions
  occurrences: number; // how many times detected in the 90-day window
};

const MIN_CYCLE_DAYS = 25;
const MAX_CYCLE_DAYS = 35;
const AMOUNT_TOLERANCE = 0.1; // 10%
const MS_PER_DAY = 86_400_000;

type ChargeRow = {
  vendorName: string | null;
  transactionDate: string;
  amount: string;
};

/**
 * Parses a `YYYY-MM-DD` date-only string as UTC midnight. The `date` column
 * serializes as a plain date string; anchoring to UTC keeps day-gap math free
 * of local-timezone / DST drift.
 */
function parseDateUtc(dateStr: string): number {
  return Date.parse(`${dateStr}T00:00:00Z`);
}

/**
 * Whole-day gap between two `YYYY-MM-DD` strings (rounded to absorb any DST
 * seam, though UTC anchoring makes gaps exact multiples of a day).
 */
function dayGap(earlier: string, later: string): number {
  return Math.round((parseDateUtc(later) - parseDateUtc(earlier)) / MS_PER_DAY);
}

/**
 * Detects recurring expenses for an org by scanning the last 90 days of
 * expense transactions grouped by vendor.
 *
 * A vendor is "recurring" when, across its occurrences in the window:
 *   1. Every consecutive day-gap falls in the 25–35 day band (a monthly cycle),
 *      requiring at least two occurrences (one gap), and
 *   2. The amounts are stable — the spread between the largest and smallest
 *      occurrence is within 10% of the smallest.
 *
 * For each qualifying vendor:
 *   - `cycledays`      = average consecutive gap, rounded to the nearest day.
 *   - `expectedAmount` = median occurrence amount, picked from the sorted list
 *      (the middle element) and returned as the original DB string.
 *   - `nextExpectedDate` = last charge date + `cycledays`.
 *
 * Amounts are parsed to numbers with `parseFloat` for comparison and median
 * selection ONLY — the returned `expectedAmount` is an unmodified DB string.
 * This is the narrow, documented exception to the no-JS-monetary-arithmetic
 * rule: no new monetary value is computed; an existing one is selected as-is.
 *
 * Pure and deterministic — no AI provider is called here. Served by
 * `idx_transactions_org_vendor_date` (the partial index on non-null vendors).
 *
 * @param orgId Current org id from `getRequestContext()`.
 * @returns Recurring expenses sorted by `expectedAmount` descending.
 */
export async function detectRecurringExpenses(orgId: string): Promise<RecurringExpense[]> {
  const rows: ChargeRow[] = await db
    .select({
      vendorName: transactions.vendorName,
      transactionDate: transactions.transactionDate,
      amount: transactions.amount,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.orgId, orgId),
        eq(transactions.transactionType, "expense"),
        isNotNull(transactions.vendorName),
        sql`${transactions.transactionDate} >= CURRENT_DATE - INTERVAL '90 days'`,
      ),
    )
    .orderBy(transactions.vendorName, transactions.transactionDate);

  // Group charges by vendor, preserving the SQL date ordering within each group.
  const byVendor = new Map<string, ChargeRow[]>();
  for (const row of rows) {
    if (row.vendorName === null) {
      continue; // Defensive: the query already filters NULL vendors.
    }
    const group = byVendor.get(row.vendorName);
    if (group) {
      group.push(row);
    } else {
      byVendor.set(row.vendorName, [row]);
    }
  }

  const results: RecurringExpense[] = [];

  for (const [vendorName, charges] of byVendor) {
    if (charges.length < 2) {
      continue; // Need at least one gap to establish a cycle.
    }

    // Ensure chronological order before measuring gaps.
    const sortedByDate = [...charges].sort(
      (a, b) => parseDateUtc(a.transactionDate) - parseDateUtc(b.transactionDate),
    );

    const gaps: number[] = [];
    for (let i = 1; i < sortedByDate.length; i += 1) {
      const prev = sortedByDate[i - 1];
      const curr = sortedByDate[i];
      if (prev === undefined || curr === undefined) {
        continue;
      }
      gaps.push(dayGap(prev.transactionDate, curr.transactionDate));
    }

    const cycleStable = gaps.every((gap) => gap >= MIN_CYCLE_DAYS && gap <= MAX_CYCLE_DAYS);
    if (!cycleStable) {
      continue;
    }

    // Amount stability: spread between max and min within 10% of the min.
    const amountValues = sortedByDate.map((c) => parseFloat(c.amount));
    const minAmount = Math.min(...amountValues);
    const maxAmount = Math.max(...amountValues);
    if (minAmount <= 0) {
      continue; // Cannot assess relative stability against a non-positive base.
    }
    const spread = (maxAmount - minAmount) / minAmount;
    if (spread > AMOUNT_TOLERANCE) {
      continue;
    }

    // Median amount: sort the original strings by numeric value, take the
    // middle element, and return it unchanged (no arithmetic average).
    const sortedByAmount = [...sortedByDate].sort(
      (a, b) => parseFloat(a.amount) - parseFloat(b.amount),
    );
    const median = sortedByAmount[Math.floor(sortedByAmount.length / 2)];
    if (median === undefined) {
      continue;
    }

    const averageGap = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
    const cycledays = Math.round(averageGap);

    const lastCharge = sortedByDate[sortedByDate.length - 1];
    if (lastCharge === undefined) {
      continue;
    }
    const nextExpectedMs = parseDateUtc(lastCharge.transactionDate) + cycledays * MS_PER_DAY;
    const nextExpectedDate = new Date(nextExpectedMs).toISOString().slice(0, 10);

    results.push({
      vendorName,
      expectedAmount: median.amount,
      nextExpectedDate,
      cycledays,
      occurrences: sortedByDate.length,
    });
  }

  // Highest-value recurring commitments first.
  results.sort((a, b) => parseFloat(b.expectedAmount) - parseFloat(a.expectedAmount));

  return results;
}

/** Confidence in a projection, keyed off how much transaction history exists. */
export type CashFlowConfidenceLevel = "low" | "medium" | "high";

/** How far out a projection may run. */
export type ProjectionPeriodDays = 30 | 60 | 90;

/**
 * One day of the projection. Every monetary field is a DECIMAL(15,2) string
 * (`.toFixed(2)`), never a JS number — floats never cross the boundary of this
 * function (CLAUDE.md, Financial Data Rules).
 */
export type DailyBalance = {
  date: string; // ISO date string 'YYYY-MM-DD'
  projectedBalance: string; // DECIMAL string — running balance at end of day
  inflows: string; // DECIMAL string — expected to arrive this day
  outflows: string; // DECIMAL string — expected outgoing this day
};

/**
 * A forward-looking cash-flow projection. Always carries `confidenceLevel`
 * (CLAUDE.md: a projection is never returned without one) and a `riskDate` that
 * is the first day the balance is projected to go negative, or `null` if it
 * never does.
 */
export type CashFlowProjection = {
  orgId: string;
  projectedDays: DailyBalance[];
  minimumProjectedBalance: string; // DECIMAL string — lowest end-of-day balance
  riskDate: string | null; // first date the balance goes negative, or null
  confidenceLevel: CashFlowConfidenceLevel;
  generatedAt: string; // ISO timestamp
};

const HISTORY_DAYS_MEDIUM = 90;
const HISTORY_DAYS_HIGH = 180;

/** Parse a `YYYY-MM-DD` string to the epoch ms of its UTC midnight. */
function projectionUtcMidnightMs(dateStr: string): number {
  return Date.parse(`${dateStr}T00:00:00Z`);
}

/** Format epoch ms as an ISO `YYYY-MM-DD` date string. */
function projectionFormatUtcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * History-length → confidence mapping (CLAUDE.md thresholds):
 *   < 90 days   → 'low'
 *   90–180 days → 'medium'
 *   >= 180 days → 'high'
 * A null `minDate` (no transactions) is treated as no history → 'low'.
 */
function confidenceFromHistory(minDate: string | null, todayMs: number): CashFlowConfidenceLevel {
  if (minDate === null) {
    return "low";
  }
  const historyDays = Math.floor((todayMs - projectionUtcMidnightMs(minDate)) / MS_PER_DAY);
  if (historyDays < HISTORY_DAYS_MEDIUM) {
    return "low";
  }
  if (historyDays < HISTORY_DAYS_HIGH) {
    return "medium";
  }
  return "high";
}

/**
 * Build a daily cash-flow projection for the next `periodDays` days.
 *
 * Combines three sources:
 *   1. Current cash position (`getCashPosition`) — the starting balance.
 *   2. Projected inflows — AR invoices from `buildArAgingSchedule`, landed on
 *      their `projectedPaymentDate`.
 *   3. Projected outflows — recurring expenses from `detectRecurringExpenses`,
 *      landed on their `nextExpectedDate`.
 *
 * The projection walks day-by-day from tomorrow (today + 1) through
 * today + `periodDays` (inclusive), producing exactly `periodDays` entries. Each
 * day's end-of-day balance is `previousBalance + inflows - outflows`.
 *
 * MONETARY ARITHMETIC NOTE: this is the one intelligence routine that must sum
 * money in JS — a running daily balance is inherently sequential and cannot be
 * expressed as a single SQL aggregate over the source rows. `parseFloat` is used
 * for the running total ONLY; every value stored in a `DailyBalance` and every
 * value returned (`minimumProjectedBalance`) is re-serialised to a 2-dp string
 * via `.toFixed(2)`, so no float crosses this function's boundary.
 *
 * No AI provider is called here — this is deterministic arithmetic.
 *
 * @param orgId Current org id from `getRequestContext()`. Every underlying query
 *   is org-scoped.
 * @param periodDays 30, 60, or 90.
 */
export async function buildCashFlowProjection(
  orgId: string,
  periodDays: ProjectionPeriodDays,
): Promise<CashFlowProjection> {
  const startingBalance = await getCashPosition(orgId);
  const arSchedule = await buildArAgingSchedule(orgId);
  const recurringExpenses = await detectRecurringExpenses(orgId);

  // Bucket expected inflows and outflows by the ISO day they land on.
  const inflowsByDate = new Map<string, number>();
  for (const invoice of arSchedule.invoices) {
    const prior = inflowsByDate.get(invoice.projectedPaymentDate) ?? 0;
    inflowsByDate.set(invoice.projectedPaymentDate, prior + parseFloat(invoice.amount));
  }

  const outflowsByDate = new Map<string, number>();
  for (const expense of recurringExpenses) {
    const prior = outflowsByDate.get(expense.nextExpectedDate) ?? 0;
    outflowsByDate.set(expense.nextExpectedDate, prior + parseFloat(expense.expectedAmount));
  }

  const todayMs = projectionUtcMidnightMs(projectionFormatUtcDate(Date.now()));

  // Walk the projection window day by day, carrying the running balance.
  let runningBalance = parseFloat(startingBalance);
  const projectedDays: DailyBalance[] = [];
  let minimumBalance = Number.POSITIVE_INFINITY;
  let riskDate: string | null = null;

  for (let dayOffset = 1; dayOffset <= periodDays; dayOffset += 1) {
    const dateStr = projectionFormatUtcDate(todayMs + dayOffset * MS_PER_DAY);
    const dayInflows = inflowsByDate.get(dateStr) ?? 0;
    const dayOutflows = outflowsByDate.get(dateStr) ?? 0;

    runningBalance = runningBalance + dayInflows - dayOutflows;

    projectedDays.push({
      date: dateStr,
      projectedBalance: runningBalance.toFixed(2),
      inflows: dayInflows.toFixed(2),
      outflows: dayOutflows.toFixed(2),
    });

    if (runningBalance < minimumBalance) {
      minimumBalance = runningBalance;
    }
    if (riskDate === null && runningBalance < 0) {
      riskDate = dateStr;
    }
  }

  // Guard the empty-window edge (periodDays is always >= 30, but be explicit).
  const minimumProjectedBalance = Number.isFinite(minimumBalance)
    ? minimumBalance.toFixed(2)
    : parseFloat(startingBalance).toFixed(2);

  // Confidence from how many days of transaction history the org has.
  const [minRow] = await db
    .select({
      minDate: sql<string | null>`MIN(${transactions.transactionDate})`,
    })
    .from(transactions)
    .where(eq(transactions.orgId, orgId));
  const confidenceLevel = confidenceFromHistory(minRow?.minDate ?? null, todayMs);

  return {
    orgId,
    projectedDays,
    minimumProjectedBalance,
    riskDate,
    confidenceLevel,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * The payload served under the `{ data: T }` envelope by
 * `GET /api/cashflow/projection`. It is `CashFlowProjection` minus `orgId`
 * (never leaked over the API), with `projectedDays` surfaced as `projectedData`.
 * Every monetary field stays a DECIMAL string and `confidenceLevel` is always
 * present (CLAUDE.md: a projection is never returned without one).
 */
export type CashFlowProjectionResponse = {
  projectedData: DailyBalance[];
  minimumProjectedBalance: string; // DECIMAL string
  riskDate: string | null; // ISO date 'YYYY-MM-DD' or null
  confidenceLevel: CashFlowConfidenceLevel;
  generatedAt: string; // ISO timestamp
};

/**
 * How many whole days of transaction history the org has: the gap between the
 * earliest `transaction_date` and today (UTC). Returns 0 when the org has no
 * transactions at all.
 *
 * This is the guard the projection endpoint uses to enforce the 60-day minimum
 * (CLAUDE.md: the endpoint returns 422 below 60 days). Kept in the intelligence
 * layer so the route stays free of raw DB access. Org-scoped — the only filter
 * is `org_id`, sourced by the caller from `getRequestContext()`.
 */
export async function getTransactionHistoryDays(orgId: string): Promise<number> {
  const [row] = await db
    .select({ minDate: sql<string | null>`MIN(${transactions.transactionDate})` })
    .from(transactions)
    .where(eq(transactions.orgId, orgId));

  const minDate = row?.minDate ?? null;
  if (minDate === null) {
    return 0;
  }

  const todayMs = projectionUtcMidnightMs(projectionFormatUtcDate(Date.now()));
  return Math.floor((todayMs - projectionUtcMidnightMs(minDate)) / MS_PER_DAY);
}

/**
 * Persists a freshly computed projection to `cash_flow_projections`, keeping at
 * most one row per (org, period length) per calendar day: if a projection for
 * today and this period already exists it is UPDATED in place, otherwise a new
 * row is INSERTED. This is an update-in-place upsert, never a delete-and-reinsert
 * (CLAUDE.md, Database Query Rules).
 *
 * The table has no unique constraint on (org, day, period) to drive a Postgres
 * `ON CONFLICT`, so the read-then-write runs inside a single transaction to keep
 * the check-and-write atomic against the rare nightly-run / manual-request race.
 *
 * The period length is derived from the projection itself (`projectedDays.length`
 * equals the requested 30/60/90). `generated_at` is refreshed to now on every
 * write so the "latest per period" ordering used by the read path always points
 * at the most recent computation.
 *
 * No AI provider is involved — this is a pure persistence step.
 *
 * @param orgId Current org id from `getRequestContext()`. Every write is
 *   org-scoped.
 * @param projection The projection returned by `buildCashFlowProjection`.
 */
export async function storeCashFlowProjection(
  orgId: string,
  projection: CashFlowProjection,
): Promise<void> {
  const projectionPeriodDays = projection.projectedDays.length;

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: cashFlowProjections.id })
      .from(cashFlowProjections)
      .where(
        and(
          eq(cashFlowProjections.orgId, orgId),
          eq(cashFlowProjections.projectionPeriodDays, projectionPeriodDays),
          sql`${cashFlowProjections.generatedAt}::date = CURRENT_DATE`,
        ),
      )
      .limit(1);

    const writeValues = {
      projectedData: projection.projectedDays,
      confidenceLevel: projection.confidenceLevel,
      minimumProjectedBalance: projection.minimumProjectedBalance,
      riskDate: projection.riskDate,
      generatedAt: new Date(),
    };

    if (existing) {
      await tx
        .update(cashFlowProjections)
        .set(writeValues)
        .where(eq(cashFlowProjections.id, existing.id));
      return;
    }

    await tx.insert(cashFlowProjections).values({
      orgId,
      projectionPeriodDays,
      ...writeValues,
    });
  });
}

/**
 * Buffer threshold below which a projection's minimum balance is treated as a
 * cash-flow risk. Zero means "the balance is projected to dip below zero at some
 * point in the window" — the point at which a finding is warranted. Kept as a
 * named constant so the risk boundary is documented in one place rather than a
 * bare `0` at the call site.
 */
const CASH_FLOW_RISK_BUFFER_THRESHOLD = 0;

/**
 * Projected minimum balance (inclusive-exclusive) below which the finding is
 * escalated from `high` to `critical` severity. A shortfall deeper than $10,000
 * is treated as critical.
 */
const CASH_FLOW_CRITICAL_BALANCE = -10_000;

/**
 * Whether a projection's minimum balance breaches the buffer threshold and
 * therefore warrants a `cash_flow_risk` finding.
 *
 * `parseFloat` is used for the threshold comparison ONLY — no monetary value is
 * computed, stored, or returned from it. `minimumProjectedBalance` remains the
 * original DECIMAL string everywhere it is persisted (CLAUDE.md, Financial Data
 * Rules).
 */
export function isCashFlowRisk(projection: CashFlowProjection): boolean {
  return parseFloat(projection.minimumProjectedBalance) < CASH_FLOW_RISK_BUFFER_THRESHOLD;
}

/**
 * The `expires_at` a `cash_flow_risk` finding should carry: UTC midnight the day
 * AFTER the projected risk date. The finding stays actionable through the whole
 * of the risk date and drops out of the feed the moment that date has passed —
 * a risk projected for Oct 21 expires on Oct 22 (CLAUDE.md, selective expiry).
 * The feed query filters `expires_at > NOW()`, so expiring at the *start* of the
 * risk date would hide the finding for the entire day it matters most.
 */
function cashFlowRiskExpiry(riskDate: string): Date {
  return new Date(projectionUtcMidnightMs(riskDate) + MS_PER_DAY);
}

/**
 * The outcome of {@link generateCashFlowRiskFinding}. `created` means a
 * `cash_flow_risk` finding was written; `skipped` means the AI provider returned
 * HTTP 429 and the run was marked skipped instead — the caller must return
 * cleanly without running further analysis (CLAUDE.md, Intelligence Engine
 * Rules: never retry, never fail over to a different provider).
 */
export type CashFlowRiskFindingResult =
  | { status: "created" }
  | { status: "skipped"; reason: "rate_limit" };

/**
 * Generates and stores a `cash_flow_risk` finding for a projection whose minimum
 * balance has already been determined to breach the buffer threshold (call
 * {@link isCashFlowRisk} first).
 *
 * The AI is used only to phrase the finding — the numbers, severity, and expiry
 * are computed deterministically here. Two `getModel()` calls (never a provider
 * import — CLAUDE.md) produce a short headline and a plain-English detail. The
 * standard financial disclaimer is NOT appended: it is an end-user response
 * concern handled by the streaming handler, not part of internal finding storage.
 *
 * Rate-limit guard: both AI calls run inside one try/catch. On a 429 — detected
 * via `detectRateLimitError()` — the run is marked `status = 'skipped'`,
 * `skipped_reason = 'rate_limit'` and the function returns cleanly. It never
 * rethrows a 429 (a rethrow would make Inngest retry a condition that will not
 * change) and never fails over to a different provider. Any non-429 error is
 * rethrown so the step surfaces the genuine failure.
 *
 * `expires_at` is set to the day after the projection's `riskDate`
 * (see {@link cashFlowRiskExpiry}); a projection with no `riskDate` (balance
 * negative on average but never crossing zero on a specific day within the
 * window) leaves it NULL.
 *
 * @param orgId Current org id. Every write is org-scoped.
 * @param intelligenceRunId The `intelligence_runs.id` this finding belongs to.
 * @param projection The projection returned by {@link buildCashFlowProjection}.
 */
export async function generateCashFlowRiskFinding(
  orgId: string,
  intelligenceRunId: string,
  projection: CashFlowProjection,
): Promise<CashFlowRiskFindingResult> {
  const minimumBalance = parseFloat(projection.minimumProjectedBalance);
  // Shortfall magnitude for the prompt copy — display-only, never persisted.
  const shortfall = Math.abs(minimumBalance).toFixed(2);
  const severity = minimumBalance < CASH_FLOW_CRITICAL_BALANCE ? "critical" : "high";
  const riskDateText = projection.riskDate ?? "within the next 30 days";

  // Draft-level task — default complexity routing (CLAUDE.md: no escalation to a
  // larger model without specific justification).
  const model = getModel(0.5);

  try {
    // Single call combining headline and detail to stay within free-tier rate limits.
    const { text: combined } = await generateText({
      model,
      prompt:
        `Write a single alert headline for a small-business finance dashboard. ` +
        `The company's cash balance is projected to fall to a minimum of -$${shortfall} ` +
        `(negative) within the next 30 days. State the cash shortfall risk and that ` +
        `action is needed. Keep it under 110 characters. Return only the headline ` +
        `text, with no surrounding quotes and no preamble.` +
        "\n\nThen on a new line write a 2-3 sentence explanation:\n" +
        `Write 2-3 plain-English sentences for a small-business owner explaining a ` +
        `projected cash shortfall. The projected minimum cash balance is -$${shortfall} ` +
        `within the next 30 days, with the shortfall first occurring on ${riskDateText}. ` +
        `Explain what this means for the business and suggest one concrete step, such as ` +
        `accelerating outstanding invoice collections or deferring a non-essential ` +
        `expense. Do not give formal financial advice. Return only the explanation.` +
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
      orgId,
      intelligenceRunId,
      findingType: "cash_flow_risk",
      severity,
      // Headline is VARCHAR(120) with a DB CHECK (length <= 120); hard-cap here
      // so an over-long model response can never violate the constraint.
      headline: headline.trim().slice(0, 120),
      detail: detail.trim(),
      status: "active",
      expiresAt: projection.riskDate ? cashFlowRiskExpiry(projection.riskDate) : null,
      relatedData: {
        minimumProjectedBalance: projection.minimumProjectedBalance,
        riskDate: projection.riskDate,
        confidenceLevel: projection.confidenceLevel,
      },
    });

    return { status: "created" };
  } catch (err) {
    if (detectRateLimitError(err)) {
      await db
        .update(intelligenceRuns)
        .set({ status: "skipped", skippedReason: "rate_limit" })
        .where(eq(intelligenceRuns.id, intelligenceRunId));
      return { status: "skipped", reason: "rate_limit" };
    }
    throw err;
  }
}
