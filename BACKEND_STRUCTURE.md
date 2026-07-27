# Backend Architecture
## AI CFO Agent — V1

**Version:** 0.1  
**Date:** July 2026  
**Author:** Engineering

---

## 1. Folder Structure

```
src/
├── app/                                # Next.js App Router — pages and API route handlers
│   ├── (auth)/                         # Unauthenticated route group — no auth middleware
│   │   ├── page.tsx                    # Landing page
│   │   ├── login/
│   │   └── register/
│   ├── (dashboard)/                    # Authenticated route group — auth middleware enforced
│   │   ├── dashboard/
│   │   ├── ask/
│   │   ├── conversations/
│   │   ├── alerts/
│   │   ├── reports/
│   │   ├── settings/
│   │   └── onboarding/
│   └── api/                            # Backend: all HTTP endpoints as Route Handlers
│       ├── auth/                       # Session management and OAuth callback handlers
│       │   ├── me/route.ts             # GET user + org context · PATCH update profile · DELETE account
│       │   ├── logout/route.ts         # POST — clear server-side session
│       │   ├── callback/route.ts       # GET — Supabase magic link callback; exchanges token, routes new vs returning user
│       │   ├── quickbooks/
│       │   │   ├── initiate/route.ts   # GET — builds QB OAuth authorization URL
│       │   │   └── callback/route.ts   # GET — receives QB OAuth code, stores tokens
│       │   └── xero/
│       │       ├── initiate/route.ts   # GET — builds Xero OAuth authorization URL
│       │       └── callback/route.ts   # GET — receives Xero code, stores tokens
│       ├── organizations/              # Organization CRUD and membership management
│       │   ├── route.ts                # POST — create organization
│       │   └── [id]/
│       │       ├── route.ts            # GET / PATCH — read or update org
│       │       ├── members/route.ts    # GET — list org members
│       │       └── invite/route.ts     # POST — invite a user by email
│       ├── connections/                # Accounting platform connections
│       │   ├── route.ts                # GET — list org's active connections
│       │   ├── csv/route.ts            # POST — accept CSV file upload
│       │   └── [id]/
│       │       ├── route.ts            # DELETE — disconnect and schedule data deletion
│       │       └── sync/route.ts       # POST — trigger manual incremental sync
│       ├── financial/                  # Financial data read endpoints
│       │   ├── summary/route.ts        # GET — dashboard metrics (revenue, cash, etc.)
│       │   ├── transactions/route.ts   # GET — paginated + filtered transaction list
│       │   └── accounts/route.ts       # GET — chart of accounts
│       ├── conversations/              # AI conversation sessions
│       │   ├── route.ts                # GET list / POST create conversation
│       │   └── [id]/
│       │       ├── route.ts            # GET single / DELETE conversation
│       │       └── messages/route.ts   # GET history / POST new message (streaming SSE)
│       ├── alerts/                     # Financial anomaly alerts
│       │   ├── route.ts                # GET — paginated alert list with filters
│       │   └── [id]/
│       │       └── acknowledge/route.ts # PATCH — mark alert as read
│       ├── reports/                    # Monthly summary reports
│       │   ├── route.ts                # GET — list reports by org
│       │   ├── generate/route.ts       # POST — trigger on-demand report generation
│       │   └── [id]/
│       │       ├── route.ts            # GET — full report content
│       │       └── export/route.ts     # GET — download as CSV or PDF
│       ├── billing/                    # Subscription and payment management
│       │   ├── usage/route.ts          # GET — query usage this period
│       │   ├── checkout/route.ts       # POST — create Stripe Checkout session
│       │   └── portal/route.ts         # GET — create Stripe Customer Portal session
│       └── webhooks/
│           ├── stripe/route.ts         # POST — Stripe event receiver (subscription updates)
│           └── inngest/route.ts        # POST — Inngest background job endpoint
│
├── lib/                                # Core business logic — the 5-layer architecture
│   ├── platform/                       # Layer 1: Auth, database, multi-tenancy primitives
│   │   ├── db/
│   │   │   ├── schema.ts               # Drizzle ORM schema definitions (all tables)
│   │   │   ├── client.ts               # Database connection factory (pooler vs direct)
│   │   │   ├── rls-policies.sql        # Row Level Security policies — applied MANUALLY via Supabase SQL Editor (see SETUP.md); never run by Drizzle
│   │   │   └── migrations/             # Drizzle-kit generated migration files
│   │   ├── auth/
│   │   │   ├── supabase.ts             # Supabase client factories — server, client, admin
│   │   │   └── session.ts              # Session resolution, org context per request
│   │   ├── security/
│   │   │   └── encryption.ts           # AES-256-GCM for OAuth token encryption
│   │   └── middleware/
│   │       ├── require-auth.ts         # Rejects unauthenticated requests with 401
│   │       └── require-role.ts         # Enforces org role (owner/admin/member/viewer)
│   │
│   ├── integrations/                   # Layer 2: External data ingestion
│   │   ├── quickbooks/
│   │   │   ├── auth.ts                 # OAuth PKCE: URL generation, code exchange, refresh
│   │   │   ├── client.ts               # Decrypts tokens, returns authenticated QB client
│   │   │   ├── import.ts               # Orchestrates Chart of Accounts + transaction import
│   │   │   └── normalize.ts            # Maps QB types → internal Transaction schema
│   │   ├── xero/
│   │   │   ├── auth.ts                 # Xero OAuth, tenant ID resolution
│   │   │   ├── client.ts               # Authenticated xero-node client factory
│   │   │   ├── import.ts               # Xero Journal + Account import
│   │   │   └── normalize.ts            # Maps Xero types → internal Transaction schema
│   │   ├── csv/
│   │   │   ├── parser.ts               # papaparse wrapper with QB export format support
│   │   │   └── normalize.ts            # CSV row → internal Transaction, with validation
│   │   └── shared/
│   │       ├── deduplication.ts        # Upsert-on-external-id, diff detection
│   │       └── rate-limit.ts           # Exponential backoff for 429 responses
│   │
│   ├── financial/                      # Layer 3: Financial calculations and aggregations
│   │   ├── calculations/
│   │   │   ├── pnl.ts                  # Revenue, expenses, net profit for a period
│   │   │   ├── cash-flow.ts            # Cash position, burn rate, runway calculation
│   │   │   └── ratios.ts               # Gross margin, operating expense ratio
│   │   ├── aggregations/
│   │   │   ├── dashboard.ts            # Reads from financial_snapshots for fast dashboard
│   │   │   ├── trends.ts               # MoM, YoY trend data for charts
│   │   │   └── categories.ts           # Expense breakdown by category and period
│   │   ├── intelligence/               # Proactive intelligence engine analysis modules
│   │   │   ├── cash-flow.ts            # 30/60/90-day cash flow projection; writes cash_flow_projections
│   │   │   ├── anomaly.ts              # 4 anomaly types: expense spike, collections slippage, margin, duplicates
│   │   │   ├── ar-aging.ts             # AR aging analysis; generates collections_opportunity findings
│   │   │   └── duplicates.ts           # Duplicate subscription scan; generates duplicate_subscription findings
│   │   └── normalization/
│   │       └── categories.ts           # Maps QB/Xero/CSV categories → 15-category schema
│   │
│   ├── ai/                             # Layer 4: AI engine, prompts, streaming
│   │   ├── prompts/
│   │   │   ├── system.ts               # Base system prompt with org and financial context
│   │   │   ├── financial-qa.ts         # Q&A prompt builder, constructs data payload
│   │   │   └── report.ts               # Monthly summary report generation prompt
│   │   ├── context/
│   │   │   ├── builder.ts              # Fetches recent transactions, builds AI context
│   │   │   └── history.ts              # Loads and window-trims conversation history
│   │   ├── models/
│   │   │   └── router.ts               # Scores query complexity, selects Haiku vs Sonnet
│   │   ├── streaming/
│   │   │   └── handler.ts              # Wraps Vercel AI SDK, appends disclaimer, logs usage
│   │   └── guardrails/
│   │       └── financial-advice.ts     # Pre-flight content check, refuse financial advice
│   │
│   └── billing/                        # Layer 5: Subscription and quota management
│       ├── quota.ts                    # Atomic quota check-and-decrement with row lock
│       ├── stripe.ts                   # Stripe client, checkout session, customer portal
│       └── webhooks.ts                 # Processes Stripe events, updates org plan_tier
│
├── format.ts                           # Shared display utilities: formatCurrency, formatPercent, formatDate
│
├── jobs/                               # Inngest background job function definitions
│   ├── sync/
│   │   ├── fan-out.ts                  # Cron: every 6 hours, fan-out one job per active connection
│   │   └── single-org.ts              # Per-org sync: import → normalize → snapshot → dispatch intelligence/run.requested
│   ├── intelligence/
│   │   ├── run.ts                      # Cron: daily 06:00 UTC, fan-out one intelligence run per active org
│   │   └── email.ts                   # Event-triggered: sends intelligence brief email when high/critical findings present
│   ├── alerts/
│   │   └── evaluate.ts                 # V1 REMNANT — do not implement. Alert/anomaly detection was absorbed into jobs/intelligence/run.ts in V2.
│   ├── reports/
│   │   └── monthly.ts                  # Cron: 1st of month, generates summary for each org
│   └── billing/
│       └── reset-quotas.ts             # Cron: 1st of month 00:00 UTC, resets queries_used_this_period for all orgs
│
├── scripts/                            # Developer utility scripts — NOT deployed code
│   ├── test-connection.ts              # Verifies Supabase DB connectivity
│   ├── seed.ts                         # Seeds demo org + 500+ synthetic transactions
│   ├── test-qb-client.ts               # Smoke-tests an authenticated QuickBooks API call
│   ├── benchmark-financial-queries.ts  # Measures query response times at 10K transaction volume
│   └── capacity-test.ts               # Reports DB size vs Supabase free tier limits
│
├── types/                              # Shared TypeScript interfaces — the domain contracts
│   ├── financial.ts                    # Transaction, Account, Snapshot, Category types
│   ├── ai.ts                           # Message, Conversation, ModelConfig, StreamChunk
│   ├── api.ts                          # ApiResponse<T>, ApiError, PaginatedResponse<T>
│   └── integrations.ts                 # QB, Xero, Plaid API response shape types
│
└── middleware.ts                       # Next.js edge middleware: auth redirects, route guards
```

---

## 2. Database Schema

### Note on monetary precision

**All monetary columns use `DECIMAL`, never `FLOAT`.**

IEEE 754 floating-point (`FLOAT`, `DOUBLE PRECISION`) cannot exactly represent most decimal fractions. `0.1 + 0.2` evaluates to `0.30000000000000004` in binary arithmetic. For a product summing thousands of financial transactions, this accumulated rounding error produces incorrect totals — a class of bug that is difficult to detect and catastrophic for user trust. PostgreSQL's `DECIMAL`/`NUMERIC` type performs exact decimal arithmetic. `DECIMAL(15,2)` stores values from −9,999,999,999,999.99 to +9,999,999,999,999.99 with no rounding error. All monetary columns in this schema use this type. Percentage values use `DECIMAL(7,4)` (e.g., `0.2000` for 20%).

---

### Table: organizations

Multi-tenant root record. Every row of financial data belongs to an organization via `org_id` foreign key.

| Column | Type | Nullable | Default | Constraints | Notes |
|---|---|---|---|---|---|
| `id` | UUID | NOT NULL | `gen_random_uuid()` | PRIMARY KEY | |
| `name` | VARCHAR(255) | NOT NULL | | | Display name |
| `slug` | VARCHAR(100) | NOT NULL | | UNIQUE | URL-safe, auto-generated from name |
| `industry` | VARCHAR(50) | NOT NULL | | | One of 15 predefined industry codes |
| `annual_revenue_band` | VARCHAR(20) | NOT NULL | | | `under_500k`, `500k_2m`, `2m_10m`, `over_10m` |
| `plan_tier` | VARCHAR(20) | NOT NULL | `'trial'` | | `trial`, `starter`, `growth` |
| `timezone` | VARCHAR(50) | NOT NULL | `'UTC'` | | For report delivery timing |
| `created_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | | |
| `updated_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | | Updated via trigger |

```sql
CREATE INDEX idx_organizations_slug ON organizations(slug);
```

**RLS:** Not org-scoped (orgs are the root). Users can only read orgs they belong to via `organization_members` join.

---

### Table: organization_members

Junction table between users and organizations. A user can belong to multiple organizations, which supports the P2 accounting firm portal where one user (the accountant) belongs to the firm org AND can access client orgs.

| Column | Type | Nullable | Default | Constraints | Notes |
|---|---|---|---|---|---|
| `id` | UUID | NOT NULL | `gen_random_uuid()` | PRIMARY KEY | |
| `org_id` | UUID | NOT NULL | | FK → organizations(id) CASCADE | |
| `user_id` | UUID | NOT NULL | | FK → auth.users(id) CASCADE | Supabase auth user |
| `role` | VARCHAR(20) | NOT NULL | `'member'` | | `owner`, `admin`, `member`, `viewer` |
| `invited_by` | UUID | NULL | | FK → auth.users(id) | |
| `invited_at` | TIMESTAMPTZ | NULL | | | Set when invite sent |
| `accepted_at` | TIMESTAMPTZ | NULL | | | NULL means pending invitation |
| `created_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | | |

```sql
-- Primary lookup: all orgs for a given user (used in every RLS policy)
CREATE UNIQUE INDEX idx_org_members_user_org ON organization_members(user_id, org_id);

-- All members of an org (for membership list endpoint)
CREATE INDEX idx_org_members_org ON organization_members(org_id);
```

---

### Table: connections

OAuth connections to QuickBooks, Xero, or Plaid. Tokens are encrypted at rest before storage (see Section 4). One connection per provider per org enforced by unique constraint.

| Column | Type | Nullable | Default | Constraints | Notes |
|---|---|---|---|---|---|
| `id` | UUID | NOT NULL | `gen_random_uuid()` | PRIMARY KEY | |
| `org_id` | UUID | NOT NULL | | FK → organizations(id) CASCADE | |
| `provider` | VARCHAR(20) | NOT NULL | | | `quickbooks`, `xero`, `plaid` |
| `access_token_encrypted` | TEXT | NOT NULL | | | AES-256-GCM ciphertext |
| `refresh_token_encrypted` | TEXT | NULL | | | NULL for providers without refresh |
| `token_expiry` | TIMESTAMPTZ | NULL | | | When access token expires |
| `realm_id` | VARCHAR(100) | NULL | | | QuickBooks Realm ID or Xero Tenant ID |
| `provider_company_name` | VARCHAR(255) | NULL | | | Human-readable name from provider |
| `currency_code` | VARCHAR(3) | NOT NULL | `'USD'` | | Reporting currency from provider |
| `is_active` | BOOLEAN | NOT NULL | `true` | | Set false on disconnect |
| `last_synced_at` | TIMESTAMPTZ | NULL | | | Timestamp of last successful sync |
| `last_intelligence_run_at` | TIMESTAMPTZ | NULL | | | Timestamp of last completed intelligence engine run for this connection's org; updated by the intelligence engine job after each run |
| `sync_status` | VARCHAR(20) | NOT NULL | `'pending'` | | `pending`, `syncing`, `success`, `failed`, `auth_expired` |
| `sync_error_message` | TEXT | NULL | | | Last error description for display |
| `created_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | | |
| `updated_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | | |

```sql
-- Enforce one connection per provider per org
CREATE UNIQUE INDEX idx_connections_org_provider ON connections(org_id, provider);

-- Fan-out sync job reads all active connections efficiently
CREATE INDEX idx_connections_active ON connections(is_active, provider) WHERE is_active = true;

-- Enforce QB/Xero mutual exclusivity at the database layer (not just application layer).
-- PRD Feature F8: "An organization can connect to QuickBooks or Xero, but not both simultaneously in V1."
-- The UNIQUE(org_id, provider) index above allows one QuickBooks AND one Xero connection for the same org
-- (they have different provider values). This partial index closes that gap by preventing two active
-- accounting platform connections of any type for the same org.
-- Note: Plaid (provider='plaid') is excluded because it can coexist with an accounting connection.
CREATE UNIQUE INDEX idx_connections_one_accounting_per_org
  ON connections(org_id)
  WHERE provider IN ('quickbooks', 'xero') AND is_active = true;
```

**RLS:** `org_id = get_user_org_id()`

---

### Table: sync_jobs

Audit log of every background sync attempt. One record per sync run per connection.

| Column | Type | Nullable | Default | Constraints | Notes |
|---|---|---|---|---|---|
| `id` | UUID | NOT NULL | `gen_random_uuid()` | PRIMARY KEY | |
| `connection_id` | UUID | NOT NULL | | FK → connections(id) | |
| `org_id` | UUID | NOT NULL | | | Denormalized for RLS and query convenience |
| `job_type` | VARCHAR(20) | NOT NULL | | | `initial`, `incremental`, `manual` |
| `status` | VARCHAR(20) | NOT NULL | `'pending'` | | `pending`, `running`, `completed`, `failed` |
| `started_at` | TIMESTAMPTZ | NULL | | | Set when job begins |
| `completed_at` | TIMESTAMPTZ | NULL | | | Set on success or final failure |
| `duration_ms` | INTEGER | NULL | | | Elapsed time in milliseconds |
| `records_synced` | INTEGER | NOT NULL | `0` | | Transactions + accounts upserted |
| `records_skipped` | INTEGER | NOT NULL | `0` | | Malformed records skipped |
| `errors_encountered` | JSONB | NOT NULL | `'[]'` | | Array of {external_id, reason} objects |
| `created_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | | |

```sql
-- View sync history per connection
CREATE INDEX idx_sync_jobs_connection ON sync_jobs(connection_id, created_at DESC);

-- View sync history per org (settings page)
CREATE INDEX idx_sync_jobs_org ON sync_jobs(org_id, created_at DESC);
```

**RLS:** `org_id = get_user_org_id()`

---

### Table: data_quality_log

Records malformed or unmappable records encountered during sync. Allows the sync to continue past individual bad records while giving operators visibility into data quality issues.

| Column | Type | Nullable | Default | Constraints | Notes |
|---|---|---|---|---|---|
| `id` | UUID | NOT NULL | `gen_random_uuid()` | PRIMARY KEY | |
| `org_id` | UUID | NOT NULL | | | |
| `sync_job_id` | UUID | NULL | | FK → sync_jobs(id) | NULL for CSV uploads |
| `external_id` | VARCHAR(100) | NULL | | | Provider's transaction ID |
| `source_system` | VARCHAR(20) | NOT NULL | | | |
| `issue_type` | VARCHAR(50) | NOT NULL | | | `null_amount`, `null_account`, `unmapped_category`, `invalid_date` |
| `issue_detail` | TEXT | NULL | | | Human-readable description |
| `raw_data` | JSONB | NULL | | | Original payload for debugging |
| `created_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | | |

```sql
CREATE INDEX idx_dq_log_org ON data_quality_log(org_id, created_at DESC);
CREATE INDEX idx_dq_log_sync ON data_quality_log(sync_job_id) WHERE sync_job_id IS NOT NULL;
```

---

### Table: accounts

Chart of accounts synced from QuickBooks or Xero. Normalized to a common schema regardless of source.

| Column | Type | Nullable | Default | Constraints | Notes |
|---|---|---|---|---|---|
| `id` | UUID | NOT NULL | `gen_random_uuid()` | PRIMARY KEY | |
| `org_id` | UUID | NOT NULL | | FK → organizations(id) CASCADE | |
| `external_id` | VARCHAR(100) | NOT NULL | | | QB Account ID or Xero AccountID |
| `source_system` | VARCHAR(20) | NOT NULL | | | `quickbooks`, `xero`, `csv` |
| `account_type` | VARCHAR(30) | NOT NULL | | | `asset`, `liability`, `equity`, `revenue`, `expense` |
| `account_subtype` | VARCHAR(50) | NULL | | | `checking`, `savings`, `credit_card`, `accounts_receivable`, etc. |
| `name` | VARCHAR(255) | NOT NULL | | | Account display name |
| `description` | TEXT | NULL | | | |
| `current_balance` | DECIMAL(15,2) | NULL | | | Latest balance from provider |
| `currency_code` | VARCHAR(3) | NOT NULL | `'USD'` | | |
| `is_active` | BOOLEAN | NOT NULL | `true` | | |
| `parent_account_id` | UUID | NULL | | FK → accounts(id) | Account hierarchy |
| `created_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | | |
| `updated_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | | |

```sql
-- Deduplication on re-sync
CREATE UNIQUE INDEX idx_accounts_org_external ON accounts(org_id, source_system, external_id);

-- Filter by account type (cash position = asset accounts)
CREATE INDEX idx_accounts_org_type ON accounts(org_id, account_type) WHERE is_active = true;
```

**RLS:** `org_id = get_user_org_id()`

---

### Table: transactions

Core financial data. This will be the largest table in the system. Index strategy is critical and must exist before any meaningful data volume.

| Column | Type | Nullable | Default | Constraints | Notes |
|---|---|---|---|---|---|
| `id` | UUID | NOT NULL | `gen_random_uuid()` | PRIMARY KEY | |
| `org_id` | UUID | NOT NULL | | FK → organizations(id) CASCADE | |
| `external_id` | VARCHAR(100) | NOT NULL | | | QB/Xero native transaction ID |
| `source_system` | VARCHAR(20) | NOT NULL | | | `quickbooks`, `xero`, `csv` |
| `transaction_date` | DATE | NOT NULL | | | Date of transaction (not import date) |
| `posted_date` | DATE | NULL | | | Date posted/cleared (if different) |
| `amount` | DECIMAL(15,2) | NOT NULL | | | Always positive; direction from transaction_type |
| `currency_code` | VARCHAR(3) | NOT NULL | `'USD'` | | Original currency |
| `amount_base` | DECIMAL(15,2) | NULL | | | Amount in org's reporting currency |
| `transaction_type` | VARCHAR(30) | NOT NULL | | | `income`, `expense`, `transfer`, `adjustment` |
| `category` | VARCHAR(50) | NULL | | | Normalized to 15-category internal schema |
| `subcategory` | VARCHAR(50) | NULL | | | Provider-specific subcategory |
| `description` | TEXT | NULL | | | Transaction memo/description |
| `vendor_name` | VARCHAR(255) | NULL | | | Payee or vendor name |
| `account_id` | UUID | NULL | | FK → accounts(id) | Linked chart of accounts entry |
| `reference_number` | VARCHAR(100) | NULL | | | Check number, invoice number |
| `is_reconciled` | BOOLEAN | NOT NULL | `false` | | |
| `raw_data` | JSONB | NULL | | | Full original payload (debug only, not queried) |
| `created_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | | |
| `updated_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | | |

**Index strategy — all six indexes are load-bearing. Create before loading data.**

```sql
-- 1. Primary lookup: all transactions for an org in a date range (used in EVERY query)
CREATE INDEX idx_transactions_org_date
  ON transactions(org_id, transaction_date DESC);

-- 2. Category aggregation: expense breakdown by category for dashboard and AI context
CREATE INDEX idx_transactions_org_category_date
  ON transactions(org_id, category, transaction_date DESC);

-- 3. P&L query: income vs expense totals for a period
CREATE INDEX idx_transactions_org_type_date
  ON transactions(org_id, transaction_type, transaction_date DESC);

-- 4. Account-level lookup: cash position from asset account balances
CREATE INDEX idx_transactions_org_account_date
  ON transactions(org_id, account_id, transaction_date DESC)
  WHERE account_id IS NOT NULL;

-- 5. Deduplication on re-sync (prevents duplicate records on incremental import)
CREATE UNIQUE INDEX idx_transactions_org_external
  ON transactions(org_id, source_system, external_id);

-- 6. Vendor analysis for recurring payment detection (alert evaluation)
CREATE INDEX idx_transactions_org_vendor_date
  ON transactions(org_id, vendor_name, transaction_date DESC)
  WHERE vendor_name IS NOT NULL;
```

**RLS:** `org_id IN (SELECT get_accessible_org_ids())` — uses the firm-aware function (see Section 4).

---

### Table: financial_snapshots

Pre-computed financial metrics, written on every sync. The dashboard reads exclusively from this table — never re-aggregates raw transactions at render time. This is what makes the 3-second dashboard load requirement achievable.

| Column | Type | Nullable | Default | Constraints | Notes |
|---|---|---|---|---|---|
| `id` | UUID | NOT NULL | `gen_random_uuid()` | PRIMARY KEY | |
| `org_id` | UUID | NOT NULL | | FK → organizations(id) CASCADE | |
| `period_start` | DATE | NOT NULL | | | First day of the period |
| `period_end` | DATE | NOT NULL | | | Last day of the period |
| `period_type` | VARCHAR(10) | NOT NULL | | | `month`, `quarter`, `year` |
| `total_revenue` | DECIMAL(15,2) | NULL | | | Sum of income transactions |
| `total_expenses` | DECIMAL(15,2) | NULL | | | Sum of expense transactions |
| `net_profit` | DECIMAL(15,2) | NULL | | | revenue − expenses |
| `cash_position` | DECIMAL(15,2) | NULL | | | Sum of asset account balances |
| `ar_balance` | DECIMAL(15,2) | NULL | | | Accounts receivable; NULL if not available |
| `expense_by_category` | JSONB | NULL | | | `{category: amount}` map, top-level categories |
| `revenue_by_category` | JSONB | NULL | | | |
| `prior_period_revenue` | DECIMAL(15,2) | NULL | | | For MoM comparison (denormalized for speed) |
| `prior_period_expenses` | DECIMAL(15,2) | NULL | | | |
| `sync_job_id` | UUID | NULL | | FK → sync_jobs(id) | Which sync produced this snapshot |
| `created_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | | |

```sql
-- Dashboard query: latest snapshot for current month
CREATE UNIQUE INDEX idx_snapshots_org_period
  ON financial_snapshots(org_id, period_start, period_type);

-- Trend chart: last 7 months of monthly snapshots
CREATE INDEX idx_snapshots_org_monthly
  ON financial_snapshots(org_id, period_start DESC)
  WHERE period_type = 'month';
```

**RLS:** `org_id IN (SELECT get_accessible_org_ids())`

---

### Table: conversations

A conversation session in the `/ask` interface. Groups related messages together for history view and AI context retrieval.

| Column | Type | Nullable | Default | Constraints | Notes |
|---|---|---|---|---|---|
| `id` | UUID | NOT NULL | `gen_random_uuid()` | PRIMARY KEY | |
| `org_id` | UUID | NOT NULL | | FK → organizations(id) CASCADE | Denormalized for RLS |
| `user_id` | UUID | NOT NULL | | FK → auth.users(id) | Who started the conversation |
| `title` | VARCHAR(255) | NULL | | | Auto-generated from first user message |
| `last_message_at` | TIMESTAMPTZ | NULL | | | For ordering in history view |
| `created_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | | |
| `updated_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | | |

```sql
-- History view: all conversations for an org, newest first
CREATE INDEX idx_conversations_org_date
  ON conversations(org_id, last_message_at DESC NULLS LAST);

-- User's own conversations
CREATE INDEX idx_conversations_user
  ON conversations(org_id, user_id, created_at DESC);
```

**RLS:** `org_id = get_user_org_id()`

---

### Table: messages

Individual messages within a conversation. Both user questions and AI responses stored here. The `conversation_id` index is the critical performance path — loading the last 20 messages for AI context must be fast.

| Column | Type | Nullable | Default | Constraints | Notes |
|---|---|---|---|---|---|
| `id` | UUID | NOT NULL | `gen_random_uuid()` | PRIMARY KEY | |
| `conversation_id` | UUID | NOT NULL | | FK → conversations(id) CASCADE | |
| `org_id` | UUID | NOT NULL | | | Denormalized for RLS without join |
| `role` | VARCHAR(20) | NOT NULL | | | `user`, `assistant` |
| `content` | TEXT | NOT NULL | | | Full message text including disclaimer for assistant |
| `model_used` | VARCHAR(50) | NULL | | | `claude-haiku-4-5`, `gemini-2.0-flash`, etc. |
| `input_tokens` | INTEGER | NULL | | | Token count for usage tracking |
| `output_tokens` | INTEGER | NULL | | | |
| `response_time_ms` | INTEGER | NULL | | | Wall-clock time from send to complete |
| `was_cached` | BOOLEAN | NOT NULL | `false` | | True if response served from Redis cache |
| `created_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | | |

```sql
-- Primary access pattern: load last N messages in a conversation (AI context window)
CREATE INDEX idx_messages_conversation
  ON messages(conversation_id, created_at ASC);

-- Full-text search across conversation history
CREATE INDEX idx_messages_org_content
  ON messages(org_id, created_at DESC);
```

**RLS:** `org_id = get_user_org_id()`

---

### Table: query_log

Usage tracking table. Records every AI query attempt, including failures. Separated from `messages` because it must capture attempts that never become messages (quota exceeded, validation error, API timeout).

| Column | Type | Nullable | Default | Constraints | Notes |
|---|---|---|---|---|---|
| `id` | UUID | NOT NULL | `gen_random_uuid()` | PRIMARY KEY | |
| `org_id` | UUID | NOT NULL | | | |
| `user_id` | UUID | NOT NULL | | | |
| `message_id` | UUID | NULL | | FK → messages(id) | NULL if query never completed |
| `success` | BOOLEAN | NOT NULL | | | Whether a response was returned |
| `failure_reason` | VARCHAR(50) | NULL | | | `quota_exceeded`, `api_error`, `api_timeout`, `guardrail_triggered`, `validation_error` |
| `input_tokens` | INTEGER | NULL | | | |
| `output_tokens` | INTEGER | NULL | | | |
| `response_time_ms` | INTEGER | NULL | | | |
| `model_used` | VARCHAR(50) | NULL | | | |
| `created_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | | |

```sql
-- Quota check: count successful queries this billing period for an org
CREATE INDEX idx_query_log_org_period
  ON query_log(org_id, created_at DESC)
  WHERE success = true;

-- Usage history page: queries per day for the last 60 days
CREATE INDEX idx_query_log_org_day
  ON query_log(org_id, (DATE(created_at)) DESC);
```

**Note:** Failed queries do NOT count toward the monthly quota. The quota increment uses `success = true` in its filter.

---

### Table: alerts

Triggered financial anomalies detected during sync evaluation.

| Column | Type | Nullable | Default | Constraints | Notes |
|---|---|---|---|---|---|
| `id` | UUID | NOT NULL | `gen_random_uuid()` | PRIMARY KEY | |
| `org_id` | UUID | NOT NULL | | FK → organizations(id) CASCADE | |
| `alert_type` | VARCHAR(30) | NOT NULL | | | `cash_dip`, `expense_spike`, `missing_payment`, `revenue_decline` |
| `severity` | VARCHAR(20) | NOT NULL | `'medium'` | | `low`, `medium`, `high`, `critical` |
| `title` | VARCHAR(255) | NOT NULL | | | One-sentence plain-English title |
| `description` | TEXT | NOT NULL | | | Includes the specific figures ($58,200 → $45,800) |
| `amount_before` | DECIMAL(15,2) | NULL | | | For cash dip: prior cash position |
| `amount_after` | DECIMAL(15,2) | NULL | | | For cash dip: current cash position |
| `change_percent` | DECIMAL(7,4) | NULL | | | The percentage that triggered this alert |
| `threshold_value` | DECIMAL(7,4) | NULL | | | The configured threshold at trigger time |
| `related_account_id` | UUID | NULL | | FK → accounts(id) | |
| `related_category` | VARCHAR(50) | NULL | | | For expense spike alerts |
| `triggered_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | | |
| `acknowledged_at` | TIMESTAMPTZ | NULL | | | NULL means unread |
| `acknowledged_by` | UUID | NULL | | FK → auth.users(id) | |
| `suppressed_until` | TIMESTAMPTZ | NULL | | | 7-day cooldown: skip re-firing same condition |
| `metadata` | JSONB | NOT NULL | `'{}'` | | Extra alert-specific context |
| `created_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | | |

```sql
-- Alerts list page: unread alerts for an org, newest first
CREATE INDEX idx_alerts_org_unread
  ON alerts(org_id, triggered_at DESC)
  WHERE acknowledged_at IS NULL;

-- Alert evaluation: check if alert type already fired recently (cooldown check)
CREATE INDEX idx_alerts_org_type_suppressed
  ON alerts(org_id, alert_type, suppressed_until)
  WHERE suppressed_until IS NOT NULL;
```

**RLS:** `org_id = get_user_org_id()`

---

### Table: alert_configs

Per-org alert configuration. Stores enabled/disabled state and custom thresholds. Seeded with defaults when an org is created.

| Column | Type | Nullable | Default | Constraints | Notes |
|---|---|---|---|---|---|
| `id` | UUID | NOT NULL | `gen_random_uuid()` | PRIMARY KEY | |
| `org_id` | UUID | NOT NULL | | FK → organizations(id) CASCADE | |
| `alert_type` | VARCHAR(30) | NOT NULL | | | Same enum as alerts.alert_type |
| `is_enabled` | BOOLEAN | NOT NULL | `true` | | |
| `threshold_value` | DECIMAL(7,4) | NOT NULL | | | e.g., `0.2000` for 20% cash dip |
| `email_notifications` | BOOLEAN | NOT NULL | `true` | | |
| `updated_by` | UUID | NULL | | FK → auth.users(id) | |
| `updated_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | | |

```sql
CREATE UNIQUE INDEX idx_alert_configs_org_type ON alert_configs(org_id, alert_type);
```

**RLS:** `org_id = get_user_org_id()`

---

### Table: reports

Generated monthly financial summary reports. Stores both the structured data (`content` JSONB) and the AI-generated plain English narrative.

| Column | Type | Nullable | Default | Constraints | Notes |
|---|---|---|---|---|---|
| `id` | UUID | NOT NULL | `gen_random_uuid()` | PRIMARY KEY | |
| `org_id` | UUID | NOT NULL | | FK → organizations(id) CASCADE | |
| `report_type` | VARCHAR(30) | NOT NULL | | | `monthly_summary`, `custom` |
| `period_start` | DATE | NOT NULL | | | |
| `period_end` | DATE | NOT NULL | | | |
| `status` | VARCHAR(20) | NOT NULL | `'pending'` | | `pending`, `generating`, `ready`, `failed` |
| `generated_at` | TIMESTAMPTZ | NULL | | | Set when status → ready |
| `generation_attempted_at` | TIMESTAMPTZ | NULL | | | For retry logic |
| `generation_error` | TEXT | NULL | | | Last generation error message |
| `content` | JSONB | NULL | | | Structured metrics: {revenue, expenses, categories, …} |
| `plain_text_summary` | TEXT | NULL | | | AI-generated narrative, 250–400 words |
| `model_used` | VARCHAR(50) | NULL | | | |
| `tokens_used` | INTEGER | NULL | | | |
| `generated_by_user_id` | UUID | NULL | | FK → auth.users(id) | NULL for auto-generated |
| `created_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | | |

```sql
-- Reports list: all reports for an org, newest first
CREATE INDEX idx_reports_org_date
  ON reports(org_id, period_start DESC);

-- Prevent duplicate monthly reports per org
CREATE UNIQUE INDEX idx_reports_org_period_type
  ON reports(org_id, period_start, report_type);
```

**RLS:** `org_id = get_user_org_id()`

---

### Table: subscriptions

One active subscription row per organization. Updated by Stripe webhooks. The quota fields here are the source of truth for quota enforcement.

> **Billing period vs quota reset period:** `current_period_start` and `current_period_end` are Stripe billing fields (set by Stripe webhooks) and reflect the subscription anniversary cycle. They are used for payment tracking only. **The `queries_used_this_period` counter resets on the 1st of each calendar month at 00:00 UTC** (via the `jobs/billing/reset-quotas.ts` cron job) regardless of the Stripe billing anniversary. These two cycles are intentionally decoupled: an org subscribing on the 15th is charged by Stripe on the 15th, but their query quota refreshes on the 1st of the next month. Do not use `current_period_start/end` for quota calculation.

| Column | Type | Nullable | Default | Constraints | Notes |
|---|---|---|---|---|---|
| `id` | UUID | NOT NULL | `gen_random_uuid()` | PRIMARY KEY | |
| `org_id` | UUID | NOT NULL | | FK → organizations(id) CASCADE | |
| `stripe_customer_id` | VARCHAR(100) | NULL | | | NULL until first upgrade |
| `stripe_subscription_id` | VARCHAR(100) | NULL | | | NULL on trial tier |
| `plan_tier` | VARCHAR(20) | NOT NULL | `'trial'` | | `trial`, `starter`, `growth` |
| `status` | VARCHAR(20) | NOT NULL | `'active'` | | `active`, `past_due`, `canceled`, `trialing` |
| `current_period_start` | TIMESTAMPTZ | NULL | | | Stripe billing period start — for payment tracking only, not quota reset |
| `current_period_end` | TIMESTAMPTZ | NULL | | | Stripe billing period end — for payment tracking only, not quota reset |
| `queries_used_this_period` | INTEGER | NOT NULL | `0` | | Incremented atomically on each successful query; reset on 1st of calendar month |
| `queries_limit` | INTEGER | NOT NULL | `20` | | Trial=20, Starter=500, Growth=2000; updated by Stripe webhook on tier change |
| `cancel_at_period_end` | BOOLEAN | NOT NULL | `false` | | |
| `created_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | | |
| `updated_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | | |

```sql
-- One subscription per org
CREATE UNIQUE INDEX idx_subscriptions_org ON subscriptions(org_id);

-- Stripe webhook lookup by Stripe IDs
CREATE INDEX idx_subscriptions_stripe_customer ON subscriptions(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;
CREATE INDEX idx_subscriptions_stripe_sub ON subscriptions(stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;
```

**RLS:** `org_id = get_user_org_id()`. Only org admin can update billing.

---

### Table: consent_log

Immutable audit trail of user consent events (regulatory compliance requirement from PRD Section 9).

| Column | Type | Nullable | Default | Constraints | Notes |
|---|---|---|---|---|---|
| `id` | UUID | NOT NULL | `gen_random_uuid()` | PRIMARY KEY | |
| `org_id` | UUID | NOT NULL | | | |
| `user_id` | UUID | NOT NULL | | FK → auth.users(id) | |
| `consent_type` | VARCHAR(50) | NOT NULL | | | `not_financial_advice`, `terms_of_service` |
| `consent_text` | TEXT | NOT NULL | | | Full text of what was agreed to |
| `product_version` | VARCHAR(20) | NOT NULL | | | e.g., `1.0.0` |
| `consented_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | | |
| `ip_address` | INET | NULL | | | From request headers |

No UPDATE or DELETE on this table — it is append-only by policy.

```sql
CREATE INDEX idx_consent_log_org ON consent_log(org_id, consented_at DESC);
CREATE INDEX idx_consent_log_user ON consent_log(user_id, consented_at DESC);
```

---

### Table: firm_clients (P2 — scaffold now, build later)

Models the accounting firm portal relationship. A firm organization can have read access to multiple client organizations. **This table is created in V1 even though the portal feature is P2.** The RLS policies that enforce data isolation reference this table from day 1, avoiding a later schema migration that touches security-critical code.

| Column | Type | Nullable | Default | Constraints | Notes |
|---|---|---|---|---|---|
| `id` | UUID | NOT NULL | `gen_random_uuid()` | PRIMARY KEY | |
| `firm_org_id` | UUID | NOT NULL | | FK → organizations(id) CASCADE | The accounting firm |
| `client_org_id` | UUID | NOT NULL | | FK → organizations(id) CASCADE | The client business |
| `access_level` | VARCHAR(20) | NOT NULL | `'read'` | | `read`, `admin` |
| `invited_by` | UUID | NULL | | FK → auth.users(id) | |
| `invited_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | | |
| `accepted_at` | TIMESTAMPTZ | NULL | | | NULL = invitation pending |
| `created_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | | |

```sql
CREATE UNIQUE INDEX idx_firm_clients_pair ON firm_clients(firm_org_id, client_org_id);
CREATE INDEX idx_firm_clients_client ON firm_clients(client_org_id);
-- Ensure a firm is not its own client
ALTER TABLE firm_clients ADD CONSTRAINT firm_not_own_client
  CHECK (firm_org_id != client_org_id);
```

---

### Table: intelligence_runs

Tracks each execution of the proactive intelligence engine for an organization. One record per run. Used for observability, rate-limit enforcement, and audit of what the engine evaluated and when.

| Column | Type | Nullable | Default | Constraints | Notes |
|---|---|---|---|---|---|
| `id` | UUID | NOT NULL | `gen_random_uuid()` | PRIMARY KEY | |
| `org_id` | UUID | NOT NULL | | FK → organizations(id) CASCADE | |
| `run_type` | VARCHAR(20) | NOT NULL | | | `scheduled`, `triggered` (triggered = manually initiated or post-sync) |
| `started_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | | |
| `completed_at` | TIMESTAMPTZ | NULL | | | NULL while running or if failed/skipped |
| `findings_generated` | INTEGER | NOT NULL | `0` | | Count of new findings written to the `findings` table this run |
| `status` | VARCHAR(20) | NOT NULL | `'running'` | | `running`, `completed`, `failed`, `skipped` |
| `model_used` | VARCHAR(50) | NULL | | | AI provider model string; NULL for skipped runs |
| `tokens_used` | INTEGER | NULL | | | Total tokens consumed across all AI calls in this run |
| `skipped_reason` | VARCHAR(30) | NULL | | | Populated only when `status = 'skipped'`: `rate_limit`, `no_data`, `sync_failed`, `insufficient_history` |
| `created_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | | |

```sql
-- View recent runs per org (intelligence engine monitoring)
CREATE INDEX idx_intelligence_runs_org_date
  ON intelligence_runs(org_id, started_at DESC);

-- Find all skipped runs with their reasons (operational diagnostics)
CREATE INDEX idx_intelligence_runs_skipped
  ON intelligence_runs(org_id, skipped_reason)
  WHERE status = 'skipped';
```

**RLS:** `org_id = get_user_org_id()`

---

### Table: findings

AI-generated intelligence findings surfaced in the Intelligence Feed. Each row represents a single discrete finding — a cash flow risk, an anomaly, a collections opportunity, a duplicate subscription, or a margin alert. Findings transition through a defined status lifecycle.

| Column | Type | Nullable | Default | Constraints | Notes |
|---|---|---|---|---|---|
| `id` | UUID | NOT NULL | `gen_random_uuid()` | PRIMARY KEY | |
| `org_id` | UUID | NOT NULL | | FK → organizations(id) CASCADE | |
| `intelligence_run_id` | UUID | NOT NULL | | FK → intelligence_runs(id) | The run that generated this finding |
| `finding_type` | VARCHAR(30) | NOT NULL | | | `cash_flow_risk`, `anomaly`, `collections_opportunity`, `duplicate_subscription`, `margin_alert` |
| `severity` | VARCHAR(20) | NOT NULL | | | `low`, `medium`, `high`, `critical` |
| `headline` | VARCHAR(120) | NOT NULL | | | Plain-English finding title shown in the Intelligence Feed card. Max 120 chars enforced. |
| `detail` | TEXT | NOT NULL | | | Full explanation of the finding with specific figures, shown on card expand |
| `recommended_action` | TEXT | NULL | | | One-sentence suggested next step; NULL if no clear actionable follow-up exists |
| `status` | VARCHAR(20) | NOT NULL | `'active'` | | `active`, `actioned`, `dismissed`, `expired` |
| `related_data` | JSONB | NOT NULL | `'{}'` | | Structured context specific to the finding type: invoice IDs, vendor names, amount deltas, etc. Used by the agentic execution layer to pre-populate drafts |
| `created_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | | |
| `expires_at` | TIMESTAMPTZ | NULL | | | Findings that are time-sensitive expire automatically (e.g., a cash risk projected for a specific date expires after that date passes) |
| `dismissed_at` | TIMESTAMPTZ | NULL | | | Set when user dismisses |
| `dismissed_by` | UUID | NULL | | FK → auth.users(id) | |
| `dismiss_reason` | VARCHAR(30) | NULL | | | `not_relevant`, `already_handled`, `incorrect` |
| `actioned_at` | TIMESTAMPTZ | NULL | | | Set when user approves and copies an action draft for this finding |

```sql
-- Intelligence Feed primary query: active findings for an org, sorted by severity
-- severity ordering: critical > high > medium > low
CREATE INDEX idx_findings_org_active
  ON findings(org_id, severity, created_at DESC)
  WHERE status = 'active';

-- Finding history and archive (/alerts screen)
CREATE INDEX idx_findings_org_all
  ON findings(org_id, created_at DESC);

-- Finding type breakdown (anomaly engine monitoring)
CREATE INDEX idx_findings_org_type
  ON findings(org_id, finding_type, created_at DESC);

-- Expiry cleanup job
CREATE INDEX idx_findings_expiry
  ON findings(expires_at)
  WHERE status = 'active' AND expires_at IS NOT NULL;
```

**RLS:** `org_id IN (SELECT get_accessible_org_ids())`

**Status transitions:**
```
active → actioned   (user copies an action draft for this finding)
active → dismissed  (user explicitly dismisses with a reason)
active → expired    (expires_at passes without user action; set by nightly cleanup job)
```
Once in `actioned`, `dismissed`, or `expired`, a finding is immutable. A new finding of the same type for the same condition will be generated by the next intelligence run if the condition persists.

---

### Table: action_drafts

Stores drafts created by the agentic execution layer. One record per draft generation event. A single finding may have multiple drafts if the user regenerates or edits. The most recent draft with `status = 'draft'` or `'approved'` is the active draft for a finding.

| Column | Type | Nullable | Default | Constraints | Notes |
|---|---|---|---|---|---|
| `id` | UUID | NOT NULL | `gen_random_uuid()` | PRIMARY KEY | |
| `org_id` | UUID | NOT NULL | | FK → organizations(id) CASCADE | Denormalized for RLS |
| `user_id` | UUID | NOT NULL | | FK → auth.users(id) | User who triggered draft generation |
| `finding_id` | UUID | NOT NULL | | FK → findings(id) | The finding this draft acts on |
| `action_type` | VARCHAR(30) | NOT NULL | | | `invoice_acceleration`, `subscription_cancellation`, `vendor_negotiation` |
| `draft_content` | TEXT | NOT NULL | | | Full email body text as generated and/or edited by the user |
| `recipient_email` | VARCHAR(255) | NULL | | | Pulled from QBO contact data; NULL if not on file |
| `recipient_name` | VARCHAR(255) | NULL | | | Pulled from QBO customer record |
| `subject_line` | VARCHAR(255) | NOT NULL | | | Email subject line |
| `status` | VARCHAR(20) | NOT NULL | `'draft'` | | `draft`, `approved`, `copied`, `rejected` |
| `model_used` | VARCHAR(50) | NULL | | | AI model that generated the original draft |
| `tokens_used` | INTEGER | NULL | | | Tokens consumed for this draft generation |
| `created_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | | |
| `approved_at` | TIMESTAMPTZ | NULL | | | Set when user clicks "Looks good →" (State 3 → 4) |
| `copied_at` | TIMESTAMPTZ | NULL | | | Set when user clicks "Copy to clipboard" (State 4 → 5) |
| `rejected_at` | TIMESTAMPTZ | NULL | | | Set when user closes modal without approving |

```sql
-- Active draft lookup for a finding (most recent draft per finding)
CREATE INDEX idx_action_drafts_finding
  ON action_drafts(finding_id, created_at DESC);

-- Org-level draft history
CREATE INDEX idx_action_drafts_org
  ON action_drafts(org_id, created_at DESC);

-- Conversion tracking: how many drafts reach 'copied' status
CREATE INDEX idx_action_drafts_status
  ON action_drafts(org_id, status, created_at DESC);
```

**RLS:** `org_id = get_user_org_id()`

**Status transitions:**
```
draft   → approved  (user clicks "Looks good →")
draft   → rejected  (user closes modal without approving)
approved → copied   (user clicks "Copy to clipboard")
approved → rejected (user clicks "← Edit", returns to State 3, current draft rejected, new draft created)
```

**V1 constraint:** `action_type` values reflect only the three draft-and-approve actions available in V1. The `status` column never reaches a hypothetical `sent` state — the product does not send email on the user's behalf. `copied` is the terminal success state in V1.

---

### Table: cash_flow_projections

Point-in-time snapshots of the AI-generated cash flow forecast. One record is written per projection run per org per period length. The most recent record per org per `projection_period_days` is the current projection served by `/api/cashflow/projection`.

| Column | Type | Nullable | Default | Constraints | Notes |
|---|---|---|---|---|---|
| `id` | UUID | NOT NULL | `gen_random_uuid()` | PRIMARY KEY | |
| `org_id` | UUID | NOT NULL | | FK → organizations(id) CASCADE | |
| `intelligence_run_id` | UUID | NULL | | FK → intelligence_runs(id) | NULL if generated independently of the main intelligence run |
| `generated_at` | TIMESTAMPTZ | NOT NULL | `NOW()` | | |
| `projection_period_days` | INTEGER | NOT NULL | | | `30`, `60`, or `90` |
| `projected_data` | JSONB | NOT NULL | | | Array of daily projection objects — see schema below |
| `confidence_level` | VARCHAR(10) | NOT NULL | | | `low` (30–59 days history), `medium` (60–89 days), `high` (90+ days) |
| `model_used` | VARCHAR(50) | NULL | | | |
| `minimum_projected_balance` | DECIMAL(15,2) | NULL | | | Pre-computed minimum projected balance within the period; used for fast cliff detection queries without parsing JSONB |
| `risk_date` | DATE | NULL | | | The specific date on which the minimum projected balance occurs, if that balance is below the org's configured buffer threshold |

`projected_data` JSONB schema (one object per calendar day in the projection window):
```json
[
  {
    "date": "2026-10-21",
    "projected_balance": -12400.00,
    "inflows": 0.00,
    "outflows": 4200.00,
    "inflow_sources": [
      { "client_name": "Acme Corp", "invoice_id": "INV-1047", "amount": 12500.00, "confidence": "medium" }
    ],
    "outflow_sources": [
      { "description": "AWS (recurring)", "amount": 4200.00, "type": "recurring_expense" }
    ],
    "risk_flags": ["below_zero", "below_buffer_threshold"]
  }
]
```

```sql
-- Latest projection per org per period (served by /api/cashflow/projection)
CREATE INDEX idx_cashflow_projections_org_period
  ON cash_flow_projections(org_id, projection_period_days, generated_at DESC);

-- Risk date lookup for intelligence feed integration
CREATE INDEX idx_cashflow_projections_risk
  ON cash_flow_projections(org_id, risk_date)
  WHERE risk_date IS NOT NULL;
```

**RLS:** `org_id IN (SELECT get_accessible_org_ids())`

---

> **⚠ Manual migration step:** The `get_accessible_org_ids()` function and all RLS `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY` statements are applied as a **manual SQL step** via the Supabase SQL Editor — they are not generated or tracked by Drizzle migrations. This is because Drizzle-kit does not yet have first-class support for PostgreSQL RLS policy management. The SQL must be stored in `src/lib/platform/db/rls-policies.sql` and applied manually to both development and production databases. A `SETUP.md` file at the project root documents this as a required manual step that cannot be skipped. The production deployment checklist (IMPLEMENTATION_PLAN Step 15.7) explicitly includes applying this SQL. Because these policies are security-critical, the RLS isolation test suite (IMPLEMENTATION_PLAN Step 15.0) must be run after any schema change to verify policies remain effective.

This function returns all org IDs the current user can access — their own orgs AND client orgs via firm_clients. Used in all RLS policies. Defined once, referenced everywhere.

```sql
CREATE OR REPLACE FUNCTION get_accessible_org_ids()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  -- Orgs the user is a direct member of
  SELECT org_id
  FROM organization_members
  WHERE user_id = auth.uid()
  UNION
  -- Client orgs accessible via firm portal (P2 — returns nothing until firm_clients is populated)
  SELECT fc.client_org_id
  FROM firm_clients fc
  INNER JOIN organization_members om ON om.org_id = fc.firm_org_id
  WHERE om.user_id = auth.uid()
    AND fc.accepted_at IS NOT NULL;
$$;
```

This single function is the gating mechanism for all financial data access. Adding the firm portal later requires only populating `firm_clients` rows — no changes to RLS policies.

---

## 3. API Endpoints

### Convention: all endpoints return this envelope

```typescript
// Success
{ "data": T, "meta"?: PaginationMeta }

// Error
{ "error": { "code": string, "message": string, "details"?: unknown, "request_id": string } }
```

---

### Auth Endpoints

---

#### GET /api/auth/me
- **Auth:** Requires valid Supabase session cookie
- **Description:** Returns the current authenticated user, their active organization, and their role in that org
- **Request body:** None
- **Response 200:**
```typescript
{
  data: {
    user: { id: string; email: string; displayName: string };
    organization: {
      id: string; name: string; slug: string;
      industry: string; planTier: string;
    };
    role: 'owner' | 'admin' | 'member' | 'viewer';
    subscription: {
      queriesUsed: number; queriesLimit: number;
      planTier: string; nextResetAt: string;
    };
  }
}
```
- **Errors:** `401` — no valid session

---

#### GET /api/auth/callback
- **Auth:** Public — this route is the magic link landing handler; no session exists yet when it fires
- **Description:** Exchanges the Supabase magic link `token_hash` (passed as a query parameter by the email link) for a server-side session, then routes the user to the correct next screen. This is the highest-traffic route in the application — every user passes through it at least once per session.
- **Query params:** `token_hash` (string, required), `type` (string, `magiclink` or `recovery`), `next` (optional redirect override)
- **Routing logic:**
  - Token invalid or expired → redirect to `/login?error=link_expired`
  - New user (no `organizations` record), `?source=bench` in session → redirect to `/onboarding/migration?source=bench`
  - New user (no `organizations` record) → redirect to `/onboarding/migration`
  - Returning user, has org + active accounting connection, last sync completed → redirect to `/dashboard`
  - Returning user, has org + connection, sync never completed → redirect to `/onboarding/sync`
  - Returning user, has org, no accounting connection → redirect to `/onboarding/connect`
- **Response:** HTTP 302 redirect (no JSON body)
- **Errors:** Invalid token → redirect to `/login?error=link_expired` (never expose the raw Supabase error to the client)
- **Side effects:** Writes session cookie via `@supabase/ssr`. Preserves `?source=bench` param in the session so the migration check screen can read it.

---

#### POST /api/auth/logout
- **Auth:** Requires session
- **Description:** Destroys the server-side Supabase session and clears cookies
- **Response 200:** `{ data: { success: true } }`
- **Side effects:** Supabase session revoked

---

#### PATCH /api/auth/me
- **Auth:** Requires session
- **Description:** Updates the current user's profile fields. Only fields included in the request body are updated.
- **Request body:**
```typescript
{
  displayName?: string;  // 1–100 chars
  timezone?: string;     // Valid IANA timezone string e.g. "America/New_York"
}
```
- **Response 200:**
```typescript
{ data: { user: { id, email, displayName, timezone } } }
```
- **Errors:** `400` invalid timezone string or displayName too long

---

#### DELETE /api/auth/me
- **Auth:** Requires session
- **Description:** Deletes the current user's account. The user's organization data is not deleted — it persists for other org members. If the user is the sole owner of an organization with no other members, the organization's data is also scheduled for deletion within 24 hours.
- **Request body:** `{ confirmationEmail: string }` — must match the user's email (prevents accidental deletion)
- **Response 200:** `{ data: { deleted: true, orgDataScheduledForDeletion: boolean } }`
- **Errors:** `400` confirmationEmail does not match, `409` org has pending active Stripe subscription (must cancel first)
- **Side effects:** Deletes auth.users row (cascades to organization_members). If sole org owner: schedules org data deletion via Inngest event.

---

### Organization Endpoints

---

#### POST /api/organizations
- **Auth:** Requires session (user must not already own an organization)
- **Description:** Creates an organization and seeds default alert_configs and a trial subscription record
- **Request body:**
```typescript
{
  name: string;          // 1–255 chars
  industry: string;      // one of 15 predefined codes
  revenueBand: string;   // 'under_500k' | '500k_2m' | '2m_10m' | 'over_10m'
  consentText: string;   // exact text of the disclaimer the user acknowledged
}
```
- **Response 201:**
```typescript
{ data: { organization: { id, name, slug, industry, planTier } } }
```
- **Errors:** `400` validation error, `409` user already owns an org
- **Side effects:** Creates `organization_members` row (role: owner), creates 4 `alert_configs` rows with defaults, creates `subscriptions` row (trial), writes to `consent_log`

---

#### GET /api/organizations/:id
- **Auth:** Requires session + org membership
- **Response 200:** Full org object including plan, sync status, and connection summary

---

#### PATCH /api/organizations/:id
- **Auth:** Requires session + role: `admin` or `owner`
- **Request body:** `{ name?, industry?, revenueBand?, timezone? }`
- **Response 200:** Updated org object
- **Errors:** `403` insufficient role, `404` org not found (or not a member)

---

#### GET /api/organizations/:id/members
- **Auth:** Requires session + org membership
- **Response 200:**
```typescript
{ data: { members: Array<{ userId, email, displayName, role, joinedAt }> } }
```

---

#### POST /api/organizations/:id/invite
- **Auth:** Requires session + role: `admin` or `owner`
- **Request body:** `{ email: string; role: 'admin' | 'member' | 'viewer' }`
- **Response 201:** `{ data: { inviteId, email, role } }`
- **Errors:** `400` invalid email, `409` user already a member
- **Side effects:** Sends invitation email via Resend with magic link

---

### Connection Endpoints

---

#### GET /api/connections
- **Auth:** Requires session
- **Description:** Lists all active and inactive connections for the current org
- **Response 200:**
```typescript
{
  data: {
    connections: Array<{
      id, provider, providerCompanyName, isActive,
      syncStatus, lastSyncedAt, currencyCode,
      lastIntelligenceRunAt: string | null;  // from connections.last_intelligence_run_at; shown as "last intelligence run time" in Settings > Connections
      recentSyncJobs: Array<{ status, recordsSynced, completedAt, durationMs }>  // limited to 5 most recent
    }>
  }
}
```

---

#### GET /api/auth/quickbooks/initiate
- **Auth:** Requires session + role: `admin` or `owner`
- **Description:** Generates the QuickBooks OAuth 2.0 PKCE authorization URL, stores the state/code_verifier in an encrypted short-lived cookie
- **Response 200:** `{ data: { authorizationUrl: string } }`
- **Side effects:** Stores PKCE code_verifier and CSRF state in httpOnly cookie (2-minute TTL)

---

#### GET /api/auth/quickbooks/callback
- **Auth:** Internal — receives OAuth redirect from QuickBooks (state param validated against cookie)
- **Description:** Exchanges authorization code for tokens, encrypts and stores in `connections`, triggers initial sync job
- **Response:** Redirects to `/onboarding/sync` (new connection) or `/settings/connections` (reconnect)
- **Errors:** Redirects to `/settings/connections?error=auth_failed`
- **Side effects:** Creates or updates `connections` row, triggers Inngest `sync/connection.requested` event (the event Job 2 listens on)

---

#### GET /api/auth/xero/initiate
- Same pattern as QuickBooks initiate

#### GET /api/auth/xero/callback
- Same pattern as QuickBooks callback

---

#### DELETE /api/connections/:id
- **Auth:** Requires session + role: `admin` or `owner`
- **Description:** Marks connection inactive and schedules data deletion within 24 hours
- **Response 200:** `{ data: { deletionScheduledAt: string } }`
- **Side effects:** Sets `connections.is_active = false`, enqueues Inngest `connections.data_deletion` job (runs after 24h), sends confirmation email to org admin

---

#### POST /api/connections/:id/sync
- **Auth:** Requires session + org membership
- **Description:** Triggers a manual incremental sync for this connection
- **Response 202:** `{ data: { syncJobId: string; status: 'queued' } }`
- **Errors:** `409` if sync already in progress for this connection
- **Side effects:** Enqueues Inngest `sync/connection.requested` event (the event Job 2 listens on)

---

#### POST /api/connections/csv
- **Auth:** Requires session + role: `admin` or `owner`
- **Description:** Accepts a QuickBooks Transaction Detail Report CSV export, parses and normalizes into the transactions table
- **Request body:** `multipart/form-data` with file field `csv`
- **Response 200:** `{ data: { recordsImported, recordsSkipped, syncJobId } }`
- **Errors:** `400` invalid file format, `413` file too large (>50MB), `422` no parseable rows

---

### Financial Data Endpoints

---

#### GET /api/financial/summary
- **Auth:** Requires session
- **Description:** Returns pre-computed dashboard metrics from `financial_snapshots`. Reads from the snapshot table — never re-aggregates raw transactions. Target response time: < 500ms
- **Query params:** `period=current_month` (default) | `period=last_month`
- **Response 200:**
```typescript
{
  data: {
    currentMonth: {
      revenue: string;              // DECIMAL serialized as string to preserve precision
      revenueChangePct: number | null;
      expenses: string;
      expensesChangePct: number | null;
      netProfit: string;
      cashPosition: string;
      arBalance: string | null;     // null if unavailable on QB plan
    };
    topExpenseCategories: Array<{ category: string; amount: string; sharePct: number }>;
    revenueByMonth: Array<{ month: string; revenue: string; isPartial: boolean }>;
    lastSyncedAt: string | null;
    syncStatus: 'success' | 'syncing' | 'failed' | 'never';
    dataAsOf: string;
  }
}
```

> **Why DECIMAL serialized as string:** JavaScript `number` is IEEE 754 float, which reintroduces the precision problem at the serialization layer. Monetary values are serialized as strings and parsed client-side with a precise formatting function.

---

#### GET /api/financial/transactions
- **Auth:** Requires session
- **Description:** Paginated transaction list with filtering
- **Query params:**
  - `page` (default 1), `pageSize` (default 50, max 200)
  - `from` / `to` (ISO dates)
  - `type` (`income` | `expense` | `transfer`)
  - `category` (single category filter)
  - `accountId` (single account filter)
  - `search` (searches description and vendor_name)
- **Response 200:**
```typescript
{
  data: {
    transactions: Array<{
      id, transactionDate, amount, currency, transactionType,
      category, description, vendorName, accountName
    }>;
  };
  meta: { page, pageSize, total, totalPages }
}
```

---

#### GET /api/financial/accounts
- **Auth:** Requires session
- **Response 200:** Array of active accounts with type, subtype, name, and current_balance

---

### Conversation Endpoints

---

#### GET /api/conversations
- **Auth:** Requires session
- **Description:** Lists all conversations for the org, newest first
- **Query params:** `search` (text search), `page`, `pageSize`
- **Response 200:** Paginated list of conversations with message count and last message preview

---

#### POST /api/conversations
- **Auth:** Requires session
- **Description:** Creates a new empty conversation session
- **Response 201:** `{ data: { conversationId: string } }`

---

#### GET /api/conversations/:id
- **Auth:** Requires session + must be member of the org that owns the conversation
- **Description:** Returns the full conversation with all messages
- **Errors:** `403` if conversation belongs to different org, `404` if not found
- **Response 200:**
```typescript
{
  data: {
    conversation: { id, title, createdAt };
    messages: Array<{
      id, role, content, modelUsed, createdAt, userDisplayName
    }>;
  }
}
```

---

#### POST /api/conversations/:id/messages
- **Auth:** Requires session + quota check (reads from `subscriptions.queries_used_this_period`)
- **Description:** The core AI query endpoint. Streams the AI response using Server-Sent Events (Vercel AI SDK `toDataStreamResponse()`).
- **Request body:**
```typescript
{
  content: string;           // User's question, max 2000 characters
  conversationId: string;    // Must match the URL :id param
}
```
- **Processing flow (order matters):**
  1. Validate session and org membership
  2. Check quota: read `subscriptions` with row lock; if `queries_used_this_period >= queries_limit`, return 422
  3. Check rate limit: Upstash sliding window (10 requests/60s per org)
  4. Check content guardrails: flag if question attempts to elicit financial advice
  5. Load conversation history: last 20 messages from this conversation
  6. Build financial context: recent snapshot + relevant transaction summaries
  7. Route to model: complexity scoring → Haiku or Sonnet
  8. Stream response via `streamText().toDataStreamResponse()`
  9. On stream complete: write user + assistant messages to `messages`, write to `query_log`, increment `subscriptions.queries_used_this_period`, update `conversations.last_message_at`
- **Response:** `text/event-stream` (SSE). The disclaimer is appended as the final text chunk.
- **Errors:**
  - `401` — not authenticated
  - `403` — not a member of this org
  - `422` — quota exhausted (`{ code: 'quota_exhausted', queriesLimit, resetAt }`)
  - `429` — rate limit exceeded
  - `500` — AI API failure (query logged with `success=false`, not counted against quota)

---

#### DELETE /api/conversations/:id
- **Auth:** Requires session + conversation belongs to requesting user's org
- **Response 200:** `{ data: { deleted: true } }`

---

#### GET /api/conversations/export
- **Auth:** Requires session
- **Description:** Exports the full conversation history for the organization as a downloadable JSON file. Used by the "Export history" button on the `/conversations` page. History is retained for 12 months; records older than 12 months will not be included.
- **Query params:** None (always exports full 12-month window)
- **Response:** File download with headers `Content-Type: application/json`, `Content-Disposition: attachment; filename=[org-slug]_conversation-history.json`
- **Response body structure:**
```typescript
{
  exportedAt: string;            // ISO 8601 timestamp
  organization: string;          // org name
  retentionPeriodMonths: 12;
  conversations: Array<{
    id: string;
    title: string | null;
    createdAt: string;
    messages: Array<{
      role: 'user' | 'assistant';
      content: string;
      createdAt: string;
      userDisplayName: string;
    }>;
  }>;
}
```
- **Errors:** `429` if export requested more than once per hour per org (rate limited to prevent abuse)

---

### Alert Endpoints

---

#### GET /api/alerts
- **Auth:** Requires session
- **Query params:** `acknowledged` (true|false|all, default: false), `type`, `page`, `pageSize`
- **Response 200:** Paginated alert list with unread count in meta

---

#### PATCH /api/alerts/:id/acknowledge
- **Auth:** Requires session
- **Description:** Marks alert as read, records who acknowledged it
- **Response 200:** Updated alert object

---

#### GET /api/alert-configs
- **Auth:** Requires session
- **Description:** Returns all four alert configuration rows for the current organization. Used by the `/settings/notifications` page to render the alert toggles and threshold inputs.
- **Response 200:**
```typescript
{
  data: {
    configs: Array<{
      alertType: 'cash_dip' | 'expense_spike' | 'missing_payment' | 'revenue_decline';
      isEnabled: boolean;
      thresholdValue: number;       // e.g., 0.20 for 20%
      emailNotifications: boolean;
      dataReady: boolean;           // false if org has < 60 days history for this type
    }>
  }
}
```

---

#### PATCH /api/alert-configs/:alertType
- **Auth:** Requires session + role: `admin` or `owner`
- **Description:** Updates a single alert configuration. Only fields included in the request body are changed. Changes take effect on the next sync cycle.
- **Request body:**
```typescript
{
  isEnabled?: boolean;
  thresholdValue?: number;         // e.g., 0.20 for 20%; must be > 0 and <= 1 for percentage thresholds
  emailNotifications?: boolean;
}
```
- **Response 200:** Updated alert config object
- **Errors:** `400` invalid alertType path param or invalid thresholdValue, `403` insufficient role

---

### Report Endpoints

---

#### GET /api/reports
- **Auth:** Requires session
- **Response 200:** Paginated list of reports with status, period, and generation timestamp

---

#### POST /api/reports/generate
- **Auth:** Requires session + quota check (report generation uses AI quota)
- **Request body:** `{ periodStart: string; periodEnd: string; reportType: 'monthly_summary' }`
- **Response 202:** `{ data: { reportId, status: 'generating' } }`
- **Errors:** `409` if a report for this period already exists and is ready
- **Side effects:** Creates a `reports` row with status `generating`, enqueues Inngest `reports.generate` event

---

#### GET /api/reports/:id
- **Auth:** Requires session + report belongs to user's org
- **Response 200:** Full report with plain_text_summary and structured content

---

#### GET /api/reports/:id/export
- **Auth:** Requires session
- **Query params:** `format=csv` | `format=pdf`
- **Description:** Generates and streams the file. Not cached — generated on request.
- **Response:** File download (Content-Type: `text/csv` or `application/pdf`)
- **Errors:** `400` invalid format, `404` report not found, `503` if report status is not `ready`

---

### Intelligence Endpoints

---

#### GET /api/intelligence/feed
- **Auth:** Requires session
- **Description:** Returns the current active findings for the org, sorted by severity (critical → high → medium → low), then by `created_at` descending within each severity tier. This is the primary data source for the `/dashboard` Intelligence Feed screen. Only findings with `status = 'active'` are returned; dismissed, actioned, and expired findings are excluded.
- **Query params:**
  - `cursor` (optional, string) — opaque cursor for cursor-based pagination; omit for first page
  - `limit` (optional, integer, default 20, max 50) — findings per page
  - `finding_type` (optional, string) — filter by a single `finding_type` value
- **Response 200:**
```typescript
{
  data: {
    findings: Array<{
      id: string;
      findingType: 'cash_flow_risk' | 'anomaly' | 'collections_opportunity' | 'duplicate_subscription' | 'margin_alert';
      severity: 'low' | 'medium' | 'high' | 'critical';
      headline: string;                   // max 120 chars, plain English
      detail: string;                     // full explanation
      recommendedAction: string | null;
      relatedData: Record<string, unknown>; // finding-type-specific context
      createdAt: string;
      expiresAt: string | null;
      hasActionableType: boolean;         // true if the agentic execution layer can draft for this type
    }>;
  };
  meta: {
    nextCursor: string | null;            // null = no more pages
    total: number;                        // total active findings (all pages)
    bySeverity: { critical: number; high: number; medium: number; low: number };
    lastIntelligenceRunAt: string | null;
  };
}
```
- **Errors:** `401` — not authenticated, `403` — not an org member

---

#### GET /api/intelligence/findings
- **Auth:** Requires session
- **Description:** Returns all findings for the org across all statuses. Used by the `/alerts` archive page. Unlike `GET /api/intelligence/feed` (which returns only `status='active'`), this endpoint supports multi-status queries and is the data source for the historical archive.
- **Query params:**
  - `status` (optional): `active` | `dismissed` | `actioned` | `expired` | `all` (default: `all`)
  - `finding_type` (optional): filter to a single finding type
  - `severity` (optional): `critical` | `high` | `medium` | `low`
  - `cursor` (optional): cursor for pagination
  - `limit` (optional, default 30, max 100)
  - `startDate` (optional, ISO date): filter findings created on or after this date
  - `endDate` (optional, ISO date): filter findings created on or before this date
- **Response 200:**
```typescript
{
  data: {
    findings: Array<{
      id: string;
      findingType: string;
      severity: 'low' | 'medium' | 'high' | 'critical';
      headline: string;
      detail: string;
      recommendedAction: string | null;
      status: 'active' | 'actioned' | 'dismissed' | 'expired';
      createdAt: string;
      expiresAt: string | null;
      dismissedAt: string | null;
      dismissReason: string | null;
      actionedAt: string | null;
      hasActionableType: boolean;
    }>;
  };
  meta: {
    nextCursor: string | null;
    total: number;
  };
}
```
- **Errors:** `401` not authenticated, `403` not an org member

---

#### POST /api/intelligence/findings/:id/dismiss
- **Auth:** Requires session
- **Description:** Dismisses a finding, removing it from the active Intelligence Feed. The user must provide a reason. The dismiss reason is stored for model evaluation — repeated dismissals with reason `incorrect` on a given finding type are a signal to tune the intelligence engine's sensitivity for that org.
- **Request body:**
```typescript
{
  reason: 'not_relevant' | 'already_handled' | 'incorrect';
}
```
- **Response 200:**
```typescript
{
  data: {
    finding: { id: string; status: 'dismissed'; dismissedAt: string; dismissReason: string };
  }
}
```
- **Errors:** `400` — missing or invalid reason, `403` — not an org member, `404` — finding not found or belongs to a different org, `409` — finding is not in `active` status (cannot dismiss an already-dismissed or actioned finding)
- **Side effects:** Sets `findings.status = 'dismissed'`, `findings.dismissed_at = NOW()`, `findings.dismissed_by = user_id`, `findings.dismiss_reason`. Writes a `dismiss_reason` event to an internal feedback table for model evaluation (not user-visible).

---

#### POST /api/intelligence/findings/:id/draft-action
- **Auth:** Requires session
- **Description:** Triggers the agentic execution engine to generate a draft communication for this finding. The engine constructs a prompt from the finding's `related_data` (invoice numbers, amounts, client names pulled from QBO) and calls the configured AI provider to produce a professional draft email. The draft is stored in `action_drafts` and returned to the client.
- **Request body:** None
- **Response 201:**
```typescript
{
  data: {
    draft: {
      id: string;
      actionType: 'invoice_acceleration' | 'subscription_cancellation' | 'vendor_negotiation';
      draftContent: string;               // full email body, plain text
      recipientEmail: string | null;      // null if QBO has no email on file for this contact
      recipientName: string | null;
      subjectLine: string;
      status: 'draft';
      createdAt: string;
    };
    recipientEmailMissing: boolean;       // true = show the "no email on file" warning in the UI
  }
}
```
- **Errors:** `403` — not an org member, `404` — finding not found, `409` — finding is not in `active` status, `422` — finding type does not support agentic action (not all finding types have associated draft templates), `503` — AI provider unavailable
- **Side effects:** Creates a row in `action_drafts` with `status = 'draft'`. Calls the AI provider via `AI_PROVIDER` environment variable — the AI provider is not hardcoded to Claude. The prompt includes: the finding headline and detail, the `related_data` payload (invoice IDs, client name, amounts, days overdue), the org name, and the action type template instructions. **Does not send any communication.** The created draft is a text artifact only.

---

#### PATCH /api/intelligence/actions/:id
- **Auth:** Requires session
- **Description:** Updates the status of an action draft as the user moves through the agentic execution modal flow. Three valid status transitions are supported.
- **Request body:**
```typescript
{
  status: 'approved' | 'copied' | 'rejected';
}
```
- **Response 200:**
```typescript
{
  data: {
    draft: {
      id: string;
      status: 'approved' | 'copied' | 'rejected';
      approvedAt: string | null;
      copiedAt: string | null;
      rejectedAt: string | null;
    };
  }
}
```
- **Side effects by transition:**
  - `draft → approved`: sets `action_drafts.approved_at = NOW()`
  - `approved → copied`: sets `action_drafts.copied_at = NOW()`. Also sets the parent `findings.status = 'actioned'` and `findings.actioned_at = NOW()`.
  - `draft | approved → rejected`: sets `action_drafts.rejected_at = NOW()`. Finding remains `active` — the user may re-trigger draft generation.
- **Errors:** `400` — invalid status transition (e.g., `copied → approved` is not permitted), `403` — not an org member, `404` — draft not found or belongs to different org

---

#### GET /api/cashflow/projection
- **Auth:** Requires session
- **Description:** Returns the current cash flow projection for the org. Serves the `/cashflow` screen. Reads from the most recent `cash_flow_projections` row for the org and requested period. Does not trigger a new projection calculation — projections are generated by the intelligence engine background job.
- **Query params:** `days=30` | `days=60` | `days=90` (default: `30`)
- **Response 200:**
```typescript
{
  data: {
    projection: {
      id: string;
      generatedAt: string;
      projectionPeriodDays: 30 | 60 | 90;
      confidenceLevel: 'low' | 'medium' | 'high';
      minimumProjectedBalance: string;    // DECIMAL as string
      riskDate: string | null;            // ISO date of minimum balance, if below threshold
      projectedData: Array<{
        date: string;                     // ISO date
        projectedBalance: string;         // DECIMAL as string
        inflows: string;
        outflows: string;
        inflowSources: Array<{ clientName: string; invoiceId: string; amount: string; confidence: 'low' | 'medium' | 'high' }>;
        outflowSources: Array<{ description: string; amount: string; type: string }>;
        riskFlags: string[];
      }>;
    };
  }
}
```
- **Errors:**
  - `401` — not authenticated
  - `403` — not an org member
  - `422` — insufficient data, with body: `{ error: { code: 'insufficient_data', message: 'Cash flow projection requires at least 60 days of transaction history.', details: { daysAvailable: number; daysRequired: 60 } } }` — the `daysAvailable` field drives the progress bar in the `/cashflow` empty state

---

### Data Export Endpoints

---

#### GET /api/data/export
- **Auth:** Requires session
- **Description:** Exports all user-generated data for the organization as a downloadable zip file. This is the "Download your data" button required by the P0 data sovereignty feature. The zip contains all AI-generated outputs produced by this product — it does NOT contain the raw transaction history (which lives in QuickBooks or Xero and is always available there directly).
- **Query params:** None
- **Rate limit:** Maximum one export per org per hour (returns `429` with `Retry-After` header if exceeded)
- **Response:** File download with headers:
  - `Content-Type: application/zip`
  - `Content-Disposition: attachment; filename=[org-slug]_data-export_[YYYY-MM-DD].zip`
- **Zip contents:**
  - `reports/` — all generated monthly reports as PDF and JSON
  - `conversations/` — full conversation history as `conversations.json` (same format as `GET /api/conversations/export`)
  - `findings/` — all intelligence findings (all statuses) as `findings.json`
  - `action_drafts/` — all generated email drafts as `drafts.json`
  - `README.txt` — describes what each file contains and where to find the underlying transaction data (in QuickBooks/Xero)
- **Errors:**
  - `401` not authenticated
  - `429` export requested less than 1 hour ago (`Retry-After` header set)
  - `503` export generation failed (retry after 30 seconds)

---

### Billing Endpoints

---

#### GET /api/billing/usage
- **Auth:** Requires session
- **Response 200:**
```typescript
{
  data: {
    queriesUsedThisPeriod: number;
    queriesLimit: number;
    queriesRemainingThisPeriod: number;
    periodStart: string;
    periodEnd: string;
    planTier: string;
    usageByDay: Array<{ date: string; count: number }>;  // Last 30 days
  }
}
```

---

#### POST /api/billing/checkout
- **Auth:** Requires session + role: `owner`
- **Request body:** `{ planTier: 'starter' | 'growth'; successUrl: string; cancelUrl: string }`
- **Response 200:** `{ data: { checkoutUrl: string } }`
- **Side effects:** Creates or retrieves Stripe customer, creates Stripe Checkout session

---

#### GET /api/billing/portal
- **Auth:** Requires session + role: `owner`
- **Response 200:** `{ data: { portalUrl: string } }`
- **Side effects:** Creates Stripe Customer Portal session

---

#### POST /api/webhooks/stripe
- **Auth:** Public (HTTPS + Stripe signature verification via `stripe.webhooks.constructEvent`)
- **Description:** Processes Stripe subscription lifecycle events
- **Handled events:**
  - `customer.subscription.created` → set plan_tier, queries_limit
  - `customer.subscription.updated` → update tier, limit
  - `customer.subscription.deleted` → revert to trial
  - `invoice.payment_failed` → set subscription status to `past_due`
- **Response 200:** `{ received: true }` (Stripe requires 200 to stop retrying)
- **Response 400:** Invalid signature — reject the request

---

## 4. Authentication Architecture

### Token Strategy

Supabase Auth issues a JWT (access token) on magic link verification. This JWT is:
- Stored in an **httpOnly, Secure, SameSite=Strict cookie** via `@supabase/ssr`
- Never accessible to JavaScript (prevents XSS token theft)
- Refreshed automatically by `@supabase/ssr` middleware on every request
- Short-lived access token: 1 hour; refresh token: 7 days

The Supabase JWT contains:
- `sub`: the user's UUID (used as `auth.uid()` inside PostgreSQL RLS)
- Custom claim `org_id`: set via a Supabase Auth hook that reads the user's default org (the one they created, or their most recent)

### How RLS Enforces Multi-Tenant Isolation

Every org-scoped table has Row Level Security enabled with a policy that calls `get_accessible_org_ids()`. This function uses `auth.uid()` from the JWT to resolve which orgs the user may access.

```sql
-- Applied to: transactions, accounts, conversations, messages,
-- alerts, reports, subscriptions, financial_snapshots, query_log

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org isolation — transactions" ON transactions
  USING (org_id IN (SELECT get_accessible_org_ids()))
  WITH CHECK (org_id IN (
    SELECT org_id FROM organization_members WHERE user_id = auth.uid()
  ));
```

The `USING` clause (read) allows both the user's own org AND client orgs via firm_clients. The `WITH CHECK` clause (write) is restricted to the user's own org only — a firm user can never write to a client's data.

If an application bug accidentally omits a `WHERE org_id = ?` clause, the database-level policy rejects the query. The isolation is enforced at the storage layer, not just the application layer.

### OAuth Token Encryption

QuickBooks and Xero OAuth tokens are never stored in plaintext. Before writing to `connections`:

```typescript
// lib/platform/security/encryption.ts
import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY = Buffer.from(env.OAUTH_ENCRYPTION_KEY, 'hex'); // 32-byte key

export function encryptToken(plaintext: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  // Format: iv:authTag:ciphertext (all hex)
  return [
    iv.toString('hex'),
    authTag.toString('hex'),
    encrypted.toString('hex'),
  ].join(':');
}

export function decryptToken(ciphertext: string): string {
  const [ivHex, authTagHex, encryptedHex] = ciphertext.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted) + decipher.final('utf8');
}
```

The `OAUTH_ENCRYPTION_KEY` environment variable is a 64-character hex string (32 bytes). It is never stored in the database. If the database is compromised, raw OAuth tokens are not exposed.

### Organization Context Per Request

Every authenticated API route handler calls `requireAuth()` which:

1. Reads the session from the Supabase cookie
2. Queries `organization_members` to get the user's org and role
3. Returns a typed `RequestContext` object:

```typescript
type RequestContext = {
  userId: string;
  orgId: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  planTier: string;
  queriesLimit: number;
  queriesUsed: number;
};
```

The `orgId` from this context is used in all database queries. It is never taken from the request body or URL params — callers cannot claim to own a different org.

---

## 5. Background Jobs

All background jobs are defined as Inngest functions and served from a single Next.js Route Handler at `/api/webhooks/inngest`.

### Job 1: Data Sync Fan-Out

```typescript
// jobs/sync/fan-out.ts
// Schedule: every 6 hours
// Runs: 4x per day
// Function: queries all active connections, fans out one sync event per connection

export const syncFanOut = inngest.createFunction(
  { id: 'sync-fan-out', retries: 1 },
  { cron: '0 */6 * * *' },
  async ({ step }) => {
    const activeConnections = await step.run('load-active-connections', async () =>
      db.select({ id: connections.id, orgId: connections.orgId, provider: connections.provider })
        .from(connections)
        .where(eq(connections.isActive, true))
    );

    await step.sendEvent('dispatch-sync-events',
      activeConnections.map(conn => ({
        name: 'sync/connection.requested',
        data: { connectionId: conn.id, orgId: conn.orgId, provider: conn.provider },
      }))
    );
  }
);
```

### Job 2: Single-Org Sync

```typescript
// jobs/sync/single-org.ts
// Trigger: 'sync/connection.requested' event
// Retries: 3 (Inngest handles backoff: 30s, 60s, 120s)
// Flow: decrypt tokens → call provider API → normalize → upsert → update snapshot → trigger intelligence run
// NOTE: Step order is critical — intelligence run must always fire AFTER snapshot recomputation.

export const syncSingleOrg = inngest.createFunction(
  { id: 'sync-single-org', retries: 3, concurrency: { limit: 5 } },
  { event: 'sync/connection.requested' },
  async ({ event, step }) => {
    const { connectionId, orgId, provider } = event.data;

    const syncJobId = await step.run('create-sync-job-record', () =>
      createSyncJobRecord(connectionId, orgId)
    );

    await step.run('pull-and-normalize', () =>
      pullTransactions(connectionId, provider, syncJobId)
    );

    await step.run('recompute-snapshots', () =>
      recomputeFinancialSnapshots(orgId)
    );

    // V2: dispatch intelligence engine, not alert evaluation
    // The intelligence engine (jobs/intelligence/run.ts) handles all anomaly detection,
    // cash flow projection, AR aging analysis, and duplicate subscription scanning.
    // jobs/alerts/evaluate.ts is a V1 remnant and must NOT be called here.
    await step.sendEvent('trigger-intelligence-run', {
      name: 'intelligence/run.requested',
      data: { orgId, runType: 'triggered' },
    });
  }
);
```

### Job 3: Alert Evaluation (V1 REMNANT — DO NOT IMPLEMENT)

> **⚠ V2 architecture change:** `jobs/alerts/evaluate.ts` was the V1 post-sync alert evaluation job. In V2, all anomaly detection, cash flow risk detection, AR aging analysis, and duplicate subscription scanning was consolidated into the intelligence engine (`jobs/intelligence/run.ts`, documented as Job 6 below). `jobs/alerts/evaluate.ts` exists as a stub in the folder structure for reference but must never be registered in the Inngest serve handler or dispatched. The `alerts/evaluate.requested` event is never sent anywhere in V2. See IMPLEMENTATION_PLAN Step 1.4 note on this file.

### Job 4: Monthly Report Generation

```typescript
// jobs/reports/monthly.ts
// Schedule: 1st of each month at 06:00 UTC
// Creates monthly summary reports for all active orgs

export const generateMonthlyReports = inngest.createFunction(
  { id: 'generate-monthly-reports', retries: 1 },
  { cron: '0 6 1 * *' },
  async ({ step }) => {
    const orgs = await step.run('load-active-orgs', loadActiveOrgsForReporting);

    await step.sendEvent('dispatch-report-events',
      orgs.map(org => ({
        name: 'reports/monthly.requested',
        data: { orgId: org.id, adminEmail: org.adminEmail, timezone: org.timezone },
      }))
    );
  }
);

export const generateSingleReport = inngest.createFunction(
  { id: 'generate-single-report', retries: 2 },
  { event: 'reports/monthly.requested' },
  async ({ event, step }) => {
    // Processing steps:
    // 1. Generate AI narrative (non-streaming, full completion)
    // 2. Store in reports.plain_text_summary + reports.content (JSONB)
    // 3. Set reports.status = 'ready'
    // 4. Send email via Resend to org admin
    //    REQUIRED: The email body must include the standard financial disclaimer as a footer.
    //    The plain_text_summary stored in the DB includes the disclaimer; the email must
    //    reproduce it. Do not strip the disclaimer when composing the email body.
    //    Disclaimer text: "This report was generated by AI from your accounting data as of
    //    [sync date]. It is not financial advice."
  }
);
```

---

### Job 5: Monthly Quota Reset

```typescript
// jobs/billing/reset-quotas.ts
// Schedule: 1st of each month at 00:00 UTC (runs BEFORE report generation at 06:00 UTC)
// Resets queries_used_this_period to 0 for all active subscriptions.
// The quota reset cycle (calendar month) is decoupled from the Stripe billing cycle
// (subscription anniversary). See subscriptions table notes in Section 2.

export const resetMonthlyQuotas = inngest.createFunction(
  { id: 'reset-monthly-quotas', retries: 2 },
  { cron: '0 0 1 * *' },
  async ({ step }) => {
    await step.run('reset-all-quotas', async () => {
      await db
        .update(subscriptions)
        .set({ queriesUsedThisPeriod: 0, updatedAt: new Date() })
        .where(inArray(subscriptions.status, ['active', 'trialing', 'past_due']));
    });
  }
);
```

> **Alert email disclaimer (Issue 15 resolution):** Alert notification emails contain specific financial figures (cash position amounts, expense totals) but are generated by the product's alert detection system, not by the AI. After legal review, alert emails are classified as **system notifications about observed data**, not AI-generated financial analysis. As such, they do not require the full AI disclaimer. However, each alert email must include a brief footer: "This alert was generated automatically from your accounting data. It is not financial advice." This is a lighter-weight notice than the full AI disclaimer. If the legal review (PRD Section 9) determines a different standard applies, this footer must be updated accordingly.

---

### Job 6: Proactive Intelligence Engine

```typescript
// jobs/intelligence/run.ts
// Schedule: daily at 06:00 UTC (MVP uniform schedule).
//   Production target: 02:00 AM in the org's configured timezone — requires
//   per-org cron scheduling which Inngest supports via event-driven fan-out.
// Depends on: sync job having completed successfully for the org within the
//   prior 6 hours. If the most recent sync_job for the org has status ≠
//   'completed', the intelligence run is skipped with reason 'sync_failed'.
// Per-org fan-out: same pattern as the sync fan-out (Job 1). A single
//   cron trigger dispatches one 'intelligence/run.requested' event per active org.

export const intelligenceFanOut = inngest.createFunction(
  { id: 'intelligence-fan-out', retries: 1 },
  { cron: '0 6 * * *' },
  async ({ step }) => {
    const activeOrgs = await step.run('load-active-orgs', async () =>
      db.select({ orgId: connections.orgId })
        .from(connections)
        .where(and(eq(connections.isActive, true), isNotNull(connections.lastSyncedAt)))
    );

    await step.sendEvent('dispatch-intelligence-runs',
      activeOrgs.map(({ orgId }) => ({
        name: 'intelligence/run.requested',
        data: { orgId, runType: 'scheduled' },
      }))
    );
  }
);

export const runIntelligenceForOrg = inngest.createFunction(
  { id: 'run-intelligence-for-org', retries: 2, concurrency: { limit: 5 } },
  { event: 'intelligence/run.requested' },
  async ({ event, step }) => {
    const { orgId, runType } = event.data;

    // 1. Create intelligence_run record
    const runId = await step.run('create-run-record', () =>
      createIntelligenceRun(orgId, runType)
    );

    // 2. Guard: skip if insufficient transaction history
    const dataCheck = await step.run('check-data-sufficiency', () =>
      checkTransactionHistory(orgId)
    );
    if (dataCheck.daysCovered < 60 && dataCheck.daysCovered >= 0) {
      await step.run('mark-skipped', () =>
        markIntelligenceRunSkipped(runId, 'insufficient_history')
      );
      return;
    }

    // 3. Guard: skip if the most recent sync failed
    const syncCheck = await step.run('check-sync-status', () =>
      getMostRecentSyncStatus(orgId)
    );
    if (syncCheck.status !== 'completed') {
      await step.run('mark-skipped', () =>
        markIntelligenceRunSkipped(runId, 'sync_failed')
      );
      return;
    }

    // 4. Run all intelligence analyses in parallel
    const [cashFlowResult, anomalyResult, arResult, duplicateResult] =
      await step.run('run-analyses', () =>
        Promise.all([
          runCashFlowProjection(orgId, runId),          // generates cash_flow_projections rows
          runAnomalyDetection(orgId, runId),             // checks 4 anomaly types from PRD F0
          runARAgingAnalysis(orgId, runId),              // identifies collections opportunities
          runDuplicateSubscriptionScan(orgId, runId),    // checks for billing duplicates
        ])
      );

    // 5. Write findings to the findings table
    const allFindings = [
      ...cashFlowResult.findings,
      ...anomalyResult.findings,
      ...arResult.findings,
      ...duplicateResult.findings,
    ];
    await step.run('write-findings', () =>
      writeFindings(orgId, runId, allFindings)
    );

    // 6. Update intelligence_run record: completed, findings count
    await step.run('complete-run', () =>
      completeIntelligenceRun(runId, allFindings.length)
    );

    // 7. Update connections.last_intelligence_run_at
    await step.run('update-connection-timestamp', () =>
      updateLastIntelligenceRunAt(orgId)
    );

    // 8. Apply severity-gated email delivery rule (from PRD Intelligence Brief feature):
    //    - CRITICAL finding present → send email immediately
    //    - HIGH finding present (no critical) → send email within 2 hours
    //    - Only MEDIUM/LOW → no email; in-app notification only
    //    - No findings → no contact of any kind
    const highestSeverity = getHighestSeverity(allFindings);
    if (highestSeverity === 'critical' || highestSeverity === 'high') {
      await step.sendEvent('trigger-intelligence-email', {
        name: 'intelligence/email.requested',
        data: { orgId, runId, highestSeverity, delaySeconds: highestSeverity === 'high' ? 7200 : 0 },
      });
    }
    // For medium/low/no findings: no email event dispatched. Silence is the signal.
  }
);
```

**Intelligence engine analysis modules** (implemented in `src/lib/financial/intelligence/`):

| Module | File | What it does |
|---|---|---|
| Cash flow projection | `cash-flow.ts` | Runs the 30/60/90-day forward projection; writes to `cash_flow_projections`; returns a `cash_flow_risk` finding if the minimum projected balance is below the configured buffer threshold |
| Anomaly detection | `anomaly.ts` | Evaluates the 4 anomaly types from PRD Feature: Anomaly Alert Engine (expense spike, collections slippage, margin deterioration, duplicate billing). Uses the alert_configs thresholds per org. |
| AR aging analysis | `ar-aging.ts` | Identifies invoices that have breached their net terms by more than 10 days and are candidates for the invoice acceleration agentic draft. Writes `collections_opportunity` findings. |
| Duplicate subscription scan | `duplicates.ts` | Scans recurring charges for the same vendor appearing on two different expense accounts within a 25–35 day window. Writes `duplicate_subscription` findings. |

**Email delivery job** (triggered by the intelligence fan-out when high/critical findings exist):

**Email specification (all fields required — do not simplify):**

```
Subject line format:
  Critical findings present:  "[Product Name] — urgent: [headline of highest-severity finding]"
  Multiple critical findings:  "[Product Name] — urgent: [headline of most urgent finding] (+ N more findings)"
  High only (no critical):    "[Product Name] — action recommended: [headline of highest finding]"

Email body (in order):
  1. Each triggering finding as a section:
       - Finding headline (bold)
       - Severity label
       - Plain-English detail with dollar amounts
  2. Two action links per finding:
       - "View full brief →" links to the in-app finding detail at /dashboard?finding_id=[id]
       - "Ask the AI about this →" links to /ask?finding_id=[id] (pre-loads the finding as context)
  3. Footer (always present):
       "You're receiving this because a high or critical finding was detected in your QuickBooks
        data. This is AI-generated financial analysis. Not financial advice."

No-resend rule:
  Before dispatching an email, check whether this EXACT finding (same finding.id) was included
  in the previous intelligence run's email for this org. If so, only re-include it if:
    (a) Its severity has changed since the previous email, OR
    (b) The underlying projection has materially changed (>10% change in dollar amounts).
  A finding that was already emailed and is unchanged must NOT appear in the next email.
  This prevents users from being trained to ignore repeated identical alerts.
```

```typescript
// jobs/intelligence/email.ts
// Triggered by: 'intelligence/email.requested' event
export const sendIntelligenceEmail = inngest.createFunction(
  { id: 'send-intelligence-email', retries: 3 },
  { event: 'intelligence/email.requested' },
  async ({ event, step }) => {
    // delay is 0 for critical, 7200 seconds (2 hours) for high
    if (event.data.delaySeconds > 0) {
      await step.sleep('wait-before-sending', event.data.delaySeconds);
    }
    await step.run('apply-no-resend-filter', () =>
      // Remove findings that were already emailed in the previous cycle unchanged
      filterAlreadyEmailedFindings(event.data.orgId, event.data.runId)
    );
    await step.run('send-email', () =>
      sendIntelligenceBriefEmail(event.data.orgId, event.data.runId)
      // sendIntelligenceBriefEmail MUST:
      // 1. Build subject line from the format spec above
      // 2. Include "View full brief →" and "Ask the AI about this →" links per finding
      // 3. Include the standard footer
    );
  }
);
```

---

## 6. Error Handling Standard

### Universal Error Response Type

```typescript
// types/api.ts

export type ApiError = {
  error: {
    code: string;           // Machine-readable snake_case code
    message: string;        // Human-readable description (safe to display)
    details?: unknown;      // Validation field errors or extra context
    request_id: string;     // For support correlation (UUID generated per request)
  };
};

export type ApiSuccess<T> = {
  data: T;
  meta?: {
    page?: number;
    pageSize?: number;
    total?: number;
    totalPages?: number;
  };
};
```

### HTTP Status Codes and When They Are Used

| Code | Used when | `error.code` examples |
|---|---|---|
| `400` | Request body fails Zod schema validation | `validation_error` |
| `401` | No valid session cookie | `not_authenticated` |
| `403` | Authenticated but wrong org, wrong role | `insufficient_role`, `wrong_org` |
| `404` | Resource not found, or exists but not visible to this user | `not_found` |
| `409` | Conflict: duplicate resource, sync already running | `already_exists`, `sync_in_progress` |
| `413` | CSV file too large | `file_too_large` |
| `422` | Business logic failure: quota exceeded, data not ready | `quota_exhausted`, `sync_not_complete`, `report_generating` |
| `429` | Rate limit hit: Upstash sliding window | `rate_limit_exceeded` |
| `500` | Unhandled exception | `internal_error` |
| `503` | External API unavailable (QuickBooks, Stripe) | `upstream_unavailable` |

### Request ID Middleware

Every request gets a UUID request ID injected into the `X-Request-ID` response header and into any error response:

```typescript
// lib/platform/middleware/require-auth.ts
const requestId = crypto.randomUUID();
headers.set('X-Request-ID', requestId);
```

This request ID is logged with every server-side error and included in error responses, allowing support to correlate frontend error reports with server logs.

---

## 7. Environment Variables

| Variable | Required | Description | Example (not real values) |
|---|---|---|---|
| `DATABASE_URL` | ✅ | Supabase Postgres connection string (pooler, port 6543) | `postgresql://postgres.xxx:pass@aws-0-us-east-1.pooler.supabase.com:6543/postgres` |
| `DATABASE_URL_DIRECT` | ✅ | Direct connection (port 5432) — for drizzle-kit migrations only | `postgresql://postgres.xxx:pass@db.xxx.supabase.co:5432/postgres` |
| `SUPABASE_URL` | ✅ | Supabase project URL | `https://abcdefghij.supabase.co` |
| `SUPABASE_ANON_KEY` | ✅ | Supabase anon public key (safe for client-side) | `eyJhbGciOiJIUzI1NiIs...` |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Supabase service role key (server-side only, bypasses RLS) | `eyJhbGciOiJIUzI1NiIs...` |
| `OAUTH_ENCRYPTION_KEY` | ✅ | 64-char hex string (32 bytes) for AES-256-GCM token encryption | `a3f8c2...` (generate with `openssl rand -hex 32`) |
| `QB_CLIENT_ID` | ✅ | QuickBooks OAuth 2.0 client ID | `ABCdefGHIjkl...` |
| `QB_CLIENT_SECRET` | ✅ | QuickBooks OAuth 2.0 client secret | `xyz789...` |
| `QB_ENVIRONMENT` | ✅ | QuickBooks environment | `production` or `sandbox` |
| `XERO_CLIENT_ID` | ✅ | Xero OAuth 2.0 client ID | `ABCDEF1234...` |
| `XERO_CLIENT_SECRET` | ✅ | Xero OAuth 2.0 client secret | `xyz789...` |
| `PLAID_CLIENT_ID` | P2 | Plaid client ID | `60d7f3...` |
| `PLAID_SECRET` | P2 | Plaid API secret | `9a8f7b...` |
| `PLAID_ENVIRONMENT` | P2 | Plaid environment | `production` or `sandbox` |
| `ANTHROPIC_API_KEY` | Production | Anthropic Claude API key | `sk-ant-api03-...` |
| `GOOGLE_AI_API_KEY` | Trial | Google Gemini API key (free tier) | `AIzaSy...` |
| `AI_PROVIDER` | ✅ | Which AI provider to use | `anthropic` or `google` |
| `INNGEST_SIGNING_KEY` | ✅ | Inngest signing key for webhook verification | `signkey-prod-...` |
| `INNGEST_EVENT_KEY` | ✅ | Inngest event API key | `...` |
| `STRIPE_SECRET_KEY` | Production | Stripe secret key | `sk_live_...` or `sk_test_...` |
| `STRIPE_WEBHOOK_SECRET` | Production | Stripe webhook signing secret | `whsec_...` |
| `STRIPE_STARTER_PRICE_ID` | Production | Stripe Price ID for Starter plan | `price_...` |
| `STRIPE_GROWTH_PRICE_ID` | Production | Stripe Price ID for Growth plan | `price_...` |
| `UPSTASH_REDIS_REST_URL` | ✅ | Upstash Redis REST endpoint | `https://charming-hen-...upstash.io` |
| `UPSTASH_REDIS_REST_TOKEN` | ✅ | Upstash Redis auth token | `AXxx...` |
| `RESEND_API_KEY` | ✅ | Resend transactional email API key | `re_...` |
| `FROM_EMAIL` | ✅ | Sender address for emails | `reports@yourapp.com` |
| `APP_URL` | ✅ | Full public URL of the app (for OAuth callbacks) | `https://app.example.com` |
| `NODE_ENV` | ✅ | Runtime environment | `production`, `development`, `test` |

All variables validated at build time using `@t3-oss/env-nextjs` — a missing or malformed variable fails the build, not the runtime.

---

## 8. Third-Party Integrations

### Supabase

**Purpose:** PostgreSQL database, user authentication, Row Level Security  
**SDK:** `@supabase/supabase-js` v2.48, `@supabase/ssr` v0.5  
**Methods used:**
- `supabase.auth.signInWithOtp({ email })` — sends magic link
- `supabase.auth.exchangeCodeForSession(code)` — validates magic link token
- `supabase.auth.getSession()` — reads session server-side via `@supabase/ssr`
- Drizzle ORM for all data operations (Supabase client used only for auth)

**Failure behavior:** If Supabase auth is unreachable, all authenticated requests return 503. RLS failures return 403 (not 500) — this is intentional and expected.

---

### QuickBooks Online

**Purpose:** Primary accounting data source — Chart of Accounts, transactions, account balances  
**SDK:** `intuit-oauth` v4.0.4 (OAuth), `node-quickbooks` v2.0.5 (API)  
**Redirect URI:** Must be registered in the Intuit Developer Console as `${APP_URL}/api/auth/quickbooks/callback` — the `/api/` prefix is required because this is a Next.js Route Handler. Using `/auth/quickbooks/callback` (without `/api/`) will cause a `redirect_uri_mismatch` error on every OAuth attempt.  
**Methods used:**
- `oauthClient.authorizeUri(...)` — generate PKCE authorization URL
- `oauthClient.createToken(callbackUrl)` — exchange code for tokens
- `oauthClient.refresh()` — refresh expired access token
- `qbo.queryTransactions(query, callback)` — paginated transaction query
- `qbo.getChartOfAccounts(...)` — chart of accounts
- `qbo.queryInvoices(...)` — accounts receivable

**Rate limiting:** 500 calls/minute per realm. Handled via Inngest retry with exponential backoff (30s, 60s, 120s). On HTTP 429, the current sync is paused and retried. No partial writes.

**Failure behavior:** If QuickBooks API is unreachable for >3 retries, the sync_job is marked failed, `connections.sync_status = 'failed'`, and a user-facing amber banner is shown. Existing data remains intact and queryable.

---

### Xero

**Purpose:** Secondary accounting data source (P1 feature)  
**SDK:** `xero-node` v9.3  
**Redirect URI:** Must be registered in the Xero Developer portal as `${APP_URL}/api/auth/xero/callback` — same `/api/` prefix requirement as QuickBooks.  
**Methods used:**
- `xero.buildConsentUrl()` — OAuth 2.0 authorization URL
- `xero.apiCallback(callbackUrl)` — token exchange
- `xero.refreshToken()` — refresh (60-day inactivity expiry)
- `xero.accountingApi.getAccounts(tenantId)` — chart of accounts
- `xero.accountingApi.getJournals(tenantId, null, offset)` — transaction journals

**Key difference from QB:** Xero requires a mandatory `Xero-Tenant-Id` header on every API call. The tenant ID is resolved during OAuth and stored in `connections.realm_id`.

**Failure behavior:** Same as QuickBooks.

---

### Anthropic (Claude)

**Purpose:** Production AI for financial Q&A and report generation  
**SDK:** `@ai-sdk/anthropic` v1.1 (via Vercel AI SDK), `@anthropic-ai/sdk` v0.32  
**Models used:**
- `claude-haiku-4-5` — fast financial Q&A (simple questions, < 0.4 complexity score)
- `claude-sonnet-4-6` — complex financial analysis, report generation (>= 0.4 complexity)

**Methods used:**
- `streamText({ model, system, messages })` — streaming Q&A via Vercel AI SDK
- `anthropic.messages.create({ stream: false })` — batch report generation
- `anthropic.beta.promptCaching.messages.create()` — report generation with cache_control on system context (reduces cost ~90% for repeated org context)

**Failure behavior:** AI API errors do not count against the user's monthly query quota. Error logged to `query_log` with `success=false`, user sees retry prompt in the chat thread.

---

### Google Gemini

**Purpose:** Trial deployment — $0 AI for pre-revenue validation  
**SDK:** `@ai-sdk/google` v1.1  
**Model:** `gemini-2.0-flash` (free tier, 1,500 requests/day)  
**Usage:** Set `AI_PROVIDER=google` to route all AI calls to Gemini instead of Claude. Zero code changes beyond the environment variable.

**Free tier limits:** 1,500 requests/day, 15 RPM. Sufficient for 50–100 trial organizations during validation phase.

---

### Inngest

**Purpose:** Background job queue — data sync, alert evaluation, report generation  
**SDK:** `inngest` v3.27  
**Methods used:**
- `inngest.createFunction({ id, retries }, { cron | event }, handler)` — define a job
- `step.run(name, fn)` — durable step within a function (checkpointed)
- `step.sendEvent(name, events)` — fan-out to child jobs
- `inngest.send(event)` — trigger a job from an API route (e.g., after OAuth connect)

**Failure behavior:** Inngest automatically retries failed functions up to the configured `retries` count with exponential backoff. Failed final attempts are stored in Inngest's dead-letter queue, visible in the Inngest dashboard. No user-facing impact beyond stale data.

---

### Stripe

**Purpose:** Subscription billing, payment processing, customer portal  
**SDK:** `stripe` v16.12 (server), `@stripe/stripe-js` v4.5 (client)  
**Methods used:**
- `stripe.customers.create(...)` — create Stripe customer on first upgrade
- `stripe.checkout.sessions.create(...)` — Stripe Checkout for new subscriptions
- `stripe.billingPortal.sessions.create(...)` — Customer Portal for self-service
- `stripe.webhooks.constructEvent(body, signature, secret)` — verify webhook authenticity

**Failure behavior:** If Stripe is unavailable, checkout/portal endpoints return 503. Stripe webhooks that fail to process are retried by Stripe for up to 72 hours. The subscription table is not updated until a webhook is successfully received — no optimistic updates.

---

### Upstash Redis

**Purpose:** AI response caching, per-organization rate limiting  
**SDK:** `@upstash/redis` v1.34, `@upstash/ratelimit` v2.0  
**Methods used:**
- `redis.get(key)` / `redis.set(key, value, { ex: ttl })` — response cache
- `ratelimit.limit(orgId)` — sliding window rate limit check before every `/api/conversations/:id/messages` call

**Cache invalidation strategy:** Cache key = `{orgId}:{sha256(question)}:{lastSyncedAtTimestamp}`. The sync timestamp in the key means cached responses auto-expire when new data arrives — no explicit invalidation needed.

**Failure behavior:** Redis unavailability is a non-fatal degradation. The rate-limiter falls back to allowing the request (fail open). The cache falls back to live AI calls. Log the Redis error but do not surface it to the user.

---

### Resend

**Purpose:** Transactional email — magic links, alert notifications, monthly reports  
**SDK:** `resend` v4.0  
**Email types sent:**
- Magic sign-in link (via Supabase Auth — Resend configured as the SMTP provider in Supabase)
- Intelligence brief email: triggered by `jobs/intelligence/email.ts` when a high or critical finding is generated
- Monthly summary report email: triggered by `jobs/reports/monthly.ts`

**Failure behavior:** Email delivery failures are logged but do not fail the triggering operation. A user who doesn't receive an alert email will still see it in-app. Report email failure triggers the retry mechanism described in the PRD (retry after 15 minutes; if retry fails, send a "generate manually" email).

---

*End of BACKEND_STRUCTURE.md v0.1.*
