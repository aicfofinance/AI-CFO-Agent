/**
 * Development seed script (IMPLEMENTATION_PLAN Step 3.10).
 *
 * Seeds a single deterministic demo organization ("Demo Corp") with an owner
 * member, a trial subscription, four alert configs, a four-account chart of
 * accounts, 180 days of synthetic transactions (500+ rows), and 7 months of
 * financial_snapshots.
 *
 * Run with: `pnpm tsx scripts/seed.ts`
 *
 * ENVIRONMENT BOOTSTRAP
 * ---------------------
 * This script runs under bare `tsx`, outside Next.js, so it cannot import the
 * T3 `env` schema from `@/lib/env` (that pulls in Next.js internals and fails
 * outside the framework). It mirrors the drizzle.config.ts bootstrap: load
 * `.env.local` and read `DATABASE_URL` directly from `process.env`. Reading
 * `process.env` here is the one sanctioned exception, granted to this file in
 * eslint.config.mjs exactly as it is for drizzle.config.ts.
 *
 * It uses `DATABASE_URL` (the pooler, port 6543) with `prepare: false` because
 * this is a data operation, not schema DDL — matching the application `db`
 * client in src/lib/platform/db/client.ts.
 *
 * IDEMPOTENCY
 * -----------
 * Every entity is written with `.onConflictDoUpdate()` against a real UNIQUE
 * index — never delete-and-reinsert. Generation is fully DETERMINISTIC (keyed
 * off the day index, never `Math.random()`), so a re-run produces the exact
 * same set of stable external IDs (`seed-tx-${i}`) and upserts in place rather
 * than appending. Running twice does not increase row counts.
 *
 * MONETARY VALUES
 * ---------------
 * Every DECIMAL column is passed to Drizzle as a string (e.g. "1499.00"),
 * never a JS number. Synthetic amounts are built from integer index arithmetic
 * and formatted directly to exact 2-decimal strings — no floating point is
 * ever involved and no monetary value is ever parsed with `parseFloat`/`Number`.
 * All aggregation and subtraction (revenue, expenses, net profit) happens in
 * SQL via `sql<string>`, never in JavaScript.
 */

// Load `.env.local` before any environment read. None of the imports below
// read `process.env` at evaluation time, so loading it here (before the
// `DATABASE_URL` read further down) is sufficient. In CI the variables are
// injected ambiently and no `.env.local` exists, so a missing file is a no-op.
try {
  process.loadEnvFile(".env.local");
} catch {
  // No `.env.local` present — rely on ambient environment variables.
}

import { and, eq, gte, lte, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/lib/platform/db/schema";

const {
  organizations,
  organizationMembers,
  subscriptions,
  alertConfigs,
  accounts,
  transactions,
  financialSnapshots,
} = schema;

// --- Deterministic identifiers and constants ---------------------------------

const SEED_ORG_ID = "10000000-0000-0000-0000-000000000001";
const SEED_USER_ID = "10000000-0000-0000-0000-000000000002";
const SOURCE = "csv";
const DAY_MS = 24 * 60 * 60 * 1000;
const TRANSACTION_WINDOW_DAYS = 180;
const SNAPSHOT_MONTHS = 7;

// Rotating SaaS vendors for the daily "software" expenses.
const SOFTWARE_VENDORS = ["AWS", "Stripe", "Slack"] as const;

const alertConfigValues: (typeof alertConfigs.$inferInsert)[] = [
  {
    orgId: SEED_ORG_ID,
    alertType: "cash_dip",
    isEnabled: true,
    thresholdValue: "0.2000",
    emailNotifications: true,
  },
  {
    orgId: SEED_ORG_ID,
    alertType: "expense_spike",
    isEnabled: true,
    thresholdValue: "0.2000",
    emailNotifications: true,
  },
  {
    orgId: SEED_ORG_ID,
    alertType: "missing_payment",
    isEnabled: true,
    thresholdValue: "0.1500",
    emailNotifications: false,
  },
  {
    orgId: SEED_ORG_ID,
    alertType: "revenue_decline",
    isEnabled: true,
    thresholdValue: "0.1000",
    emailNotifications: true,
  },
];

const accountValues: (typeof accounts.$inferInsert)[] = [
  {
    orgId: SEED_ORG_ID,
    externalId: "seed-acct-bank",
    sourceSystem: SOURCE,
    accountType: "asset",
    name: "Main Checking",
    currencyCode: "USD",
    isActive: true,
    currentBalance: null,
  },
  {
    orgId: SEED_ORG_ID,
    externalId: "seed-acct-ar",
    sourceSystem: SOURCE,
    accountType: "asset",
    name: "Accounts Receivable",
    currencyCode: "USD",
    isActive: true,
    currentBalance: null,
  },
  {
    orgId: SEED_ORG_ID,
    externalId: "seed-acct-revenue",
    sourceSystem: SOURCE,
    accountType: "revenue",
    name: "Revenue",
    currencyCode: "USD",
    isActive: true,
    currentBalance: null,
  },
  {
    orgId: SEED_ORG_ID,
    externalId: "seed-acct-opex",
    sourceSystem: SOURCE,
    accountType: "expense",
    name: "Operating Expenses",
    currencyCode: "USD",
    isActive: true,
    currentBalance: null,
  },
];

// --- Database connection (bootstrapped, not from @/lib/env) -------------------

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is not set. Add it to .env.local or provide it as an ambient environment variable.",
  );
}

const client = postgres(databaseUrl, { prepare: false });
const db = drizzle(client, { schema });

// --- Helpers ------------------------------------------------------------------

/** Formats a Date to a `YYYY-MM-DD` string using UTC fields (for DATE columns). */
function toYmd(d: Date): string {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// --- Seed ---------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("🌱 Seeding Demo Corp...");

  const now = new Date();
  // UTC midnight "today" so the 180-day window is stable regardless of the
  // runner's local timezone.
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  try {
    await db.transaction(async (tx): Promise<void> => {
      // 1. Organization — upsert on the unique slug.
      await tx
        .insert(organizations)
        .values({
          id: SEED_ORG_ID,
          name: "Demo Corp",
          slug: "demo-corp",
          industry: "technology",
          annualRevenueBand: "1m-5m",
          planTier: "trial",
          timezone: "America/New_York",
        })
        .onConflictDoUpdate({
          target: [organizations.slug],
          set: { updatedAt: new Date() },
        });
      console.log(`✓ Org upserted: Demo Corp (id: ${SEED_ORG_ID})`);

      // 2. organization_members — owner. Upsert on (userId, orgId).
      await tx
        .insert(organizationMembers)
        .values({
          orgId: SEED_ORG_ID,
          userId: SEED_USER_ID,
          role: "owner",
        })
        .onConflictDoUpdate({
          target: [organizationMembers.userId, organizationMembers.orgId],
          set: { role: "owner" },
        });
      console.log("✓ organization_members: 1 row");

      // 3. subscriptions — trial. Upsert on orgId (one subscription per org).
      await tx
        .insert(subscriptions)
        .values({
          orgId: SEED_ORG_ID,
          planTier: "trial",
          status: "active",
          queriesLimit: 20,
          queriesUsedThisPeriod: 0,
        })
        .onConflictDoUpdate({
          target: [subscriptions.orgId],
          set: { updatedAt: new Date() },
        });
      console.log("✓ subscriptions: 1 row");

      // 4. alert_configs — four rows. Upsert on (orgId, alertType).
      await tx
        .insert(alertConfigs)
        .values(alertConfigValues)
        .onConflictDoUpdate({
          target: [alertConfigs.orgId, alertConfigs.alertType],
          set: { updatedAt: new Date() },
        });
      console.log(`✓ alert_configs: ${alertConfigValues.length} rows`);

      // 5. accounts — four rows. Upsert on (orgId, sourceSystem, externalId).
      // RETURNING gives the ids for both inserted and updated rows (DO UPDATE,
      // unlike DO NOTHING, returns conflicting rows), so transaction rows can
      // reference stable account ids across re-runs.
      const upsertedAccounts = await tx
        .insert(accounts)
        .values(accountValues)
        .onConflictDoUpdate({
          target: [accounts.orgId, accounts.sourceSystem, accounts.externalId],
          set: { isActive: true },
        })
        .returning({ id: accounts.id, externalId: accounts.externalId });

      const accountIdByExternal = new Map(upsertedAccounts.map((row) => [row.externalId, row.id]));
      const checkingAccountId = accountIdByExternal.get("seed-acct-bank");
      const arAccountId = accountIdByExternal.get("seed-acct-ar");
      if (!checkingAccountId || !arAccountId) {
        throw new Error("Seed accounts missing after upsert; cannot attach transactions.");
      }
      console.log(`✓ accounts: ${upsertedAccounts.length} rows`);

      // 6. transactions — 180 days of synthetic data (from today-180 to
      // yesterday). Deterministic generation keyed off the day offset so
      // re-runs reproduce the identical set of `seed-tx-${i}` external ids.
      const txRows: (typeof transactions.$inferInsert)[] = [];
      let i = 0;

      for (let dayOffset = TRANSACTION_WINDOW_DAYS; dayOffset >= 1; dayOffset--) {
        const d = new Date(todayUtc.getTime() - dayOffset * DAY_MS);
        const dateStr = toYmd(d);
        const dayOfMonth = d.getUTCDate();

        // Software expenses — one per SaaS vendor per day. Amount 299.00..1499.00
        // built from integer index arithmetic, formatted to an exact string.
        for (const [vendorIndex, vendor] of SOFTWARE_VENDORS.entries()) {
          const dollars = 299 + ((dayOffset * 37 + vendorIndex * 113) % 1201);
          txRows.push({
            orgId: SEED_ORG_ID,
            externalId: `seed-tx-${i}`,
            sourceSystem: SOURCE,
            transactionDate: dateStr,
            amount: `${dollars}.00`,
            currencyCode: "USD",
            transactionType: "expense",
            category: "software",
            vendorName: vendor,
            description: `${vendor} subscription`,
            accountId: checkingAccountId,
            isReconciled: false,
          });
          i++;
        }

        // Payroll — semi-monthly on the 1st and 15th.
        if (dayOfMonth === 1 || dayOfMonth === 15) {
          txRows.push({
            orgId: SEED_ORG_ID,
            externalId: `seed-tx-${i}`,
            sourceSystem: SOURCE,
            transactionDate: dateStr,
            amount: "12000.00",
            currencyCode: "USD",
            transactionType: "expense",
            category: "payroll",
            vendorName: "Gusto",
            description: "Semi-monthly payroll",
            accountId: checkingAccountId,
            isReconciled: false,
          });
          i++;
        }

        // Revenue — ~14 invoice payments per month (even days 2..28). Amount
        // 8500.00..25000.00. Income posts to the AR account.
        if (dayOfMonth % 2 === 0 && dayOfMonth <= 28) {
          const dollars = 8500 + ((dayOffset * 91 + 17) % 16501);
          txRows.push({
            orgId: SEED_ORG_ID,
            externalId: `seed-tx-${i}`,
            sourceSystem: SOURCE,
            transactionDate: dateStr,
            amount: `${dollars}.00`,
            currencyCode: "USD",
            transactionType: "income",
            category: "revenue",
            description: "Invoice payment",
            accountId: arAccountId,
            isReconciled: false,
          });
          i++;
        }
      }

      // Bulk upsert on (orgId, sourceSystem, externalId). `excluded.*` updates
      // each conflicting row with its own incoming date on re-run.
      await tx
        .insert(transactions)
        .values(txRows)
        .onConflictDoUpdate({
          target: [transactions.orgId, transactions.sourceSystem, transactions.externalId],
          set: { transactionDate: sql`excluded.transaction_date` },
        });
      console.log(`✓ transactions: ${txRows.length} rows (upserted)`);

      // 7. financial_snapshots — one monthly row for each of the last 7 COMPLETE
      // months (excluding the current partial month). All monetary values are
      // computed in SQL (SUM and the net-profit subtraction) — never in JS.
      let snapshotCount = 0;
      for (let monthsAgo = SNAPSHOT_MONTHS; monthsAgo >= 1; monthsAgo--) {
        const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1));
        const nextMonthStart = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo + 1, 1),
        );
        const end = new Date(nextMonthStart.getTime() - DAY_MS);
        const periodStart = toYmd(start);
        const periodEnd = toYmd(end);

        const aggRows = await tx
          .select({
            totalRevenue: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.transactionType} = 'income' THEN ${transactions.amount} ELSE 0 END), 0)`,
            totalExpenses: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.transactionType} = 'expense' THEN ${transactions.amount} ELSE 0 END), 0)`,
            netProfit: sql<string>`COALESCE(SUM(CASE WHEN ${transactions.transactionType} = 'income' THEN ${transactions.amount} ELSE 0 END), 0) - COALESCE(SUM(CASE WHEN ${transactions.transactionType} = 'expense' THEN ${transactions.amount} ELSE 0 END), 0)`,
          })
          .from(transactions)
          .where(
            and(
              eq(transactions.orgId, SEED_ORG_ID),
              gte(transactions.transactionDate, periodStart),
              lte(transactions.transactionDate, periodEnd),
            ),
          );

        const agg = aggRows[0];
        if (!agg) {
          throw new Error(`Snapshot aggregation returned no row for ${periodStart}.`);
        }

        // Cash position for the period equals income minus expenses (net profit).
        await tx
          .insert(financialSnapshots)
          .values({
            orgId: SEED_ORG_ID,
            periodStart,
            periodEnd,
            periodType: "month",
            totalRevenue: agg.totalRevenue,
            totalExpenses: agg.totalExpenses,
            netProfit: agg.netProfit,
            cashPosition: agg.netProfit,
          })
          .onConflictDoUpdate({
            target: [
              financialSnapshots.orgId,
              financialSnapshots.periodStart,
              financialSnapshots.periodType,
            ],
            set: {
              totalRevenue: agg.totalRevenue,
              totalExpenses: agg.totalExpenses,
              netProfit: agg.netProfit,
              cashPosition: agg.netProfit,
            },
          });
        snapshotCount++;
      }
      console.log(`✓ financial_snapshots: ${snapshotCount} rows`);
    });

    console.log("✅ Seed complete.");
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
