/**
 * Financial queries performance benchmark (IMPLEMENTATION_PLAN Step 15.3).
 *
 * Seeds a single throwaway benchmark org with 10,000 transactions (spread over
 * one year) plus 50 findings, then measures the response time of the four
 * hot-path financial queries and asserts each meets its production target:
 *
 *   - Financial summary (P&L, last 90 days)  target < 500 ms
 *   - Intelligence feed (active, top 20)      target < 500 ms
 *   - Cash flow projection (30 days)          target < 2000 ms
 *   - Transaction list (latest 100 rows)      target < 500 ms
 *
 * Each query runs three times and the MEDIAN is reported so a single cold-cache
 * outlier does not decide the result. Exits non-zero if any target is missed.
 *
 * Run with:
 *   pnpm tsx scripts/benchmark-financial-queries.ts            (seed, run, clean up)
 *   pnpm tsx scripts/benchmark-financial-queries.ts --keep     (leave data behind)
 *   pnpm tsx scripts/benchmark-financial-queries.ts --reuse    (reuse prior --keep data)
 *
 * ENVIRONMENT BOOTSTRAP
 * ---------------------
 * `./load-env` is imported first so `.env.local` is loaded before `@/lib/env`
 * is evaluated (ES module evaluation order), exactly as `test-connection.ts`
 * does. This lets the script import the real application `db` pooler client and
 * the production financial functions (`calculatePnL`, `buildCashFlowProjection`)
 * so the benchmark exercises the same code path the API routes use.
 *
 * DATABASE CLIENT
 * ---------------
 * Uses the pooled `db` client (port 6543) that all application code uses — NEVER
 * `dbDirect` (CLAUDE.md, Database Query Rules). `dbDirect` is reserved for
 * migrations only.
 *
 * MULTI-TENANCY
 * -------------
 * Every query below is scoped with `WHERE org_id = benchOrgId`. A benchmark is
 * not exempt from the org-filter rule — an unfiltered scan on `transactions` or
 * `findings` is a cross-tenant exposure regardless of intent (CLAUDE.md).
 *
 * MONETARY VALUES
 * ---------------
 * Every DECIMAL column is written as a string built from integer arithmetic
 * (e.g. "1234.00"), never a JS number and never via floating-point (CLAUDE.md,
 * Financial Data Rules). No monetary value is ever parsed or summed in JS here;
 * all aggregation happens inside the financial functions' SQL.
 *
 * This is a development utility (scripts/) — it is never imported by application
 * code and is not deployed.
 */

import "./load-env";

import { and, desc, eq, sql } from "drizzle-orm";

import { calculatePnL } from "@/lib/financial/calculations/pnl";
import { buildCashFlowProjection } from "@/lib/financial/intelligence/cash-flow";
import { db } from "@/lib/platform/db/client";
import { findings, intelligenceRuns, organizations, transactions } from "@/lib/platform/db/schema";

// --- Constants ---------------------------------------------------------------

/** Fixed id so `--reuse` can find a previously seeded benchmark org. */
const BENCH_ORG_ID = "20000000-0000-0000-0000-000000000001";
const BENCH_ORG_SLUG = "benchmark-org";
const SOURCE = "quickbooks";
const TRANSACTION_COUNT = 10_000;
const FINDINGS_COUNT = 50;
const BATCH_SIZE = 1_000;
const RUNS_PER_QUERY = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_DAYS = 365;
const PNL_WINDOW_DAYS = 90;
const FEED_PAGE_SIZE = 20;
const TX_LIST_SIZE = 100;
const MEDIUM_SUPPRESSION_DAYS = 14;

/** The 15 internal transaction categories (financial/normalization/categories.ts). */
const CATEGORIES = [
  "advertising_marketing",
  "contractors",
  "payroll",
  "rent_lease",
  "utilities",
  "insurance",
  "travel",
  "meals_entertainment",
  "office_supplies",
  "software_subscriptions",
  "bank_charges",
  "professional_services",
  "taxes_licenses",
  "cost_of_goods_sold",
  "revenue",
] as const;

const SEVERITIES = ["critical", "high", "medium", "low"] as const;

const FINDING_TYPES = [
  "cash_flow_risk",
  "anomaly",
  "collections_opportunity",
  "duplicate_subscription",
  "margin_alert",
] as const;

// --- Helpers -----------------------------------------------------------------

/** Formats a Date to a `YYYY-MM-DD` string using UTC fields (for DATE columns). */
function toYmd(d: Date): string {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** UTC midnight for "today", so the 365-day window is timezone-stable. */
function todayUtcMidnight(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Median of a numeric sample (sorts a copy; returns the middle element). */
function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/** One benchmarked query's outcome. */
type BenchmarkResult = {
  label: string;
  medianMs: number;
  targetMs: number;
  pass: boolean;
};

/**
 * Runs `fn` `RUNS_PER_QUERY` times, timing each with `performance.now()`, and
 * returns the median wall time compared against `targetMs`.
 */
async function timeQuery(
  label: string,
  targetMs: number,
  fn: () => Promise<unknown>,
): Promise<BenchmarkResult> {
  const samples: number[] = [];
  for (let run = 0; run < RUNS_PER_QUERY; run += 1) {
    const start = performance.now();
    await fn();
    samples.push(performance.now() - start);
  }
  const medianMs = median(samples);
  return { label, medianMs, targetMs, pass: medianMs < targetMs };
}

/** Renders a box-drawing table with dynamically sized columns. */
function renderTable(headers: readonly string[], rows: readonly string[][]): string {
  const widths = headers.map((header, col) =>
    Math.max(header.length, ...rows.map((row) => (row[col] ?? "").length)),
  );

  const line = (left: string, fill: string, mid: string, right: string): string =>
    left + widths.map((w) => fill.repeat(w + 2)).join(mid) + right;

  const rowText = (cells: readonly string[]): string =>
    "│" + widths.map((w, col) => ` ${(cells[col] ?? "").padEnd(w)} `).join("│") + "│";

  return [
    line("┌", "─", "┬", "┐"),
    rowText(headers),
    line("├", "─", "┼", "┤"),
    ...rows.map(rowText),
    line("└", "─", "┴", "┘"),
  ].join("\n");
}

// --- Seed --------------------------------------------------------------------

/**
 * Deletes any existing benchmark org (cascade removes its transactions,
 * intelligence runs and findings) then seeds a fresh 10,000-transaction org and
 * 50 active findings. Generation is deterministic — index-keyed, no randomness —
 * so every run produces the identical dataset.
 */
async function seed(): Promise<void> {
  // Clean slate. The org FK cascades to transactions, intelligence_runs and
  // findings, so a single delete removes everything from a prior run.
  await db.delete(organizations).where(eq(organizations.id, BENCH_ORG_ID));

  await db.insert(organizations).values({
    id: BENCH_ORG_ID,
    name: "Benchmark Org",
    slug: BENCH_ORG_SLUG,
    industry: "technology",
    annualRevenueBand: "1m-5m",
    planTier: "trial",
    timezone: "UTC",
  });

  const baseDate = todayUtcMidnight();

  const txRows: (typeof transactions.$inferInsert)[] = [];
  for (let i = 0; i < TRANSACTION_COUNT; i += 1) {
    // Spread across 365 days; ~40% income / ~60% expense (i % 5 < 2 → income).
    const isIncome = i % 5 < 2;
    // Amount $10.00 .. $10000.00, built from integer arithmetic → exact string.
    const dollars = (i % 9991) + 10;
    const category = CATEGORIES[i % CATEGORIES.length] ?? "revenue";
    txRows.push({
      orgId: BENCH_ORG_ID,
      externalId: `bench-${i}`,
      sourceSystem: SOURCE,
      transactionDate: toYmd(new Date(baseDate.getTime() - (i % HISTORY_DAYS) * DAY_MS)),
      description: `Transaction ${i}`,
      amount: `${dollars}.00`,
      currencyCode: "USD",
      transactionType: isIncome ? "income" : "expense",
      category,
      vendorName: isIncome ? `Customer ${i % 50}` : `Vendor ${i % 50}`,
      isReconciled: false,
    });
  }

  for (let i = 0; i < txRows.length; i += BATCH_SIZE) {
    await db.insert(transactions).values(txRows.slice(i, i + BATCH_SIZE));
  }
  console.log(`✓ transactions: ${txRows.length} rows`);

  // Findings reference an intelligence_runs row (NOT NULL FK). One synthetic
  // completed run parents all 50 findings.
  const [run] = await db
    .insert(intelligenceRuns)
    .values({ orgId: BENCH_ORG_ID, runType: "scheduled", status: "completed" })
    .returning({ id: intelligenceRuns.id });
  if (!run) {
    throw new Error("Failed to create benchmark intelligence run.");
  }

  const findingRows: (typeof findings.$inferInsert)[] = [];
  for (let i = 0; i < FINDINGS_COUNT; i += 1) {
    findingRows.push({
      orgId: BENCH_ORG_ID,
      intelligenceRunId: run.id,
      findingType: FINDING_TYPES[i % FINDING_TYPES.length] ?? "anomaly",
      severity: SEVERITIES[i % SEVERITIES.length] ?? "low",
      headline: `Benchmark finding ${i}`,
      detail: `Synthetic finding #${i} generated for the performance benchmark.`,
      status: "active",
    });
  }
  await db.insert(findings).values(findingRows);
  console.log(`✓ findings: ${findingRows.length} rows`);
}

/**
 * Ensures the benchmark dataset exists. With `--reuse`, an existing org that
 * already holds the full transaction set is reused as-is; otherwise the data is
 * (re)seeded from scratch.
 */
async function ensureSeeded(reuse: boolean): Promise<void> {
  if (reuse) {
    const [existing] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, BENCH_ORG_ID))
      .limit(1);

    if (existing) {
      const [countRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(transactions)
        .where(eq(transactions.orgId, BENCH_ORG_ID));
      if ((countRow?.count ?? 0) >= TRANSACTION_COUNT) {
        console.log("↻ Reusing existing benchmark org.");
        return;
      }
      console.log("↻ --reuse requested but dataset is incomplete; reseeding.");
    } else {
      console.log("↻ --reuse requested but no benchmark org exists; seeding.");
    }
  }

  console.log("🌱 Seeding benchmark org (10,000 transactions)...");
  await seed();
}

// --- Benchmarks --------------------------------------------------------------

/** Runs the four target queries and returns their timing results. */
async function runBenchmarks(): Promise<BenchmarkResult[]> {
  const today = todayUtcMidnight();
  const pnlStart = toYmd(new Date(today.getTime() - PNL_WINDOW_DAYS * DAY_MS));
  const pnlEnd = toYmd(today);

  // b. Intelligence feed — replicates the core GET /api/intelligence/feed query:
  //    active, non-expired findings, severity-sorted, page of 20. Org-scoped.
  const suppressionCutoff = new Date(Date.now() - MEDIUM_SUPPRESSION_DAYS * DAY_MS);
  const severityOrder = sql`CASE ${findings.severity} WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END`;

  const results: BenchmarkResult[] = [];

  // a. Financial summary (P&L over the last 90 days).
  results.push(
    await timeQuery("Financial summary (P&L 90 days)", 500, () =>
      calculatePnL(BENCH_ORG_ID, pnlStart, pnlEnd),
    ),
  );

  // b. Intelligence feed (20 items).
  results.push(
    await timeQuery("Intelligence feed (20 items)", 500, () =>
      db
        .select({
          id: findings.id,
          findingType: findings.findingType,
          severity: findings.severity,
          headline: findings.headline,
          detail: findings.detail,
          recommendedAction: findings.recommendedAction,
          relatedData: findings.relatedData,
          status: findings.status,
          createdAt: findings.createdAt,
          expiresAt: findings.expiresAt,
        })
        .from(findings)
        .where(
          and(
            eq(findings.orgId, BENCH_ORG_ID),
            eq(findings.status, "active"),
            sql`(${findings.expiresAt} IS NULL OR ${findings.expiresAt} > now())`,
            sql`NOT (${findings.severity} = 'medium' AND ${findings.createdAt} <= ${suppressionCutoff})`,
          ),
        )
        .orderBy(severityOrder, desc(findings.createdAt))
        .limit(FEED_PAGE_SIZE + 1),
    ),
  );

  // c. Cash flow projection (30-day).
  results.push(
    await timeQuery("Cash flow projection", 2000, () => buildCashFlowProjection(BENCH_ORG_ID, 30)),
  );

  // d. Transaction list (latest 100 rows, org-scoped, newest first).
  results.push(
    await timeQuery("Transaction list (100 rows)", 500, () =>
      db
        .select()
        .from(transactions)
        .where(eq(transactions.orgId, BENCH_ORG_ID))
        .orderBy(desc(transactions.transactionDate))
        .limit(TX_LIST_SIZE),
    ),
  );

  return results;
}

// --- Cleanup -----------------------------------------------------------------

/** Removes the benchmark org (cascade deletes transactions, runs and findings). */
async function cleanup(): Promise<void> {
  await db.delete(organizations).where(eq(organizations.id, BENCH_ORG_ID));
  console.log("🧹 Cleaned up benchmark org.");
}

// --- Entry point -------------------------------------------------------------

async function main(): Promise<boolean> {
  const args = process.argv.slice(2);
  const reuse = args.includes("--reuse");
  const keep = args.includes("--keep");

  try {
    await ensureSeeded(reuse);

    const results = await runBenchmarks();

    const rows = results.map((r) => [
      r.label,
      String(Math.round(r.medianMs)),
      r.pass ? "✓ PASS" : "✗ FAIL",
    ]);
    console.log(renderTable(["Query", "Median (ms)", "Result"], rows));

    const passed = results.filter((r) => r.pass).length;
    console.log(`${passed}/${results.length} targets met.`);
    return passed === results.length;
  } finally {
    if (!keep) {
      await cleanup();
    } else {
      console.log("↩ --keep set; benchmark org left in place.");
    }
  }
}

main()
  .then((allPassed) => {
    process.exit(allPassed ? 0 : 1);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
