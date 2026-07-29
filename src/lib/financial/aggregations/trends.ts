import { calculatePnL } from "@/lib/financial/calculations/pnl";

/**
 * Revenue comparison between two periods.
 *
 * `currentRevenue` and `priorRevenue` are DECIMAL strings passed straight
 * through from `calculatePnL()` — never re-parsed for transport. `changePct` is
 * a derived percentage (not a monetary column); computing it from two
 * SQL-aggregated revenue figures is the accepted exception to the "no JS
 * arithmetic on money" rule, since the underlying sums were already exact in SQL
 * and the result is a ratio, not a monetary balance.
 */
export type PeriodComparison = {
  currentRevenue: string;
  priorRevenue: string;
  changePct: string;
  direction: "up" | "down" | "flat";
};

/**
 * One month's P&L point in a trend series. All three figures are DECIMAL
 * strings straight from `calculatePnL()`.
 */
export type MonthlyTrend = {
  month: string;
  revenue: string;
  expenses: string;
  netProfit: string;
};

/**
 * Compares revenue between a current and a prior period.
 *
 * Both revenue figures come from `calculatePnL()`, which aggregates in SQL. The
 * percentage change is `(current - prior) / prior * 100`, formatted to two
 * decimal places. When the prior period has zero revenue the change is
 * undefined (division by zero), so we return `changePct = '0.00'` and
 * `direction = 'flat'` rather than infinity.
 *
 * @param orgId        Current org id from `getRequestContext()`.
 * @param currentStart Inclusive current-period start, `YYYY-MM-DD`.
 * @param currentEnd   Inclusive current-period end, `YYYY-MM-DD`.
 * @param priorStart   Inclusive prior-period start, `YYYY-MM-DD`.
 * @param priorEnd     Inclusive prior-period end, `YYYY-MM-DD`.
 */
export async function getPeriodComparison(
  orgId: string,
  currentStart: string,
  currentEnd: string,
  priorStart: string,
  priorEnd: string,
): Promise<PeriodComparison> {
  const currentPnL = await calculatePnL(orgId, currentStart, currentEnd);
  const priorPnL = await calculatePnL(orgId, priorStart, priorEnd);

  const currentRevenue = currentPnL.revenue;
  const priorRevenue = priorPnL.revenue;

  const currentValue = Number(currentRevenue);
  const priorValue = Number(priorRevenue);

  const direction: PeriodComparison["direction"] =
    currentValue > priorValue ? "up" : currentValue < priorValue ? "down" : "flat";

  // Prior revenue of zero makes the change ratio undefined; surface a flat 0%.
  if (priorValue === 0) {
    return {
      currentRevenue,
      priorRevenue,
      changePct: "0.00",
      direction: "flat",
    };
  }

  const changePct = (((currentValue - priorValue) / priorValue) * 100).toFixed(2);

  return { currentRevenue, priorRevenue, changePct, direction };
}

/**
 * Formats a UTC date as `YYYY-MM-DD`.
 */
function formatIsoDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Monthly revenue/expense/net-profit trend for the last `months` calendar
 * months, most recent first.
 *
 * For each month we compute the inclusive `[first-day, last-day]` UTC range and
 * call `calculatePnL()` for that window. The month label is `YYYY-MM`. Each
 * month is an independent SQL aggregation — no monetary arithmetic happens in
 * JavaScript.
 *
 * @param orgId  Current org id from `getRequestContext()`.
 * @param months Number of trailing calendar months to include.
 */
export async function getMonthlyRevenueTrend(
  orgId: string,
  months: number,
): Promise<MonthlyTrend[]> {
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth();

  const results: MonthlyTrend[] = [];

  for (let offset = 0; offset < months; offset += 1) {
    // First day of the target month (offset months before the current month).
    const monthStart = new Date(Date.UTC(currentYear, currentMonth - offset, 1));
    // Day 0 of the following month is the last day of the target month.
    const monthEnd = new Date(
      Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0),
    );

    const year = monthStart.getUTCFullYear();
    const monthNumber = String(monthStart.getUTCMonth() + 1).padStart(2, "0");
    const label = `${year}-${monthNumber}`;

    const pnl = await calculatePnL(orgId, formatIsoDate(monthStart), formatIsoDate(monthEnd));

    results.push({
      month: label,
      revenue: pnl.revenue,
      expenses: pnl.expenses,
      netProfit: pnl.netProfit,
    });
  }

  return results;
}
