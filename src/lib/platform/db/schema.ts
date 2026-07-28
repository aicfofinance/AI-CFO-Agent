import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  date,
  decimal,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Multi-tenant root record. Every row of financial data in the system belongs
 * to an organization via an `org_id` foreign key.
 *
 * `plan_tier` and `annual_revenue_band` (and `role` on organization_members)
 * are stored as VARCHAR rather than Postgres enums — enums are forbidden by
 * CLAUDE.md. The corresponding TypeScript union types are defined in
 * `src/types/financial.ts`.
 */
export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 100 }).notNull(),
    industry: varchar("industry", { length: 50 }).notNull(),
    annualRevenueBand: varchar("annual_revenue_band", { length: 20 }).notNull(),
    planTier: varchar("plan_tier", { length: 20 }).default("trial").notNull(),
    timezone: varchar("timezone", { length: 50 }).default("UTC").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    // `updated_at` is maintained by a Postgres trigger applied manually (see
    // SETUP.md), not by Drizzle. Drizzle only sets the initial default here.
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("idx_organizations_slug").on(t.slug)],
);

/**
 * Junction table between Supabase auth users and organizations. A user may
 * belong to multiple organizations (this supports the P2 accounting-firm portal
 * where one accountant belongs to the firm org and can access client orgs).
 *
 * `user_id` and `invited_by` reference `auth.users(id)` in Supabase's auth
 * schema, which is NOT managed by Drizzle. They are declared here as plain
 * `uuid` columns; the foreign-key constraints to `auth.users` are added
 * manually via the Supabase SQL Editor (see SETUP.md §5). Declaring the auth
 * schema in Drizzle would cause drizzle-kit to try to manage it and corrupt the
 * Supabase auth system.
 */
export const organizationMembers = pgTable(
  "organization_members",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    role: varchar("role", { length: 20 }).default("member").notNull(),
    invitedBy: uuid("invited_by"),
    invitedAt: timestamp("invited_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("idx_org_members_user_org").on(t.userId, t.orgId),
    index("idx_org_members_org").on(t.orgId),
  ],
);

/**
 * An external data source linked to an organization (QuickBooks, Xero, or a
 * Plaid bank feed). OAuth tokens are stored as AES-256-GCM ciphertext in the
 * `*_encrypted` columns — they are encrypted by `encryptToken()` before write
 * and decrypted by `decryptToken()` after read. A plaintext token value never
 * appears in a query result, a log line, or an API response.
 *
 * `provider` and `sync_status` are VARCHAR, not Postgres enums (enums are
 * forbidden by CLAUDE.md); their union types live in `src/types/financial.ts`.
 *
 * `last_intelligence_run_at` records the last completed nightly intelligence
 * engine run for this connection so the scheduler can decide whether a fresh
 * run is due.
 */
export const connections = pgTable(
  "connections",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 20 }).notNull(),
    accessTokenEncrypted: text("access_token_encrypted").notNull(),
    refreshTokenEncrypted: text("refresh_token_encrypted"),
    tokenExpiry: timestamp("token_expiry", { withTimezone: true }),
    realmId: varchar("realm_id", { length: 100 }),
    providerCompanyName: varchar("provider_company_name", { length: 255 }),
    currencyCode: varchar("currency_code", { length: 3 }).default("USD").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastIntelligenceRunAt: timestamp("last_intelligence_run_at", { withTimezone: true }),
    syncStatus: varchar("sync_status", { length: 20 }).default("pending").notNull(),
    syncErrorMessage: text("sync_error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    // `updated_at` is maintained by a Postgres trigger applied manually (see
    // SETUP.md); Drizzle only sets the initial default here.
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // One connection per provider per org.
    uniqueIndex("idx_connections_org_provider").on(t.orgId, t.provider),
    // Fan-out sync reads only active connections.
    index("idx_connections_active")
      .on(t.isActive, t.provider)
      .where(sql`${t.isActive} = true`),
    // QB/Xero mutual exclusivity: at most one active accounting connection per
    // org. Partial unique index scoped to the two accounting providers. This is
    // the database-layer half of the exclusivity guarantee; the Xero callback
    // enforces the same rule at the application layer (409) per CLAUDE.md.
    uniqueIndex("idx_connections_one_accounting_per_org")
      .on(t.orgId)
      .where(sql`${t.provider} IN ('quickbooks', 'xero') AND ${t.isActive} = true`),
  ],
);

/**
 * One row per sync attempt for a connection. Audit records: the FK to
 * `connections` intentionally has NO cascade delete so job history survives a
 * connection disconnect. `org_id` is denormalized here so RLS and org-scoped
 * queries can filter without a join back to `connections`.
 */
export const syncJobs = pgTable(
  "sync_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id),
    orgId: uuid("org_id").notNull(),
    jobType: varchar("job_type", { length: 20 }).notNull(),
    status: varchar("status", { length: 20 }).default("pending").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    recordsSynced: integer("records_synced").default(0).notNull(),
    recordsSkipped: integer("records_skipped").default(0).notNull(),
    errorsEncountered: jsonb("errors_encountered")
      .$type<Array<{ external_id: string; reason: string }>>()
      .default([])
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_sync_jobs_connection").on(t.connectionId, t.createdAt.desc()),
    index("idx_sync_jobs_org").on(t.orgId, t.createdAt.desc()),
  ],
);

/**
 * Observability log for records that could not be imported cleanly. Written by
 * the integration layer when a transaction has a null amount, a null account,
 * an unmappable category, or an invalid date. `sync_job_id` is nullable because
 * CSV uploads are not attached to a sync job; its FK to `sync_jobs` has no
 * cascade so log rows outlive the job they reference.
 */
export const dataQualityLog = pgTable(
  "data_quality_log",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    orgId: uuid("org_id").notNull(),
    syncJobId: uuid("sync_job_id").references(() => syncJobs.id),
    externalId: varchar("external_id", { length: 100 }),
    sourceSystem: varchar("source_system", { length: 20 }).notNull(),
    issueType: varchar("issue_type", { length: 50 }).notNull(),
    issueDetail: text("issue_detail"),
    rawData: jsonb("raw_data"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_dq_log_org").on(t.orgId, t.createdAt.desc()),
    index("idx_dq_log_sync")
      .on(t.syncJobId)
      .where(sql`${t.syncJobId} IS NOT NULL`),
  ],
);

/**
 * Chart of Accounts imported from QuickBooks, Xero, or a CSV upload. One row per
 * external account. `external_id` + `source_system` uniquely identify an account
 * within an org so re-syncs upsert rather than duplicate.
 *
 * `current_balance` is DECIMAL(15,2) — never a float type. IEEE-754 cannot
 * represent most decimal fractions exactly and accumulated rounding error in a
 * financial application is a product-ending bug class (CLAUDE.md). Drizzle
 * serializes DECIMAL/NUMERIC columns to JS strings; that is intentional and the
 * value must stay a string across the API boundary.
 *
 * `parent_account_id` is a self-referential FK with `ON DELETE SET NULL`: when a
 * parent account is deleted, its children become root-level accounts rather than
 * being deleted (which would silently drop financial history).
 *
 * `source_system` and `account_type` are VARCHAR, not Postgres enums (enums are
 * forbidden by CLAUDE.md). `account_type` is one of `asset`, `liability`,
 * `equity`, `revenue`, `expense`.
 */
export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    externalId: varchar("external_id", { length: 100 }).notNull(),
    sourceSystem: varchar("source_system", { length: 20 }).notNull(),
    accountType: varchar("account_type", { length: 30 }).notNull(),
    accountSubtype: varchar("account_subtype", { length: 50 }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    currentBalance: decimal("current_balance", { precision: 15, scale: 2 }),
    currencyCode: varchar("currency_code", { length: 3 }).default("USD").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    // Self-referential FK. The `AnyPgColumn` return annotation is required to
    // break the circular type reference to `accounts` during its own definition.
    parentAccountId: uuid("parent_account_id").references((): AnyPgColumn => accounts.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    // `updated_at` is maintained by a Postgres trigger applied manually (see
    // SETUP.md); Drizzle only sets the initial default here.
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Deduplication on re-sync: an external account is unique per org+source.
    uniqueIndex("idx_accounts_org_external").on(t.orgId, t.sourceSystem, t.externalId),
    // Filter by account type — partial index scoped to active accounts.
    index("idx_accounts_org_type")
      .on(t.orgId, t.accountType)
      .where(sql`${t.isActive} = true`),
  ],
);

/**
 * The core financial fact table: one row per imported transaction from
 * QuickBooks, Xero, or a CSV upload. Every org-scoped financial calculation and
 * aggregation reads from this table.
 *
 * MONETARY COLUMNS ARE DECIMAL(15,2) — NEVER float. `amount` and `amount_base`
 * use `decimal('col', { precision: 15, scale: 2 })`. A float type for a monetary
 * column is a product-ending bug (CLAUDE.md). `amount` is always stored positive;
 * direction (money in vs money out) is derived from `transaction_type`.
 * `amount_base` holds the value converted to the org's reporting currency for
 * multi-currency orgs and is NULL when no conversion is needed.
 *
 * Drizzle serializes DECIMAL columns to JS strings; monetary values must remain
 * strings across the API boundary and all arithmetic (SUM, differences) happens
 * in SQL, never in JavaScript (CLAUDE.md).
 *
 * `source_system` (`quickbooks`, `xero`, `csv`) and `transaction_type`
 * (`income`, `expense`, `transfer`, `adjustment`) are VARCHAR, not enums.
 * `account_id` FK has no cascade: deleting an account must not delete its
 * transactions (financial history is preserved and the FK is nulled by the app
 * layer if needed).
 *
 * Six indexes are load-bearing (BACKEND_STRUCTURE.md) — every listed query path
 * relies on one of them; none is speculative.
 */
export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    externalId: varchar("external_id", { length: 100 }).notNull(),
    sourceSystem: varchar("source_system", { length: 20 }).notNull(),
    transactionDate: date("transaction_date").notNull(),
    postedDate: date("posted_date"),
    amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
    currencyCode: varchar("currency_code", { length: 3 }).default("USD").notNull(),
    amountBase: decimal("amount_base", { precision: 15, scale: 2 }),
    transactionType: varchar("transaction_type", { length: 30 }).notNull(),
    category: varchar("category", { length: 50 }),
    subcategory: varchar("subcategory", { length: 50 }),
    description: text("description"),
    vendorName: varchar("vendor_name", { length: 255 }),
    accountId: uuid("account_id").references(() => accounts.id),
    referenceNumber: varchar("reference_number", { length: 100 }),
    isReconciled: boolean("is_reconciled").default(false).notNull(),
    rawData: jsonb("raw_data"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    // `updated_at` is maintained by a Postgres trigger applied manually (see
    // SETUP.md); Drizzle only sets the initial default here.
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // 1. Primary lookup: all transactions for an org in a date range.
    index("idx_transactions_org_date").on(t.orgId, t.transactionDate.desc()),
    // 2. Category aggregation.
    index("idx_transactions_org_category_date").on(t.orgId, t.category, t.transactionDate.desc()),
    // 3. P&L query: income vs expense totals.
    index("idx_transactions_org_type_date").on(
      t.orgId,
      t.transactionType,
      t.transactionDate.desc(),
    ),
    // 4. Account-level lookup — partial, only rows with an account_id.
    index("idx_transactions_org_account_date")
      .on(t.orgId, t.accountId, t.transactionDate.desc())
      .where(sql`${t.accountId} IS NOT NULL`),
    // 5. Deduplication — unique per org+source+external id (incremental import).
    uniqueIndex("idx_transactions_org_external").on(t.orgId, t.sourceSystem, t.externalId),
    // 6. Vendor analysis — partial, only rows with a vendor_name.
    index("idx_transactions_org_vendor_date")
      .on(t.orgId, t.vendorName, t.transactionDate.desc())
      .where(sql`${t.vendorName} IS NOT NULL`),
  ],
);

/**
 * Pre-computed period rollups powering the dashboard fast path. One row per
 * (org, period_start, period_type). The nightly sync recomputes these via
 * backend-engineer's `recomputeSnapshots()` so the dashboard and trend charts
 * read a single indexed row instead of aggregating the whole `transactions`
 * table on every request.
 *
 * All seven monetary columns are DECIMAL(15,2) — never a float type (CLAUDE.md).
 * Drizzle serializes DECIMAL/NUMERIC columns to JS strings and the value must
 * stay a string across the API boundary. They are nullable because a snapshot
 * for a period with no data of a given kind (e.g. no AR balance yet) leaves the
 * column NULL rather than fabricating a zero.
 *
 * `expense_by_category` and `revenue_by_category` are JSONB `{category: amount}`
 * maps — a denormalized cache of the DECIMAL source of truth in `transactions`,
 * not the authoritative monetary store.
 *
 * `period_type` is VARCHAR, not a Postgres enum (enums are forbidden by
 * CLAUDE.md); it is one of `month`, `quarter`, `year`.
 *
 * `org_id` cascades from `organizations` like every other org-scoped table.
 * `sync_job_id` FK to `sync_jobs` has NO cascade so a snapshot survives the
 * pruning of the sync job that produced it, and is nullable because a manual
 * recompute is not attached to a sync job.
 */
export const financialSnapshots = pgTable(
  "financial_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    periodType: varchar("period_type", { length: 10 }).notNull(),
    totalRevenue: decimal("total_revenue", { precision: 15, scale: 2 }),
    totalExpenses: decimal("total_expenses", { precision: 15, scale: 2 }),
    netProfit: decimal("net_profit", { precision: 15, scale: 2 }),
    cashPosition: decimal("cash_position", { precision: 15, scale: 2 }),
    arBalance: decimal("ar_balance", { precision: 15, scale: 2 }),
    expenseByCategory: jsonb("expense_by_category"),
    revenueByCategory: jsonb("revenue_by_category"),
    priorPeriodRevenue: decimal("prior_period_revenue", { precision: 15, scale: 2 }),
    priorPeriodExpenses: decimal("prior_period_expenses", { precision: 15, scale: 2 }),
    // No cascade: a snapshot outlives the sync job that produced it.
    syncJobId: uuid("sync_job_id").references(() => syncJobs.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Dashboard fast path: the latest snapshot for a given period. Unique so a
    // recompute upserts the single row per (org, period_start, period_type).
    uniqueIndex("idx_snapshots_org_period").on(t.orgId, t.periodStart, t.periodType),
    // Trend chart: last 7 months of monthly snapshots — partial, monthly only.
    index("idx_snapshots_org_monthly")
      .on(t.orgId, t.periodStart.desc())
      .where(sql`${t.periodType} = 'month'`),
  ],
);
