import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
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

/**
 * A Q&A conversation thread between a user and the AI CFO. One row per thread;
 * the individual turns live in `messages`. `title` is auto-generated from the
 * first user message and `last_message_at` orders the history view (most-recent
 * first).
 *
 * `org_id` cascades from `organizations` like every other org-scoped table.
 * `user_id` references Supabase's `auth.users(id)`, which is NOT managed by
 * Drizzle — the same pattern as `organization_members.user_id`. It is declared
 * here as a plain `uuid` column; its FK to `auth.users` is added manually via
 * the Supabase SQL Editor (see SETUP.md §5). Declaring the auth schema in
 * Drizzle would cause drizzle-kit to try to manage it and corrupt Supabase auth.
 */
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    title: varchar("title", { length: 255 }),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    // `updated_at` is maintained by a Postgres trigger applied manually (see
    // SETUP.md); Drizzle only sets the initial default here.
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // History view ordering. BACKEND_STRUCTURE specifies
    // (org_id, last_message_at DESC NULLS LAST); this is a plain index on
    // (org_id, last_message_at) and the query applies
    // `ORDER BY last_message_at DESC NULLS LAST` at runtime — Postgres still
    // uses the index for the org_id filter.
    index("idx_conversations_org_date").on(t.orgId, t.lastMessageAt),
    // A single user's conversations within an org, newest first.
    index("idx_conversations_user").on(t.orgId, t.userId, t.createdAt.desc()),
  ],
);

/**
 * One row per turn in a conversation. `content` is TEXT (unlimited length) —
 * never VARCHAR: an AI answer can be arbitrarily long and truncating it would
 * corrupt the conversation record.
 *
 * `conversation_id` cascades: deleting a conversation removes its messages.
 * `org_id` is denormalized here (copied from the parent conversation) so RLS
 * and org-scoped queries can filter without a join back to `conversations`. The
 * token/timing columns are nullable telemetry populated by the streaming
 * handler; a `user`-role message leaves them NULL.
 *
 * `role` is VARCHAR, not a Postgres enum (enums are forbidden by CLAUDE.md); it
 * is one of `user`, `assistant`.
 */
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").notNull(),
    role: varchar("role", { length: 20 }).notNull(),
    content: text("content").notNull(),
    modelUsed: varchar("model_used", { length: 50 }),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    responseTimeMs: integer("response_time_ms"),
    wasCached: boolean("was_cached").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Load a conversation's turns in chronological order. ASC is the Postgres
    // default for an unqualified index column, matching BACKEND_STRUCTURE's
    // (conversation_id, created_at ASC).
    index("idx_messages_conversation").on(t.conversationId, t.createdAt),
    // Org-wide message scan, newest first (usage analytics, data export).
    index("idx_messages_org_content").on(t.orgId, t.createdAt.desc()),
  ],
);

/**
 * Per-request audit log for AI Q&A: one row per attempted query, whether it
 * succeeded or failed. Drives quota/usage analytics and failure diagnostics.
 *
 * `user_id` references Supabase's `auth.users(id)` and — like
 * `organization_members.user_id` — is a plain `uuid` with no Drizzle
 * `.references()`; no auth.users FK constraint is declared for it at all.
 * `message_id` references the assistant `messages` row this query produced, with
 * NO cascade so the audit record survives message pruning; it is nullable
 * because a failed query (quota, guardrail, timeout) never produces a message.
 *
 * `failure_reason` is VARCHAR, not a Postgres enum (enums are forbidden by
 * CLAUDE.md); it is one of `quota_exceeded`, `api_error`, `api_timeout`,
 * `guardrail_triggered`, `validation_error`.
 */
export const queryLog = pgTable(
  "query_log",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    orgId: uuid("org_id").notNull(),
    userId: uuid("user_id").notNull(),
    // No cascade: an audit row outlives the message it references.
    messageId: uuid("message_id").references(() => messages.id),
    success: boolean("success").notNull(),
    failureReason: varchar("failure_reason", { length: 50 }),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    responseTimeMs: integer("response_time_ms"),
    modelUsed: varchar("model_used", { length: 50 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Usage counting for the billing period — partial, successful queries only.
    index("idx_query_log_org_period")
      .on(t.orgId, t.createdAt.desc())
      .where(sql`${t.success} = true`),
    // Per-day rollups via a functional index on DATE(created_at).
    index("idx_query_log_org_day").on(t.orgId, sql`(DATE(${t.createdAt}))`),
  ],
);

/**
 * Threshold-based alert records surfaced to the user: a cash dip, an expense
 * spike, a missing payment, or a revenue decline detected against the org's
 * configured thresholds (see `alert_configs`). Each row is one triggered alert
 * instance. `acknowledged_at IS NULL` means the alert is unread; `suppressed_until`
 * implements a per-type cooldown so the same condition does not re-fire on every
 * sync.
 *
 * `amount_before` and `amount_after` are DECIMAL(15,2) monetary columns — never a
 * float type (CLAUDE.md). `change_percent` and `threshold_value` are DECIMAL(7,4)
 * percentages stored as a fraction (0.2000 = 20%), not as a whole number. Drizzle
 * serializes DECIMAL columns to JS strings and the value must stay a string across
 * the API boundary; all arithmetic on them happens in SQL, never in JavaScript.
 *
 * `alert_type` and `severity` are VARCHAR, not Postgres enums (enums are forbidden
 * by CLAUDE.md). `alert_type` is one of `cash_dip`, `expense_spike`,
 * `missing_payment`, `revenue_decline`; `severity` is one of `low`, `medium`,
 * `high`, `critical`.
 *
 * `org_id` cascades from `organizations`. `related_account_id` references
 * `accounts(id)` as nullable optional context, with no cascade — matching
 * `transactions.account_id`. `acknowledged_by` references Supabase's
 * `auth.users(id)`; like every auth.users column it is a plain `uuid` whose FK is
 * added manually via the Supabase SQL Editor (see SETUP.md §5). `metadata` is a
 * JSONB bag of extra context that defaults to an empty object.
 */
export const alerts = pgTable(
  "alerts",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    alertType: varchar("alert_type", { length: 30 }).notNull(),
    severity: varchar("severity", { length: 20 }).default("medium").notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description").notNull(),
    amountBefore: decimal("amount_before", { precision: 15, scale: 2 }),
    amountAfter: decimal("amount_after", { precision: 15, scale: 2 }),
    changePercent: decimal("change_percent", { precision: 7, scale: 4 }),
    thresholdValue: decimal("threshold_value", { precision: 7, scale: 4 }),
    relatedAccountId: uuid("related_account_id").references(() => accounts.id),
    relatedCategory: varchar("related_category", { length: 50 }),
    triggeredAt: timestamp("triggered_at", { withTimezone: true }).defaultNow().notNull(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    // `auth.users(id)` FK — plain uuid; constraint added manually (SETUP.md §5).
    acknowledgedBy: uuid("acknowledged_by"),
    suppressedUntil: timestamp("suppressed_until", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Unread alerts for an org, newest first — partial, only unacknowledged rows.
    index("idx_alerts_org_unread")
      .on(t.orgId, t.triggeredAt.desc())
      .where(sql`${t.acknowledgedAt} IS NULL`),
    // Suppression lookup by type — partial, only rows currently in cooldown.
    index("idx_alerts_org_type_suppressed")
      .on(t.orgId, t.alertType, t.suppressedUntil)
      .where(sql`${t.suppressedUntil} IS NOT NULL`),
  ],
);

/**
 * Per-org configuration for each threshold-based alert type: whether it is
 * enabled, the numeric threshold that trips it, and whether it emails. Exactly one
 * row per (org, alert_type) — enforced by the `idx_alert_configs_org_type` UNIQUE
 * index. The intelligence engine (Phase 6) reads `threshold_value` from this table
 * when evaluating conditions such as the expense-spike ratio.
 *
 * `threshold_value` is a DECIMAL(7,4) percentage stored as a fraction
 * (0.2000 = 20%), never a float and never a whole number (CLAUDE.md). Drizzle
 * serializes it to a JS string.
 *
 * `alert_type` is VARCHAR, not a Postgres enum (enums are forbidden by CLAUDE.md);
 * it matches the `alerts.alert_type` domain. `org_id` cascades from
 * `organizations`. `updated_by` references Supabase's `auth.users(id)` — a plain
 * `uuid` whose FK is added manually via the Supabase SQL Editor (see SETUP.md §5).
 * This table has no `created_at` column by design — only `updated_at`, which
 * tracks the last edit to the configuration.
 */
export const alertConfigs = pgTable(
  "alert_configs",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    alertType: varchar("alert_type", { length: 30 }).notNull(),
    isEnabled: boolean("is_enabled").default(true).notNull(),
    thresholdValue: decimal("threshold_value", { precision: 7, scale: 4 }).notNull(),
    emailNotifications: boolean("email_notifications").default(true).notNull(),
    // `auth.users(id)` FK — plain uuid; constraint added manually (SETUP.md §5).
    updatedBy: uuid("updated_by"),
    // `updated_at` is maintained by a Postgres trigger applied manually (see
    // SETUP.md); Drizzle only sets the initial default here.
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // One config per (org, alert_type). UNIQUE — satisfies the Step 3.6 DoD.
    uniqueIndex("idx_alert_configs_org_type").on(t.orgId, t.alertType),
  ],
);

/**
 * Generated financial reports: a monthly summary or a custom-period report. The
 * `status` column tracks the generation lifecycle (`pending` → `generating` →
 * `ready` | `failed`); `generated_at` is set when it reaches `ready`, and the
 * `generation_attempted_at` / `generation_error` pair records the last failed
 * attempt. `content` holds the structured metrics as JSONB and
 * `plain_text_summary` holds the AI-generated narrative.
 *
 * `report_type` and `status` are VARCHAR, not Postgres enums (enums are forbidden
 * by CLAUDE.md). `report_type` is one of `monthly_summary`, `custom`; `status` is
 * one of `pending`, `generating`, `ready`, `failed`.
 *
 * `org_id` cascades from `organizations`. `generated_by_user_id` references
 * Supabase's `auth.users(id)` — a plain `uuid` whose FK is added manually via the
 * Supabase SQL Editor (see SETUP.md §5); it is nullable because the monthly cron
 * generates reports with no initiating user.
 */
export const reports = pgTable(
  "reports",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    reportType: varchar("report_type", { length: 30 }).notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    status: varchar("status", { length: 20 }).default("pending").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }),
    generationAttemptedAt: timestamp("generation_attempted_at", { withTimezone: true }),
    generationError: text("generation_error"),
    content: jsonb("content"),
    plainTextSummary: text("plain_text_summary"),
    modelUsed: varchar("model_used", { length: 50 }),
    tokensUsed: integer("tokens_used"),
    // `auth.users(id)` FK — plain uuid; constraint added manually (SETUP.md §5).
    generatedByUserId: uuid("generated_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Report list for an org, newest period first.
    index("idx_reports_org_date").on(t.orgId, t.periodStart.desc()),
    // One report per (org, period_start, report_type) — UNIQUE, upsert on regen.
    uniqueIndex("idx_reports_org_period_type").on(t.orgId, t.periodStart, t.reportType),
  ],
);

/**
 * One billing record per organization — enforced by the `idx_subscriptions_org`
 * UNIQUE index (a one-to-one with `organizations`). Tracks the Stripe customer and
 * subscription IDs (both NULL until the first upgrade off the trial tier), the
 * plan tier and status, the current Stripe billing period, and the AI-query quota
 * counters that `checkAndIncrementQuota()` reads and increments under a row lock.
 *
 * `plan_tier` and `status` are VARCHAR, not Postgres enums (enums are forbidden by
 * CLAUDE.md). `plan_tier` is one of `trial`, `starter`, `growth`; `status` is one
 * of `active`, `past_due`, `canceled`, `trialing`. Quota defaults to the trial
 * allowance (`queries_limit = 20`); Starter = 500 and Growth = 2000 are applied by
 * the Stripe webhook handler.
 *
 * `queries_used_this_period` and `queries_limit` are plain INTEGER counts (not
 * monetary) and are safe to increment in SQL. `org_id` cascades from
 * `organizations`.
 */
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    stripeCustomerId: varchar("stripe_customer_id", { length: 100 }),
    stripeSubscriptionId: varchar("stripe_subscription_id", { length: 100 }),
    planTier: varchar("plan_tier", { length: 20 }).default("trial").notNull(),
    status: varchar("status", { length: 20 }).default("active").notNull(),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    queriesUsedThisPeriod: integer("queries_used_this_period").default(0).notNull(),
    queriesLimit: integer("queries_limit").default(20).notNull(),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    // `updated_at` is maintained by a Postgres trigger applied manually (see
    // SETUP.md); Drizzle only sets the initial default here.
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // One subscription per org. UNIQUE — satisfies the Step 3.6 DoD.
    uniqueIndex("idx_subscriptions_org").on(t.orgId),
    // Stripe webhook reverse lookup by customer — partial, only linked rows.
    index("idx_subscriptions_stripe_customer")
      .on(t.stripeCustomerId)
      .where(sql`${t.stripeCustomerId} IS NOT NULL`),
    // Stripe webhook reverse lookup by subscription — partial, only linked rows.
    index("idx_subscriptions_stripe_sub")
      .on(t.stripeSubscriptionId)
      .where(sql`${t.stripeSubscriptionId} IS NOT NULL`),
  ],
);

/**
 * One row per execution of the proactive intelligence engine (Phase 6). Records
 * what the nightly runner evaluated, when, and its outcome — used for
 * observability, rate-limit enforcement, and audit. `findings_generated` counts
 * the rows written to `findings` on this run.
 *
 * `run_type`, `status`, and `skipped_reason` are VARCHAR, not Postgres enums
 * (enums are forbidden by CLAUDE.md). `run_type` is one of `scheduled`,
 * `triggered`. `status` is one of `running`, `completed`, `failed`, `skipped`;
 * it defaults to `running` (set at the top of the run before any analysis step).
 * `skipped_reason` is populated only when `status = 'skipped'` and is one of
 * `rate_limit`, `no_data`, `sync_failed`, `insufficient_history`.
 *
 * `completed_at`, `model_used`, `tokens_used`, and `skipped_reason` are nullable:
 * a running, failed, or skipped run leaves `completed_at` NULL, and a run that
 * never reached an AI call leaves the model/token telemetry NULL.
 *
 * `org_id` cascades from `organizations` like every other org-scoped table.
 */
export const intelligenceRuns = pgTable(
  "intelligence_runs",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    runType: varchar("run_type", { length: 20 }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    findingsGenerated: integer("findings_generated").default(0).notNull(),
    status: varchar("status", { length: 20 }).default("running").notNull(),
    modelUsed: varchar("model_used", { length: 50 }),
    tokensUsed: integer("tokens_used"),
    skippedReason: varchar("skipped_reason", { length: 30 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Recent runs per org, newest first (intelligence engine monitoring).
    index("idx_intelligence_runs_org_date").on(t.orgId, t.startedAt.desc()),
    // Skipped runs by reason — partial, only rows currently in the skipped state.
    index("idx_intelligence_runs_skipped")
      .on(t.orgId, t.skippedReason)
      .where(sql`${t.status} = 'skipped'`),
  ],
);

/**
 * AI-generated intelligence findings surfaced in the Intelligence Feed (Phase 6).
 * One row per discrete finding. Findings move through a status lifecycle
 * (`active` → `actioned` | `dismissed` | `expired`) and, once terminal, are
 * immutable — a persisting condition produces a fresh finding on the next run.
 *
 * `headline` is VARCHAR(120) AND carries an explicit CHECK constraint
 * (`findings_headline_max_120`, `length(headline) <= 120`) — the length ceiling is
 * enforced at the database layer per the Step 3.7 Definition of Done, not left to
 * the VARCHAR limit alone. `detail` and `recommended_action` are TEXT (unbounded):
 * a full explanation can be arbitrarily long and must never be truncated.
 *
 * `finding_type`, `severity`, `status`, and `dismiss_reason` are VARCHAR, not
 * Postgres enums (enums are forbidden by CLAUDE.md). `finding_type` is one of
 * `cash_flow_risk`, `anomaly`, `collections_opportunity`, `duplicate_subscription`,
 * `margin_alert`. `severity` is one of `low`, `medium`, `high`, `critical`.
 * `status` defaults to `active` and is one of `active`, `actioned`, `dismissed`,
 * `expired`. `dismiss_reason` is one of `not_relevant`, `already_handled`,
 * `incorrect`.
 *
 * `related_data` is a JSONB bag of finding-type-specific context (invoice IDs,
 * vendor names, amount deltas) consumed by the agentic execution layer to
 * pre-populate drafts; it defaults to an empty object and is NOT NULL.
 *
 * `expires_at` is set only for time-sensitive findings (a `cash_flow_risk`
 * finding expires on its projected risk date); all other types leave it NULL so
 * they persist until dismissed or actioned (CLAUDE.md — selective expiry). The
 * `idx_findings_expiry` partial index backs the nightly expiry cleanup job.
 *
 * `org_id` cascades from `organizations`. `intelligence_run_id` references
 * `intelligence_runs(id)` with NO cascade so a finding survives run pruning.
 * `dismissed_by` references Supabase's `auth.users(id)`; like every auth.users
 * column it is a plain `uuid` whose FK is added manually via the Supabase SQL
 * Editor (see SETUP.md §5) with ON DELETE SET NULL.
 */
export const findings = pgTable(
  "findings",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // No cascade: a finding outlives the intelligence run that produced it.
    intelligenceRunId: uuid("intelligence_run_id")
      .notNull()
      .references(() => intelligenceRuns.id),
    findingType: varchar("finding_type", { length: 30 }).notNull(),
    severity: varchar("severity", { length: 20 }).notNull(),
    headline: varchar("headline", { length: 120 }).notNull(),
    detail: text("detail").notNull(),
    recommendedAction: text("recommended_action"),
    status: varchar("status", { length: 20 }).default("active").notNull(),
    relatedData: jsonb("related_data").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    // `auth.users(id)` FK — plain uuid; constraint added manually (SETUP.md §5).
    dismissedBy: uuid("dismissed_by"),
    dismissReason: varchar("dismiss_reason", { length: 30 }),
    actionedAt: timestamp("actioned_at", { withTimezone: true }),
  },
  (t) => [
    // Headline length ceiling enforced at the DB layer (Step 3.7 DoD).
    check("findings_headline_max_120", sql`length(${t.headline}) <= 120`),
    // Intelligence Feed primary query: active findings for an org, severity-sorted.
    index("idx_findings_org_active")
      .on(t.orgId, t.severity, t.createdAt.desc())
      .where(sql`${t.status} = 'active'`),
    // Finding history and archive (/alerts screen).
    index("idx_findings_org_all").on(t.orgId, t.createdAt.desc()),
    // Finding type breakdown (anomaly engine monitoring).
    index("idx_findings_org_type").on(t.orgId, t.findingType, t.createdAt.desc()),
    // Expiry cleanup job — partial, only expirable active findings.
    index("idx_findings_expiry")
      .on(t.expiresAt)
      .where(sql`${t.status} = 'active' AND ${t.expiresAt} IS NOT NULL`),
  ],
);

/**
 * Drafts produced by the agentic execution layer (Phase 9). One row per draft
 * generation event; a finding may accumulate several drafts across regenerations.
 * The product never sends on the user's behalf — `copied` is the terminal success
 * state and there is deliberately no `sent` status (CLAUDE.md).
 *
 * `action_type` and `status` are VARCHAR, not Postgres enums (enums are forbidden
 * by CLAUDE.md). `action_type` is one of `invoice_acceleration`,
 * `subscription_cancellation`, `vendor_negotiation`. `status` defaults to `draft`
 * and is one of `draft`, `approved`, `copied`, `rejected`. `draft_content` is TEXT
 * (unbounded) — an email body must never be truncated.
 *
 * `org_id` cascades from `organizations`. `finding_id` references `findings(id)`
 * with NO cascade so draft history survives finding cleanup. `user_id` references
 * Supabase's `auth.users(id)`; like every auth.users column it is a plain `uuid`
 * whose FK is added manually via the Supabase SQL Editor (see SETUP.md §5) with
 * ON DELETE CASCADE. The `*_at` lifecycle timestamps are nullable and set as the
 * draft advances through the review states.
 */
export const actionDrafts = pgTable(
  "action_drafts",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // `auth.users(id)` FK — plain uuid; constraint added manually (SETUP.md §5).
    userId: uuid("user_id").notNull(),
    // No cascade: a draft outlives the finding it acts on.
    findingId: uuid("finding_id")
      .notNull()
      .references(() => findings.id),
    actionType: varchar("action_type", { length: 30 }).notNull(),
    draftContent: text("draft_content").notNull(),
    recipientEmail: varchar("recipient_email", { length: 255 }),
    recipientName: varchar("recipient_name", { length: 255 }),
    subjectLine: varchar("subject_line", { length: 255 }).notNull(),
    status: varchar("status", { length: 20 }).default("draft").notNull(),
    modelUsed: varchar("model_used", { length: 50 }),
    tokensUsed: integer("tokens_used"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    copiedAt: timestamp("copied_at", { withTimezone: true }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  },
  (t) => [
    // Active draft lookup for a finding — most recent draft first.
    index("idx_action_drafts_finding").on(t.findingId, t.createdAt.desc()),
    // Org-level draft history, newest first.
    index("idx_action_drafts_org").on(t.orgId, t.createdAt.desc()),
    // Conversion tracking: drafts by status (how many reach `copied`).
    index("idx_action_drafts_status").on(t.orgId, t.status, t.createdAt.desc()),
  ],
);

/**
 * Point-in-time snapshots of the AI-generated cash flow forecast (Phase 5/6). One
 * row per projection run per org per period length; the most recent row per
 * (org, projection_period_days) is the current projection served by
 * `GET /api/cashflow/projection`.
 *
 * `minimum_projected_balance` is DECIMAL(15,2) — never a float type (CLAUDE.md).
 * It is a pre-computed monetary value enabling fast cliff-detection queries
 * without parsing the JSONB. Drizzle serializes DECIMAL columns to JS strings and
 * the value must stay a string across the API boundary; all arithmetic on it
 * happens in SQL, never in JavaScript. It is nullable because a projection with no
 * computed minimum leaves it NULL rather than fabricating a zero.
 *
 * `projected_data` is JSONB — an array of daily projection objects (date,
 * projected balance, inflow/outflow sources, risk flags). `confidence_level` is
 * VARCHAR, not a Postgres enum (enums are forbidden by CLAUDE.md); it is one of
 * `low`, `medium`, `high` and is always surfaced to the caller per CLAUDE.md.
 * `risk_date` is a DATE (no time component) marking when the minimum projected
 * balance occurs, if below the org's buffer threshold; NULL otherwise.
 *
 * `org_id` cascades from `organizations`. `intelligence_run_id` references
 * `intelligence_runs(id)` with NO cascade and is nullable — a projection may be
 * generated independently of the main nightly run.
 */
export const cashFlowProjections = pgTable(
  "cash_flow_projections",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // No cascade, nullable: a projection may run independently of a full run.
    intelligenceRunId: uuid("intelligence_run_id").references(() => intelligenceRuns.id),
    generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
    projectionPeriodDays: integer("projection_period_days").notNull(),
    projectedData: jsonb("projected_data").notNull(),
    confidenceLevel: varchar("confidence_level", { length: 10 }).notNull(),
    modelUsed: varchar("model_used", { length: 50 }),
    minimumProjectedBalance: decimal("minimum_projected_balance", { precision: 15, scale: 2 }),
    riskDate: date("risk_date"),
  },
  (t) => [
    // Latest projection per org per period (served by /api/cashflow/projection).
    index("idx_cashflow_projections_org_period").on(
      t.orgId,
      t.projectionPeriodDays,
      t.generatedAt.desc(),
    ),
    // Risk date lookup — partial, only rows with a computed risk date.
    index("idx_cashflow_projections_risk")
      .on(t.orgId, t.riskDate)
      .where(sql`${t.riskDate} IS NOT NULL`),
  ],
);
