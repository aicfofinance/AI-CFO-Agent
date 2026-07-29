import { and, eq, gte, isNotNull, lte, sql } from "drizzle-orm";

import { db } from "@/lib/platform/db/client";
import { financialSnapshots, transactions } from "@/lib/platform/db/schema";

/**
 * Number of monthly snapshots recomputed on every sync: the current (partial)
 * calendar month plus the six prior complete months — seven rows total.
 */
const SNAPSHOT_MONTH_COUNT = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** `{ category: amountString }` — a denormalized cache of per-category SUMs. */
type CategoryMap = Record<string, string>;

/** Format a Date as a 'YYYY-MM-DD' string for a Postgres `date` column. */
function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Build the `{ category: SUM(amount) }` map for one transaction type in a
 * period. The SUM is computed in SQL per category (GROUP BY); this function
 * only assembles the already-summed string values into a plain object — no
 * monetary arithmetic happens in JavaScript. The per-category sums are DECIMAL
 * values Drizzle serializes to strings and they are kept as strings. Rows with
 * a NULL category are excluded (a NULL key is meaningless and would break the
 * map).
 */
async function categorySumMap(
  orgId: string,
  periodStart: string,
  periodEnd: string,
  transactionType: "income" | "expense",
): Promise<CategoryMap> {
  const rows = await db
    .select({
      category: transactions.category,
      total: sql<string>`SUM(${transactions.amount})`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.orgId, orgId),
        eq(transactions.transactionType, transactionType),
        isNotNull(transactions.category),
        gte(transactions.transactionDate, periodStart),
        lte(transactions.transactionDate, periodEnd),
      ),
    )
    .groupBy(transactions.category);

  const map: CategoryMap = {};
  for (const row of rows) {
    // `category` is narrowed by the `isNotNull` filter above, but Drizzle still
    // types it as `string | null`; the guard satisfies the type and drops any
    // stray NULL defensively.
    if (row.category !== null) {
      map[row.category] = row.total;
    }
  }
  return map;
}

/**
 * Recompute the monthly `financial_snapshots` fast-path rows for an org.
 *
 * Called by the per-org sync job (`jobs/sync/single-org.ts`, step
 * `recompute-snapshots`) after fresh transactions are imported and before the
 * intelligence run is triggered — the intelligence engine reads these snapshots.
 *
 * Produces exactly {@link SNAPSHOT_MONTH_COUNT} rows: the current calendar month
 * plus the six prior complete months. For each month it aggregates `transactions`
 * in the `[periodStart, periodEnd]` range:
 *   - `totalRevenue`  = SUM(amount) WHERE transaction_type = 'income'
 *   - `totalExpenses` = SUM(amount) WHERE transaction_type = 'expense'
 *   - `netProfit`     = totalRevenue − totalExpenses  (subtraction done IN SQL)
 *   - `expenseByCategory` / `revenueByCategory` = per-category SUM maps
 *
 * FINANCIAL DATA RULES (CLAUDE.md):
 *   - Every monetary value is aggregated in SQL and typed as `sql<string>`.
 *     No `parseFloat`, no JS arithmetic on amounts — SUM and the net-profit
 *     subtraction happen in Postgres on DECIMAL columns (exact), never on
 *     IEEE-754 floats.
 *   - `COALESCE(..., 0)` handles months with no matching rows (SUM over an
 *     empty set is NULL) so totals are always a concrete DECIMAL string.
 *
 * MULTI-TENANCY: every query is scoped by `WHERE org_id = orgId`. `orgId` is
 * supplied by the sync job from the trusted event payload, never from user input.
 *
 * IDEMPOTENCY: each row is upserted with `.onConflictDoUpdate()` against the
 * `(org_id, period_start, period_type)` unique index (`idx_snapshots_org_period`).
 * Running the sync twice updates the seven rows in place — it never creates
 * duplicates.
 *
 * NOTE ON `periodType`: the value is `'month'` (matching the schema convention
 * in schema.ts and the `period_type = 'month'` partial index), not `'monthly'`.
 * The `financial_snapshots` table has no `data_quality`, `gross_margin`,
 * `operating_expense_ratio`, or `burn_rate` columns, so those are not written.
 */
export async function recomputeSnapshots(orgId: string): Promise<void> {
  const now = new Date();

  // Oldest first (monthsAgo = 6) through the current month (monthsAgo = 0) so
  // the seven rows are written in chronological order.
  for (let monthsAgo = SNAPSHOT_MONTH_COUNT - 1; monthsAgo >= 0; monthsAgo--) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1));
    const nextMonthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo + 1, 1),
    );
    const end = new Date(nextMonthStart.getTime() - DAY_MS);
    const periodStart = toYmd(start);
    const periodEnd = toYmd(end);

    const periodFilter = and(
      eq(transactions.orgId, orgId),
      gte(transactions.transactionDate, periodStart),
      lte(transactions.transactionDate, periodEnd),
    );

    const aggRows = await db
      .select({
        totalRevenue: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.transactionType} = 'income' THEN ${transactions.amount} ELSE 0 END), 0)`,
        totalExpenses: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.transactionType} = 'expense' THEN ${transactions.amount} ELSE 0 END), 0)`,
        netProfit: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.transactionType} = 'income' THEN ${transactions.amount} ELSE 0 END), 0) - COALESCE(SUM(CASE WHEN ${transactions.transactionType} = 'expense' THEN ${transactions.amount} ELSE 0 END), 0)`,
      })
      .from(transactions)
      .where(periodFilter);

    const agg = aggRows[0];
    if (!agg) {
      // A scalar aggregate always returns exactly one row; a missing row means a
      // driver/connection fault, which is fatal for a financial data write.
      throw new Error(
        `recomputeSnapshots: aggregation returned no row for org ${orgId} period ${periodStart}`,
      );
    }

    const expenseByCategory = await categorySumMap(orgId, periodStart, periodEnd, "expense");
    const revenueByCategory = await categorySumMap(orgId, periodStart, periodEnd, "income");

    await db
      .insert(financialSnapshots)
      .values({
        orgId,
        periodStart,
        periodEnd,
        periodType: "month",
        totalRevenue: agg.totalRevenue,
        totalExpenses: agg.totalExpenses,
        netProfit: agg.netProfit,
        expenseByCategory,
        revenueByCategory,
      })
      .onConflictDoUpdate({
        target: [
          financialSnapshots.orgId,
          financialSnapshots.periodStart,
          financialSnapshots.periodType,
        ],
        set: {
          periodEnd,
          totalRevenue: agg.totalRevenue,
          totalExpenses: agg.totalExpenses,
          netProfit: agg.netProfit,
          expenseByCategory,
          revenueByCategory,
        },
      });
  }
}
