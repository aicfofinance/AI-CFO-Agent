import { and, eq, gte, lte, sql } from "drizzle-orm";

import { db } from "@/lib/platform/db/client";
import { transactions } from "@/lib/platform/db/schema";

/**
 * One expense category's contribution over a date range.
 *
 * `amount` is a DECIMAL(15,2) value that stays a string end-to-end — it is
 * summed in SQL over `::numeric` and returned as `::text`, so no float ever
 * touches JavaScript (CLAUDE.md, Financial Data Rules). `sharePct` is a derived
 * percentage (not a monetary column); it is computed inside the same SQL
 * statement via a window function so its numerator and denominator remain exact
 * DECIMAL arithmetic in Postgres — never JS float division.
 */
export type CategoryBreakdown = {
  category: string;
  amount: string;
  sharePct: string;
};

/**
 * Expense totals grouped by category over `[start, end]` (inclusive), sorted by
 * amount descending.
 *
 * The category share is computed with a `SUM(SUM(...)) OVER ()` window function
 * so each row's percentage divides the category total by the grand total of all
 * expenses in the range — all in exact DECIMAL SQL, cast to `numeric(7,4)` then
 * `::text` (four decimal places, matching the percentage column convention).
 * `NULLIF(..., 0)` guards against division by zero when there are no expenses.
 *
 * Rows with a NULL `category` are folded into the `'other'` bucket via
 * `COALESCE`. Scoped to `transaction_type = 'expense'` and served by
 * `idx_transactions_org_category_date`.
 *
 * The category `amount`s always sum to the same total as
 * `calculatePnL().expenses` for the same range, since both aggregate the same
 * expense rows over the same `::numeric` cast.
 *
 * @param orgId Current org id from `getRequestContext()`.
 * @param start Inclusive range start, `YYYY-MM-DD`.
 * @param end   Inclusive range end, `YYYY-MM-DD`.
 */
export async function getExpensesByCategory(
  orgId: string,
  start: string,
  end: string,
): Promise<CategoryBreakdown[]> {
  const rows = await db
    .select({
      category: sql<string>`COALESCE(${transactions.category}, 'other')`,
      amount: sql<string>`SUM(${transactions.amount}::numeric)::text`,
      sharePct: sql<string>`(SUM(${transactions.amount}::numeric) / NULLIF(SUM(SUM(${transactions.amount}::numeric)) OVER (), 0) * 100)::numeric(7,4)::text`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.orgId, orgId),
        eq(transactions.transactionType, "expense"),
        gte(transactions.transactionDate, start),
        lte(transactions.transactionDate, end),
      ),
    )
    .groupBy(sql`COALESCE(${transactions.category}, 'other')`)
    .orderBy(sql`SUM(${transactions.amount}::numeric) DESC`);

  return rows.map((row) => ({
    category: row.category,
    amount: row.amount,
    // When the grand total is 0 the window division is NULL; surface '0.0000'.
    sharePct: row.sharePct ?? "0.0000",
  }));
}
