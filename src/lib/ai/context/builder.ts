import { eq } from "drizzle-orm";

import { getExpensesByCategory } from "@/lib/financial/aggregations/categories";
import { getCashPosition } from "@/lib/financial/calculations/cash-flow";
import { calculatePnL, type PnLResult } from "@/lib/financial/calculations/pnl";
import { buildArAgingSchedule } from "@/lib/financial/intelligence/ar-aging";
import { formatCurrency } from "@/lib/format";
import { db } from "@/lib/platform/db/client";
import { organizations } from "@/lib/platform/db/schema";

/**
 * Assembles the financial context block that is prepended to the system prompt
 * for AI conversations (Step 5.8). It is a plaintext summary — never JSON, never
 * a raw transaction dump — kept deliberately compact so it stays well under the
 * 8,000-token budget the system prompt reserves for it.
 *
 * Data sources (all org-scoped by `orgId`, which must come from the caller's
 * `getRequestContext()` — never user input):
 *   - `organizations`            → name + plan tier
 *   - `calculatePnL`             → revenue / expenses / net for the last 3 months
 *   - `getCashPosition`          → current cash balance
 *   - `getExpensesByCategory`    → top 5 expense categories, last 30 days
 *   - `buildArAgingSchedule`     → AR aging bucket totals
 *
 * Every monetary value reaching this module is already a DECIMAL string produced
 * by SQL aggregation (no JS float arithmetic happens here or upstream). Display
 * text is produced exclusively via `formatCurrency()` per CLAUDE.md — this file
 * never interpolates a raw dollar figure. All fetch helpers return string
 * fallbacks ("0.00" / "0") when an org has no data, so the assembled block never
 * contains a null or undefined monetary value (Step 5.8 Definition of Done).
 *
 * This is a pure data-assembly function: it makes NO AI model call and imports no
 * provider. The only entry point to a model is `getModel()` in
 * `src/lib/ai/models/router.ts`, which this module intentionally does not touch.
 */

/** A single calendar-month P&L range plus its human-readable label. */
type MonthRange = {
  label: string;
  start: string;
  end: string;
};

const MS_PER_DAY = 86_400_000;

/** Format a `Date` as an ISO `YYYY-MM-DD` string in UTC. */
function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Build the inclusive `[start, end]` range and a `"Month YYYY"` label for the
 * calendar month `monthsAgo` months before the current UTC month. `Date.UTC`
 * normalises negative month indices (rolling the year back), and day `0` of the
 * following month yields the last day of the target month.
 */
function monthRange(now: Date, monthsAgo: number): MonthRange {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() - monthsAgo;
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 0));
  const label = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(start);
  return { label, start: toIsoDate(start), end: toIsoDate(end) };
}

/**
 * Assemble the financial context string for an org.
 *
 * @param orgId Current org id from `getRequestContext()`. Every underlying query
 *   is scoped to this org (multi-tenancy is non-negotiable).
 */
export async function buildFinancialContext(orgId: string): Promise<string> {
  const now = new Date();
  const today = toIsoDate(now);

  // Most-recent month first so the block reads "as of today" downward.
  const months: readonly MonthRange[] = [
    monthRange(now, 0),
    monthRange(now, 1),
    monthRange(now, 2),
  ];

  // Trailing 30-day window for the expense-category breakdown.
  const expenseStart = toIsoDate(new Date(now.getTime() - 30 * MS_PER_DAY));

  const [orgRow, pnlByMonth, cashPosition, topCategories, arSchedule] = await Promise.all([
    db
      .select({
        name: organizations.name,
        planTier: organizations.planTier,
      })
      .from(organizations)
      .where(eq(organizations.id, orgId)),
    Promise.all(months.map((m): Promise<PnLResult> => calculatePnL(orgId, m.start, m.end))),
    getCashPosition(orgId),
    getExpensesByCategory(orgId, expenseStart, today),
    buildArAgingSchedule(orgId),
  ]);

  const org = orgRow[0];
  const orgName = org?.name ?? "Unknown Organization";
  const planTier = org?.planTier ?? "trial";

  const lines: string[] = [];
  lines.push("=== FINANCIAL CONTEXT ===");
  lines.push(`Organization: ${orgName} (${planTier})`);
  lines.push(`As of: ${today}`);
  lines.push("");

  lines.push("CASH POSITION");
  lines.push(`Current cash: ${formatCurrency(cashPosition)}`);
  lines.push("");

  lines.push("PROFIT & LOSS (last 3 months)");
  months.forEach((m, i) => {
    const pnl = pnlByMonth[i] ?? {
      revenue: "0.00",
      expenses: "0.00",
      netProfit: "0.00",
    };
    lines.push(
      `${m.label}: Revenue ${formatCurrency(pnl.revenue)} | Expenses ${formatCurrency(pnl.expenses)} | Net ${formatCurrency(pnl.netProfit)}`,
    );
  });
  lines.push("");

  lines.push("TOP EXPENSE CATEGORIES (last 30 days)");
  if (topCategories.length === 0) {
    lines.push("No expense data available");
  } else {
    topCategories.slice(0, 5).forEach((cat, i) => {
      const share = Number(cat.sharePct);
      const sharePct = Number.isNaN(share) ? "0.00" : share.toFixed(2);
      lines.push(`${i + 1}. ${cat.category}: ${formatCurrency(cat.amount)} (${sharePct}%)`);
    });
  }
  lines.push("");

  lines.push("ACCOUNTS RECEIVABLE AGING");
  lines.push(`Current (<=30d): ${formatCurrency(arSchedule.bucketTotals.current)}`);
  lines.push(`1-30 days overdue: ${formatCurrency(arSchedule.bucketTotals["1-30"])}`);
  lines.push(`31-60 days overdue: ${formatCurrency(arSchedule.bucketTotals["31-60"])}`);
  lines.push(`61-90 days overdue: ${formatCurrency(arSchedule.bucketTotals["61-90"])}`);
  lines.push(`90+ days overdue: ${formatCurrency(arSchedule.bucketTotals["90+"])}`);
  lines.push(`Total outstanding: ${formatCurrency(arSchedule.totalOutstanding)}`);
  lines.push("=== END FINANCIAL CONTEXT ===");

  return lines.join("\n");
}
