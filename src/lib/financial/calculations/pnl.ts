import { and, eq, gte, lte, sql } from "drizzle-orm";

import { db } from "@/lib/platform/db/client";
import { transactions } from "@/lib/platform/db/schema";

/**
 * Profit & Loss over a date range.
 *
 * All three figures are DECIMAL(15,2) values that Drizzle serialises to JS
 * strings. They stay strings across the entire call — no `parseFloat`, no JS
 * arithmetic — because IEEE-754 floats cannot represent decimal money exactly
 * (CLAUDE.md, Financial Data Rules).
 */
export type PnLResult = {
  revenue: string;
  expenses: string;
  netProfit: string;
};

/**
 * Computes revenue, expenses and net profit for an org over `[startDate,
 * endDate]` (inclusive), aggregating directly from the `transactions` table.
 *
 * Every aggregation happens in SQL over the DECIMAL `amount` column — the
 * `::numeric` casts keep the arithmetic exact and `::text` returns the result
 * as a string so no float ever touches JavaScript. `net_profit` is computed in
 * the same SQL statement (income minus expense) rather than subtracting the two
 * result strings in JS, which is forbidden for monetary values.
 *
 * The org filter is mandatory on this org-scoped table and is always sourced
 * from the caller's request context — never from user-supplied input.
 *
 * The snapshot fast path (summing pre-computed `financial_snapshots` rows for
 * whole calendar months) is intentionally deferred to a later optimisation;
 * aggregating from `transactions` is the simplest correct V1 implementation and
 * is backed by `idx_transactions_org_type_date`.
 *
 * @param orgId     Current org id from `getRequestContext()`.
 * @param startDate Inclusive range start, `YYYY-MM-DD`.
 * @param endDate   Inclusive range end, `YYYY-MM-DD`.
 */
export async function calculatePnL(
  orgId: string,
  startDate: string,
  endDate: string,
): Promise<PnLResult> {
  const [row] = await db
    .select({
      revenue: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.transactionType} = 'income' THEN ${transactions.amount}::numeric ELSE 0 END), 0)::text`,
      expenses: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.transactionType} = 'expense' THEN ${transactions.amount}::numeric ELSE 0 END), 0)::text`,
      netProfit: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.transactionType} = 'income' THEN ${transactions.amount}::numeric WHEN ${transactions.transactionType} = 'expense' THEN -${transactions.amount}::numeric ELSE 0 END), 0)::text`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.orgId, orgId),
        gte(transactions.transactionDate, startDate),
        lte(transactions.transactionDate, endDate),
      ),
    );

  return {
    revenue: row?.revenue ?? "0.00",
    expenses: row?.expenses ?? "0.00",
    netProfit: row?.netProfit ?? "0.00",
  };
}
