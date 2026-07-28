import { sql } from "drizzle-orm";
import {
  boolean,
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
