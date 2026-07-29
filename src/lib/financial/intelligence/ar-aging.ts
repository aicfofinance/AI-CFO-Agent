import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/platform/db/client";
import { transactions } from "@/lib/platform/db/schema";

/**
 * Accounts Receivable (AR) aging schedule.
 *
 * There is no dedicated `invoices` table in this product, so an outstanding
 * customer invoice is modelled as an unreconciled income transaction:
 * `transaction_type = 'income'` AND `is_reconciled = false`. For income rows the
 * `vendor_name` column holds the customer name.
 *
 * Aging buckets are keyed off how many days have elapsed since the invoice was
 * issued (`transactionDate`). Standard net-30 terms are assumed, so an invoice
 * up to 30 days old is still "current" (not yet overdue), and each subsequent
 * 30-day window rolls it one bucket further past due:
 *   - `current`  : issued <= 30 days ago (within terms)
 *   - `1-30`     : 31-60 days old  (1-30 days past due)
 *   - `31-60`    : 61-90 days old  (31-60 days past due)
 *   - `61-90`    : 91-120 days old (61-90 days past due)
 *   - `90+`      : > 120 days old  (90+ days past due)
 *
 * Monetary aggregation (bucket totals, grand total) happens entirely in SQL over
 * `::numeric`, cast to `numeric(15,2)::text` — no float arithmetic ever touches
 * JavaScript (CLAUDE.md, Financial Data Rules). The per-invoice date math
 * (days elapsed, projected payment date) is calendar arithmetic, not monetary
 * arithmetic, so it is computed in JS.
 */

const AR_AGING_BUCKETS = ["current", "1-30", "31-60", "61-90", "90+"] as const;
export type ArAgingBucket = (typeof AR_AGING_BUCKETS)[number];

export type ConfidenceLevel = "high" | "medium" | "low";

/**
 * A single outstanding invoice placed into its aging bucket.
 *
 * `amount` is a DECIMAL(15,2) string and stays a string end-to-end.
 * `daysOverdue` is days elapsed since `transactionDate` (days-since-issued).
 * `projectedPaymentDate` and `confidenceLevel` are never null — this is the
 * Step 5.4 Definition of Done requirement.
 */
export type ArInvoice = {
  id: string;
  transactionDate: string;
  amount: string;
  customerName: string | null;
  daysOverdue: number;
  bucket: ArAgingBucket;
  projectedPaymentDate: string;
  confidenceLevel: ConfidenceLevel;
};

export type ArAgingSchedule = {
  invoices: ArInvoice[];
  bucketTotals: Record<ArAgingBucket, string>;
  totalOutstanding: string;
};

const MS_PER_DAY = 86_400_000;

/** Parse a `YYYY-MM-DD` date string to the epoch ms of its UTC midnight. */
function toUtcMidnightMs(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00Z`).getTime();
}

/** Format epoch ms as an ISO `YYYY-MM-DD` date string. */
function formatUtcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function bucketForDaysElapsed(daysElapsed: number): ArAgingBucket {
  if (daysElapsed <= 30) return "current";
  if (daysElapsed <= 60) return "1-30";
  if (daysElapsed <= 90) return "31-60";
  if (daysElapsed <= 120) return "61-90";
  return "90+";
}

function confidenceForBucket(bucket: ArAgingBucket): ConfidenceLevel {
  switch (bucket) {
    case "current":
    case "1-30":
      return "high";
    case "31-60":
    case "61-90":
      return "medium";
    case "90+":
      return "low";
  }
}

/**
 * Estimate when an invoice will be collected. These are heuristic estimates
 * derived from the bucket, not a promise — the Definition of Done requires only
 * that the value is always a non-null valid ISO date.
 *
 * - `current` : invoice issue date + 30 days (expected on terms)
 * - overdue   : anchored on today, further out the longer it has been overdue
 */
function projectedPaymentDate(
  bucket: ArAgingBucket,
  invoiceUtcMs: number,
  todayUtcMs: number,
): string {
  switch (bucket) {
    case "current":
      return formatUtcDate(invoiceUtcMs + 30 * MS_PER_DAY);
    case "1-30":
      return formatUtcDate(todayUtcMs + 14 * MS_PER_DAY);
    case "31-60":
      return formatUtcDate(todayUtcMs + 21 * MS_PER_DAY);
    case "61-90":
      return formatUtcDate(todayUtcMs + 45 * MS_PER_DAY);
    case "90+":
      return formatUtcDate(todayUtcMs + 90 * MS_PER_DAY);
  }
}

function isArAgingBucket(value: string): value is ArAgingBucket {
  return (AR_AGING_BUCKETS as readonly string[]).includes(value);
}

function emptyBucketTotals(): Record<ArAgingBucket, string> {
  return {
    current: "0.00",
    "1-30": "0.00",
    "31-60": "0.00",
    "61-90": "0.00",
    "90+": "0.00",
  };
}

/**
 * Build the AR aging schedule for an org.
 *
 * @param orgId Current org id from `getRequestContext()`. Every query below is
 *   scoped to this org (multi-tenancy is non-negotiable).
 */
export async function buildArAgingSchedule(orgId: string): Promise<ArAgingSchedule> {
  const outstandingInvoiceFilter = and(
    eq(transactions.orgId, orgId),
    eq(transactions.transactionType, "income"),
    eq(transactions.isReconciled, false),
  );

  // 1. Fetch the outstanding invoices (per-row detail; no monetary math here).
  const invoiceRows = await db
    .select({
      id: transactions.id,
      transactionDate: transactions.transactionDate,
      amount: transactions.amount,
      customerName: transactions.vendorName,
    })
    .from(transactions)
    .where(outstandingInvoiceFilter);

  // 2. Bucket totals — summed in SQL, grouped by the same day thresholds used
  //    in JS below. `CURRENT_DATE - date` yields an integer day count.
  const daysElapsedSql = sql`CURRENT_DATE - ${transactions.transactionDate}::date`;
  const bucketRows = await db
    .select({
      bucket: sql<string>`CASE
        WHEN ${daysElapsedSql} <= 30 THEN 'current'
        WHEN ${daysElapsedSql} <= 60 THEN '1-30'
        WHEN ${daysElapsedSql} <= 90 THEN '31-60'
        WHEN ${daysElapsedSql} <= 120 THEN '61-90'
        ELSE '90+'
      END`,
      total: sql<string>`SUM(${transactions.amount}::numeric)::numeric(15,2)::text`,
    })
    .from(transactions)
    .where(outstandingInvoiceFilter)
    .groupBy(sql`1`);

  // 3. Grand total — also summed in SQL, never by adding strings in JS.
  const [totalRow] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${transactions.amount}::numeric), 0)::numeric(15,2)::text`,
    })
    .from(transactions)
    .where(outstandingInvoiceFilter);

  const todayUtcMs = toUtcMidnightMs(formatUtcDate(Date.now()));

  const invoices: ArInvoice[] = invoiceRows.map((row) => {
    const invoiceUtcMs = toUtcMidnightMs(row.transactionDate);
    const daysOverdue = Math.floor((todayUtcMs - invoiceUtcMs) / MS_PER_DAY);
    const bucket = bucketForDaysElapsed(daysOverdue);

    return {
      id: row.id,
      transactionDate: row.transactionDate,
      amount: row.amount,
      customerName: row.customerName,
      daysOverdue,
      bucket,
      projectedPaymentDate: projectedPaymentDate(bucket, invoiceUtcMs, todayUtcMs),
      confidenceLevel: confidenceForBucket(bucket),
    };
  });

  const bucketTotals = emptyBucketTotals();
  for (const row of bucketRows) {
    if (isArAgingBucket(row.bucket)) {
      bucketTotals[row.bucket] = row.total;
    }
  }

  return {
    invoices,
    bucketTotals,
    totalOutstanding: totalRow?.total ?? "0.00",
  };
}
