import { index, pgTable, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

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
