/**
 * Intelligence accuracy benchmark (IMPLEMENTATION_PLAN Step 15.2).
 *
 * Seeds five throwaway test organizations, each engineered to exhibit exactly
 * one financial condition (plus one deliberately healthy org), runs the REAL
 * financial-intelligence detection functions against each, and asserts that the
 * expected condition is (or is not) detected. Five assertions in total.
 *
 * Run with: `pnpm tsx scripts/benchmark-intelligence-accuracy.ts`
 *
 * WHY THE DETECTION FUNCTIONS, NOT THE FINDING GENERATORS
 * -------------------------------------------------------
 * `runAnomalyDetection`, `runArAgingAnalysis`, and `runDuplicateSubscriptionScan`
 * each call `getModel()` internally to PHRASE a finding (an expensive AI round
 * trip). This benchmark validates the DETERMINISTIC detection logic that decides
 * WHETHER a finding is warranted, so it calls the pure detectors that run before
 * the AI call:
 *   - Org 1/5: `buildCashFlowProjection` + `isCashFlowRisk`
 *   - Org 2:   `detectExpenseSpike`
 *   - Org 3:   `buildArAgingSchedule` + `hasOverdueInvoices`
 *   - Org 4:   `findDuplicateSubscriptionPairs` (fed the same query
 *              `runDuplicateSubscriptionScan` uses internally)
 * No AI provider is contacted; no `ANTHROPIC_API_KEY` / `GOOGLE_AI_API_KEY` is
 * required.
 *
 * ENVIRONMENT BOOTSTRAP
 * ---------------------
 * This runs under bare `tsx`, outside Next.js. The application `db` client (and
 * the intelligence modules that depend on it) read the validated `env` object at
 * module-evaluation time, which in turn needs `DATABASE_URL` present. `.env.local`
 * is therefore loaded via `process.loadEnvFile` FIRST, and every env-dependent
 * module is pulled in with a dynamic `import()` inside `main()` so the load
 * happens before any of them evaluate. (Static `import` statements are hoisted
 * above this file's top-level code, so only env-agnostic modules — drizzle-orm
 * operators and the pure schema definitions — may be imported statically.)
 *
 * MONETARY VALUES
 * ---------------
 * Every DECIMAL column is written as a string, never a JS number. Amounts are
 * authored directly as exact 2-decimal strings. This script performs NO monetary
 * arithmetic in JavaScript — it only seeds fixtures and reads the detectors'
 * boolean/null verdicts (CLAUDE.md, Financial Data Rules).
 *
 * ISOLATION & CLEANUP
 * -------------------
 * All five orgs use fixed UUIDs in a dedicated prefix. `cleanup()` runs before
 * seeding (clearing any residue from a crashed prior run) and again in a `finally`
 * block, so the script leaves the database exactly as it found it. It uses `db`
 * (the pooler) for every query per CLAUDE.md — `dbDirect` is for migrations only.
 */

// Load `.env.local` before anything env-dependent is imported. This top-level
// statement runs after the (env-agnostic) static imports below are hoisted and
// evaluated, but before `main()`'s dynamic imports pull in the `db` client.
try {
  process.loadEnvFile(".env.local");
} catch {
  // No `.env.local` present (e.g. in CI, where vars are injected ambiently).
}

import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";

import * as schema from "@/lib/platform/db/schema";

const { organizations, accounts, transactions } = schema;

// --- Test org identity -------------------------------------------------------

type OrgKey = "cashShortfall" | "expenseSpike" | "arAging" | "duplicate" | "healthy";

const ORG_IDS: Record<OrgKey, string> = {
  cashShortfall: "20000000-0000-0000-0000-000000000001",
  expenseSpike: "20000000-0000-0000-0000-000000000002",
  arAging: "20000000-0000-0000-0000-000000000003",
  duplicate: "20000000-0000-0000-0000-000000000004",
  healthy: "20000000-0000-0000-0000-000000000005",
};

const ALL_ORG_IDS: string[] = Object.values(ORG_IDS);

const SOURCE = "csv";
const DAY_MS = 86_400_000;

// --- Date helpers (calendar arithmetic only, never monetary) -----------------

/** Formats a Date to a `YYYY-MM-DD` string using UTC fields (for DATE columns). */
function toYmd(d: Date): string {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** UTC midnight "today", so day-offset windows are stable across timezones. */
const TODAY_UTC = ((): Date => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
})();

/** ISO date string for `n` whole days before today (UTC). */
function daysAgo(n: number): string {
  return toYmd(new Date(TODAY_UTC.getTime() - n * DAY_MS));
}

// --- Fixture builders --------------------------------------------------------

type AccountSeed = {
  orgKey: OrgKey;
  externalId: string;
  accountType: "asset" | "expense" | "revenue";
  name: string;
  currentBalance: string | null;
};

/**
 * Chart of accounts for every test org. Asset-account `currentBalance` drives
 * `getCashPosition` (the projection's starting balance); expense accounts anchor
 * the cross-account duplicate-subscription detection.
 */
const ACCOUNT_SEEDS: AccountSeed[] = [
  // Org 1 — cash shortfall: $5,000 on hand, drained by recurring expenses.
  {
    orgKey: "cashShortfall",
    externalId: "bench1-acct-checking",
    accountType: "asset",
    name: "Main Checking",
    currentBalance: "5000.00",
  },
  {
    orgKey: "cashShortfall",
    externalId: "bench1-acct-opex",
    accountType: "expense",
    name: "Operating Expenses",
    currentBalance: null,
  },
  // Org 2 — expense spike.
  {
    orgKey: "expenseSpike",
    externalId: "bench2-acct-opex",
    accountType: "expense",
    name: "Operating Expenses",
    currentBalance: null,
  },
  // Org 3 — AR aging: outstanding invoices posted to a receivables account.
  {
    orgKey: "arAging",
    externalId: "bench3-acct-ar",
    accountType: "asset",
    name: "Accounts Receivable",
    currentBalance: null,
  },
  // Org 4 — duplicate subscription across TWO different expense accounts.
  {
    orgKey: "duplicate",
    externalId: "bench4-acct-card-a",
    accountType: "expense",
    name: "Corporate Card A",
    currentBalance: null,
  },
  {
    orgKey: "duplicate",
    externalId: "bench4-acct-card-b",
    accountType: "expense",
    name: "Corporate Card B",
    currentBalance: null,
  },
  // Org 5 — healthy: well-funded, evenly spent.
  {
    orgKey: "healthy",
    externalId: "bench5-acct-checking",
    accountType: "asset",
    name: "Main Checking",
    currentBalance: "80000.00",
  },
  {
    orgKey: "healthy",
    externalId: "bench5-acct-opex",
    accountType: "expense",
    name: "Operating Expenses",
    currentBalance: null,
  },
];

type TxRow = typeof transactions.$inferInsert;

/**
 * Builds every test transaction. `accountIdByExternal` resolves the DB-generated
 * account UUIDs (populated after the accounts upsert). `externalId` is unique per
 * row so the (org, source, external_id) dedup index never collides on re-run.
 */
function buildTransactionRows(accountIdByExternal: Map<string, string>): TxRow[] {
  const rows: TxRow[] = [];
  let counter = 0;

  const acct = (externalId: string): string => {
    const id = accountIdByExternal.get(externalId);
    if (id === undefined) {
      throw new Error(`Seed account missing after upsert: ${externalId}`);
    }
    return id;
  };

  const push = (input: {
    orgKey: OrgKey;
    date: string;
    amount: string;
    transactionType: "income" | "expense";
    accountExternalId: string;
    isReconciled: boolean;
    vendorName?: string;
    description?: string;
    category?: string;
  }): void => {
    counter += 1;
    rows.push({
      orgId: ORG_IDS[input.orgKey],
      externalId: `bench-tx-${counter}`,
      sourceSystem: SOURCE,
      transactionDate: input.date,
      amount: input.amount,
      currencyCode: "USD",
      transactionType: input.transactionType,
      category: input.category ?? null,
      description: input.description ?? null,
      vendorName: input.vendorName ?? null,
      accountId: acct(input.accountExternalId),
      isReconciled: input.isReconciled,
    });
  };

  // ── Org 1 — clear cash shortfall ───────────────────────────────────────────
  // Recurring monthly expenses landing on a stable 30-day cycle. Charges at
  // day-65 / -35 / -5 give two 30-day gaps (in the 25-35 band) with identical
  // amounts (0% spread), so `detectRecurringExpenses` projects the next charge
  // at day+25 — inside the 30-day window. Their combined $25,000 outflow against
  // a $5,000 starting balance drives the projected balance negative.
  const recurringVendors: Array<{ vendor: string; amount: string; category: string }> = [
    { vendor: "Landlord LLC", amount: "8000.00", category: "rent" },
    { vendor: "Gusto Payroll", amount: "10000.00", category: "payroll" },
    { vendor: "AWS", amount: "3000.00", category: "software" },
    { vendor: "Acme Insurance", amount: "2000.00", category: "insurance" },
    { vendor: "AdWords", amount: "2000.00", category: "marketing" },
  ];
  for (const { vendor, amount, category } of recurringVendors) {
    for (const offset of [65, 35, 5]) {
      push({
        orgKey: "cashShortfall",
        date: daysAgo(offset),
        amount,
        transactionType: "expense",
        accountExternalId: "bench1-acct-opex",
        isReconciled: false,
        vendorName: vendor,
        description: `${vendor} monthly charge`,
        category,
      });
    }
  }
  // Modest income already banked (reconciled → not treated as outstanding AR, so
  // it contributes no projected inflow). $10k/month across three deposits.
  for (const offset of [70, 40, 10]) {
    push({
      orgKey: "cashShortfall",
      date: daysAgo(offset),
      amount: "3333.00",
      transactionType: "income",
      accountExternalId: "bench1-acct-checking",
      isReconciled: true,
      vendorName: "Customer Co",
      description: "Invoice payment",
      category: "revenue",
    });
  }
  // Daily filler expenses (one vendor, 1-day gaps → never recurring, so they do
  // not project) to establish ~90 days of history and a realistic row count.
  for (let offset = 90; offset >= 1; offset -= 1) {
    push({
      orgKey: "cashShortfall",
      date: daysAgo(offset),
      amount: "50.00",
      transactionType: "expense",
      accountExternalId: "bench1-acct-opex",
      isReconciled: false,
      vendorName: "Misc Daily",
      description: "Sundry expense",
      category: "other",
    });
  }

  // ── Org 2 — expense spike ──────────────────────────────────────────────────
  // Last 7 days at $5,000/day; days 8-90 at $500/day. `detectExpenseSpike`
  // compares the 7-day rolling average ($5,000) against the 30-day average
  // (~$1,550) — a clear breach of the default 25% threshold.
  for (let offset = 7; offset >= 1; offset -= 1) {
    push({
      orgKey: "expenseSpike",
      date: daysAgo(offset),
      amount: "5000.00",
      transactionType: "expense",
      accountExternalId: "bench2-acct-opex",
      isReconciled: false,
      vendorName: "Spike Vendor",
      description: "Unusual large purchase",
      category: "other",
    });
  }
  for (let offset = 90; offset >= 8; offset -= 1) {
    push({
      orgKey: "expenseSpike",
      date: daysAgo(offset),
      amount: "500.00",
      transactionType: "expense",
      accountExternalId: "bench2-acct-opex",
      isReconciled: false,
      vendorName: "Normal Vendor",
      description: "Routine expense",
      category: "other",
    });
  }

  // ── Org 3 — AR aging / collections opportunity ─────────────────────────────
  // Five unpaid (unreconciled) income invoices 52-56 days old, ~$15,000 total.
  // At >30 days elapsed each falls into a past-due aging bucket, so
  // `hasOverdueInvoices` reports the collections opportunity.
  const arOffsets = [52, 53, 54, 55, 56];
  arOffsets.forEach((offset, idx) => {
    push({
      orgKey: "arAging",
      date: daysAgo(offset),
      amount: "3000.00",
      transactionType: "income",
      accountExternalId: "bench3-acct-ar",
      isReconciled: false,
      vendorName: `Slow Payer ${idx + 1}`,
      description: `Invoice #${1000 + idx}`,
      category: "revenue",
    });
  });

  // ── Org 4 — duplicate subscription ─────────────────────────────────────────
  // Same description ("Acme Software") billed on TWO different accounts within
  // the recent 35-day window, amounts $199 vs $209 (~4.9% apart, within the 10%
  // tolerance) — the duplicate-subscription signature.
  push({
    orgKey: "duplicate",
    date: daysAgo(10),
    amount: "199.00",
    transactionType: "expense",
    accountExternalId: "bench4-acct-card-a",
    isReconciled: false,
    vendorName: "Acme Software",
    description: "Acme Software",
    category: "software",
  });
  push({
    orgKey: "duplicate",
    date: daysAgo(12),
    amount: "209.00",
    transactionType: "expense",
    accountExternalId: "bench4-acct-card-b",
    isReconciled: false,
    vendorName: "Acme Software",
    description: "Acme Software",
    category: "software",
  });
  // Recent non-duplicate charges (distinct descriptions) so the detector must
  // single out the Acme pair rather than pairing arbitrary rows.
  push({
    orgKey: "duplicate",
    date: daysAgo(8),
    amount: "150.00",
    transactionType: "expense",
    accountExternalId: "bench4-acct-card-a",
    isReconciled: false,
    vendorName: "Zoom",
    description: "Zoom",
    category: "software",
  });
  push({
    orgKey: "duplicate",
    date: daysAgo(9),
    amount: "100.00",
    transactionType: "expense",
    accountExternalId: "bench4-acct-card-b",
    isReconciled: false,
    vendorName: "GitHub",
    description: "GitHub",
    category: "software",
  });

  // ── Org 5 — healthy (no findings expected) ─────────────────────────────────
  // Even daily spend (1-day gaps → not recurring, so nothing projects), income
  // fully reconciled (no outstanding AR), a single expense account (no
  // cross-account duplicate), and a healthy $80,000 balance.
  for (let offset = 90; offset >= 1; offset -= 1) {
    push({
      orgKey: "healthy",
      date: daysAgo(offset),
      amount: "667.00",
      transactionType: "expense",
      accountExternalId: "bench5-acct-opex",
      isReconciled: true,
      vendorName: "Operating Costs",
      description: "Operating Costs",
      category: "other",
    });
  }
  for (const offset of [75, 45, 15]) {
    push({
      orgKey: "healthy",
      date: daysAgo(offset),
      amount: "30000.00",
      transactionType: "income",
      accountExternalId: "bench5-acct-checking",
      isReconciled: true,
      vendorName: "BigClient Inc",
      description: "Invoice payment",
      category: "revenue",
    });
  }

  return rows;
}

// --- Database lifecycle ------------------------------------------------------

type Db = (typeof import("@/lib/platform/db/client"))["db"];

/** Deletes all test data in FK-safe order (children before parents). */
async function cleanup(db: Db): Promise<void> {
  await db.delete(transactions).where(inArray(transactions.orgId, ALL_ORG_IDS));
  await db.delete(accounts).where(inArray(accounts.orgId, ALL_ORG_IDS));
  await db.delete(organizations).where(inArray(organizations.id, ALL_ORG_IDS));
}

/** Inserts the five orgs, their accounts, and all fixture transactions. */
async function seed(db: Db): Promise<number> {
  await db.insert(organizations).values(
    (Object.keys(ORG_IDS) as OrgKey[]).map((key) => ({
      id: ORG_IDS[key],
      name: `Benchmark ${key}`,
      slug: `bench-int-${key.toLowerCase()}`,
      industry: "technology",
      annualRevenueBand: "1m-5m",
      planTier: "trial",
      timezone: "UTC",
    })),
  );

  const insertedAccounts = await db
    .insert(accounts)
    .values(
      ACCOUNT_SEEDS.map((a) => ({
        orgId: ORG_IDS[a.orgKey],
        externalId: a.externalId,
        sourceSystem: SOURCE,
        accountType: a.accountType,
        name: a.name,
        currencyCode: "USD",
        isActive: true,
        currentBalance: a.currentBalance,
      })),
    )
    .returning({ id: accounts.id, externalId: accounts.externalId });

  const accountIdByExternal = new Map(insertedAccounts.map((r) => [r.externalId, r.id]));

  const txRows = buildTransactionRows(accountIdByExternal);
  await db.insert(transactions).values(txRows);
  return txRows.length;
}

// --- Assertions --------------------------------------------------------------

/** Records one assertion outcome; returns whether it passed. */
function assert(pass: boolean, okMessage: string, failMessage: string): boolean {
  if (pass) {
    console.log(`✓ ${okMessage}`);
  } else {
    console.log(`✗ ${failMessage}`);
  }
  return pass;
}

async function main(): Promise<void> {
  // Dynamic imports: every module below transitively imports the `db` client,
  // which reads `env` at evaluation time — so it must not evaluate until after
  // `.env.local` has been loaded at the top of this file.
  const { db } = await import("@/lib/platform/db/client");
  const { buildCashFlowProjection, isCashFlowRisk } = await import(
    "@/lib/financial/intelligence/cash-flow"
  );
  const { detectExpenseSpike } = await import("@/lib/financial/intelligence/anomaly");
  const { buildArAgingSchedule } = await import("@/lib/financial/intelligence/ar-aging");
  const { hasOverdueInvoices } = await import("@/lib/financial/intelligence/ar-aging-intelligence");
  const { findDuplicateSubscriptionPairs } = await import(
    "@/lib/financial/intelligence/duplicates"
  );

  let allPassed = true;

  try {
    console.log("Seeding 5 benchmark organizations...");
    await cleanup(db);
    const txCount = await seed(db);
    console.log(
      `Seeded ${ALL_ORG_IDS.length} orgs, ${ACCOUNT_SEEDS.length} accounts, ${txCount} transactions.\n`,
    );

    // Org 1 — cash shortfall: projection must flag a risk.
    const projection1 = await buildCashFlowProjection(ORG_IDS.cashShortfall, 30);
    allPassed =
      assert(
        isCashFlowRisk(projection1),
        `Org 1: Cash shortfall detected (min balance ${projection1.minimumProjectedBalance}, riskDate ${projection1.riskDate ?? "none"})`,
        `Org 1: Expected a cash-flow risk, got min balance ${projection1.minimumProjectedBalance}`,
      ) && allPassed;

    // Org 2 — expense spike: detector must return a spike.
    const spike = await detectExpenseSpike(ORG_IDS.expenseSpike);
    allPassed =
      assert(
        spike !== null,
        `Org 2: Expense spike detected (7d avg ${spike?.amount7d}, 30d avg ${spike?.amount30d})`,
        "Org 2: Expected an expense spike, got none",
      ) && allPassed;

    // Org 3 — AR aging: schedule must show overdue invoices.
    const schedule3 = await buildArAgingSchedule(ORG_IDS.arAging);
    allPassed =
      assert(
        hasOverdueInvoices(schedule3),
        `Org 3: Collections opportunity detected (total outstanding ${schedule3.totalOutstanding})`,
        "Org 3: Expected overdue invoices, found none",
      ) && allPassed;

    // Org 4 — duplicate subscription: pure detector over the same query the
    // scan uses internally (recent expense charges joined to their accounts).
    const dupPairs = findDuplicateSubscriptionPairs(
      await fetchRecentExpenseCharges(db, ORG_IDS.duplicate),
    );
    allPassed =
      assert(
        dupPairs.length > 0,
        `Org 4: Duplicate subscription detected (${dupPairs[0]?.vendorName ?? "?"} on ${dupPairs[0]?.account1Name} + ${dupPairs[0]?.account2Name})`,
        "Org 4: Expected a duplicate subscription, found none",
      ) && allPassed;

    // Org 5 — healthy: none of the four detectors should fire.
    const projection5 = await buildCashFlowProjection(ORG_IDS.healthy, 30);
    const spike5 = await detectExpenseSpike(ORG_IDS.healthy);
    const schedule5 = await buildArAgingSchedule(ORG_IDS.healthy);
    const dupPairs5 = findDuplicateSubscriptionPairs(
      await fetchRecentExpenseCharges(db, ORG_IDS.healthy),
    );
    const healthy =
      !isCashFlowRisk(projection5) &&
      spike5 === null &&
      !hasOverdueInvoices(schedule5) &&
      dupPairs5.length === 0;
    allPassed =
      assert(
        healthy,
        "Org 5: Healthy org produced no findings",
        `Org 5: Expected no findings (risk=${isCashFlowRisk(projection5)}, spike=${spike5 !== null}, overdue=${hasOverdueInvoices(schedule5)}, duplicates=${dupPairs5.length})`,
      ) && allPassed;
  } finally {
    await cleanup(db);
  }

  if (!allPassed) {
    console.log("\nBenchmark FAILED: one or more assertions did not pass.");
    process.exit(1);
  }
  console.log("\nAll 5 assertions passed.");
  process.exit(0);
}

/**
 * Re-creates the query in `runDuplicateSubscriptionScan`'s private
 * `fetchRecentExpenseCharges`: recent (<= 35 day) expense charges that carry both
 * a description and an account, joined to `accounts` for the account name. The
 * rows are narrowed to the non-null shape the pure detector consumes. Org-scoped
 * — the only filter beyond the type/window is `org_id`.
 */
async function fetchRecentExpenseCharges(
  db: Db,
  orgId: string,
): Promise<
  Array<{ id: string; description: string; amount: string; accountId: string; accountName: string }>
> {
  const rows = await db
    .select({
      id: transactions.id,
      description: transactions.description,
      amount: transactions.amount,
      accountId: transactions.accountId,
      accountName: accounts.name,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(
      and(
        eq(transactions.orgId, orgId),
        eq(transactions.transactionType, "expense"),
        isNotNull(transactions.description),
        sql`${transactions.transactionDate} >= CURRENT_DATE - 35`,
      ),
    )
    .orderBy(transactions.description);

  const result: Array<{
    id: string;
    description: string;
    amount: string;
    accountId: string;
    accountName: string;
  }> = [];
  for (const row of rows) {
    if (row.description === null || row.accountId === null) {
      continue;
    }
    result.push({
      id: row.id,
      description: row.description,
      amount: row.amount,
      accountId: row.accountId,
      accountName: row.accountName,
    });
  }
  return result;
}

main().catch((error: unknown) => {
  console.error({
    event: "benchmark_intelligence_accuracy_failed",
    errorMessage: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
