import { and, eq, isNotNull, sql } from "drizzle-orm";

import { db } from "@/lib/platform/db/client";
import { transactions } from "@/lib/platform/db/schema";

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
