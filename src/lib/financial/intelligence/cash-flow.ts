import { and, eq, isNotNull, sql } from "drizzle-orm";

import { getCashPosition } from "@/lib/financial/calculations/cash-flow";
import { db } from "@/lib/platform/db/client";
import { transactions } from "@/lib/platform/db/schema";

import { buildArAgingSchedule } from "./ar-aging";

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
