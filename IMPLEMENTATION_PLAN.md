# Implementation Plan
## AI CFO Agent — V2 (Updated Hypothesis)

**Version:** 0.2 — Replaces V1 entirely  
**Date:** July 2026  
**Total steps:** 136  

---

### How to use this document

- Each step is scoped to one focused session of 30–90 minutes.
- Every step ends with a testable definition of done. If you cannot test it, the step is not done.
- Steps are numbered by phase (1.0, 1.1 …). A step only begins when its dependency is met.
- Status: `[ ]` not started · `[~]` in progress · `[x]` done.

> **Phase 2 / Phase 3 interleaving:** Complete Steps 2.0–2.2, then all of Phase 3, then return to Steps 2.3–2.6. Steps 2.3–2.6 depend on the `organizations` table from Step 3.1.

> **Three non-negotiable Phase 6 constraints — enforced in every intelligence engine step:**
> 1. **Inngest step boundaries:** Each analysis type is its own `step.run()`. Never combine them. Vercel Hobby has a 10-second function timeout per invocation.
> 2. **AI provider routing:** Every AI call uses `getModel()` from `src/lib/ai/models/router.ts` which reads `AI_PROVIDER` from environment variables. Never write `anthropic(...)` or `google(...)` directly in intelligence engine files.
> 3. **Graceful rate-limit skip:** Every `step.run()` that calls the AI API wraps the call in `try/catch`. On HTTP 429: set `intelligence_runs.status='skipped'`, `skipped_reason='rate_limit'`, `return` cleanly. Never rethrow. Never retry with a different provider.

---

## Phase 1: Foundation

End state: project runs locally, DB connects, linting passes, CI runs on push.

---

### Step 1.0 — Next.js project scaffold
- **Depends on:** nothing
- **Build:** Run `pnpm create next-app@15 ai-cfo-agent --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"`. Set `.nvmrc` to Node.js 22. Set `"packageManager": "pnpm@9.15.x"` in `package.json`. Delete default boilerplate.
- **Definition of done:** `pnpm dev` starts, `http://localhost:3000` renders without console errors.
- **Status:** [ ]

---

### Step 1.1 — TypeScript strict configuration
- **Depends on:** 1.0
- **Build:** Set `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true` in `tsconfig.json`. Add path aliases: `@/types/*`, `@/lib/*`, `@/components/*`.
- **Definition of done:** `pnpm tsc --noEmit` exits 0. Importing a non-existent module via `@/lib/nonexistent` produces a type error.
- **Status:** [ ]

---

### Step 1.2 — Linting, formatting, and git hooks
- **Depends on:** 1.0
- **Build:** Install `eslint@9.6`, `@typescript-eslint/parser`, `eslint-plugin-react-hooks`, `prettier@3.4`, `husky@9.1`, `lint-staged@15`. Configure Prettier, ESLint flat config, `lint-staged`. Run `pnpm husky init`. Add pre-commit hook running lint-staged on `.ts`/`.tsx`. Add a custom ESLint rule forbidding direct `process.env` access.
- **Definition of done:** `pnpm lint` exits 0. Staging a `.ts` file with a lint error and running `git commit` aborts with the error visible.
- **Status:** [ ]

---

### Step 1.3 — Environment variables with build-time validation
- **Depends on:** 1.0
- **Build:** Install `@t3-oss/env-nextjs@0.11`, `zod@3.24`. Create `src/lib/env.ts`. Day-one required: `DATABASE_URL`, `DATABASE_URL_DIRECT`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OAUTH_ENCRYPTION_KEY`, `APP_URL`, `NODE_ENV`. All others (QB, Xero, AI, Inngest, Stripe, Upstash, Resend) start as `.optional()`. Add `.env.example` with all variable names. Add `.env.local` to `.gitignore`.
- **Definition of done:** `pnpm build` fails if `DATABASE_URL` is missing. With all day-one vars present, build completes.
- **Status:** [ ]

---

### Step 1.4 — Complete folder structure
- **Depends on:** 1.0
- **Build:** Create every directory from BACKEND_STRUCTURE.md including `jobs/intelligence/` and `src/lib/financial/intelligence/`. Create stubs for all job files including `jobs/intelligence/run.ts` and `jobs/intelligence/email.ts`. Create `scripts/` at project root. Create `SETUP.md` documenting the manual RLS migration step. Create `jobs/alerts/evaluate.ts` as a stub with the comment: `// V1 REMNANT — DO NOT IMPLEMENT. Alert/anomaly detection was absorbed into jobs/intelligence/run.ts in V2. This file must never be registered in the Inngest serve handler.` — this prevents future confusion while preserving the explanation.
- **Definition of done:** `pnpm tsc --noEmit` exits 0 with all stubs. `jobs/intelligence/run.ts` and `jobs/intelligence/email.ts` exist. `SETUP.md` mentions RLS manual migration. `jobs/alerts/evaluate.ts` exists with the V1 remnant comment.
- **Status:** [ ]

---

### Step 1.5 — Supabase project and connection test
- **Depends on:** 1.3
- **Build:** Create a Supabase free-tier project. Copy URL and anon key to `.env.local`. Install `@supabase/supabase-js@2.48`, `@supabase/ssr@0.5`. Create `src/lib/platform/auth/supabase.ts` with `createServerClient`, `createClientClient`, `createAdminClient`. Create `scripts/test-connection.ts` running `SELECT version()`.
- **Definition of done:** `pnpm tsx scripts/test-connection.ts` prints a PostgreSQL version string without errors.
- **Status:** [ ]

---

### Step 1.6 — GitHub Actions CI pipeline
- **Depends on:** 1.2, 1.3
- **Build:** Create `.github/workflows/ci.yml` with four parallel jobs: `typecheck`, `lint`, `test` (`pnpm vitest run`), `build`. Install `vitest@2.1`, `@testing-library/react@16.3`. Add a trivial passing test.
- **Definition of done:** Push to GitHub. All four CI jobs pass. A TypeScript error causes `typecheck` to fail.
- **Status:** [ ]

---

### Step 1.7 — Inngest dev server
- **Depends on:** 1.4
- **Build:** Install `inngest@3.27`. Create `src/lib/inngest.ts`. Create `src/app/api/webhooks/inngest/route.ts`. Add `inngest:dev` script. Register stub `jobs/sync/fan-out.ts`.
- **Definition of done:** `pnpm dev` + `pnpm inngest:dev`. `http://localhost:8288` shows the Inngest dev UI with the stub function listed.
- **Status:** [ ]

---

## Phase 2: Authentication & Multi-tenancy

> **Interleaving:** Complete Steps 2.0–2.2 first, then Phase 3, then Steps 2.3–2.6.

---

### Step 2.0 — Supabase Auth magic link + Resend SMTP setup
- **Depends on:** 1.5
- **Build:** Create free Resend account. Add `RESEND_API_KEY` and `FROM_EMAIL` to `.env.local`. Configure Supabase SMTP to use Resend (`smtp.resend.com`, port 465). Set Site URL and redirect URL allowlist. Create `src/app/(auth)/login/page.tsx` and `/register/page.tsx`. Both use `signInWithOtp` with `emailRedirectTo: origin + '/api/auth/callback'`. If `?source=bench`, registration shows data sovereignty copy.
- **Definition of done:** Register with a real email. Receive the magic link from the `FROM_EMAIL` address (verify in Resend dashboard). Clicking the link redirects to `/api/auth/callback?token_hash=...`.
- **Status:** [ ]

---

### Step 2.1 — Auth callback route
- **Depends on:** 2.0
- **Build:** Create `src/app/api/auth/callback/route.ts`. Routing: new user + `?source=bench` → `/onboarding/migration?source=bench`; new user → `/onboarding/migration`; returning + org + connection → `/dashboard`; returning + org, no connection → `/onboarding/connect`; expired token → `/login?error=link_expired`. Create `/check-email/page.tsx`.
- **Definition of done:** Valid magic link routes to `/onboarding/migration` for a new user. Expired link routes to `/login` with `error=link_expired`.
- **Status:** [ ]

---

### Step 2.2 — Next.js middleware for route protection
- **Depends on:** 2.1
- **Build:** Implement `src/middleware.ts` using `@supabase/ssr`. Authenticated routes `/(dashboard)/*` require session. Redirect to `/login?next=[path]` if absent. Authenticated users visiting `/login`/`/register` redirect to `/dashboard`.
- **Definition of done:** Visiting `/dashboard` without a session redirects to `/login?next=/dashboard`. Visiting `/login` with a session redirects to `/dashboard`.
- **Status:** [ ]

---

### Step 2.3 — Organization creation endpoint
- **Depends on:** 2.1, 3.1
- **Build:** Create `src/app/api/organizations/route.ts` (`POST`). Validate with Zod. In one Drizzle transaction: insert `organizations`, `organization_members` (role: owner), `consent_log`, `subscriptions` (trial, `queries_limit=20`).
- **Definition of done:** Valid session → 201 with org object. No session → 401. Second attempt → 409.
- **Status:** [ ]

---

### Step 2.4 — Session context utility
- **Depends on:** 2.1, 2.3
- **Build:** Create `src/lib/platform/auth/session.ts` with `getRequestContext(request)` returning typed `RequestContext { userId, orgId, role, planTier, queriesUsed, queriesLimit }`. Create `require-auth.ts` and `require-role.ts` middleware.
- **Definition of done:** Unit test mocks a session and asserts `getRequestContext()` returns the correct org and role. `pnpm vitest run` passes.
- **Status:** [ ]

---

### Step 2.5 — Onboarding org creation page
- **Depends on:** 2.3, 2.4
- **Build:** Create `src/app/(dashboard)/onboarding/org/page.tsx`. Fields: business name, industry (15-option select), revenue band. Consent checkbox (required, not pre-checked): "This product reads my QuickBooks or Xero data. It never modifies my books. It provides AI-generated analysis, not financial advice."
- **Definition of done:** Full flow: register → magic link → `/onboarding/org` → fill form + consent → submit → redirect to `/onboarding/connect`. `organizations` row exists in Supabase Table Editor.
- **Status:** [ ]

---

### Step 2.6 — GET /api/auth/me + PATCH /api/auth/me + POST /api/auth/logout
- **Depends on:** 2.4
- **Build:** Implement all three endpoints. `PATCH /api/auth/me` accepts `{ displayName?, timezone? }`. `DELETE /api/auth/me` requires matching `confirmationEmail`.
- **Definition of done:** `GET /api/auth/me` returns org data with session; 401 without. Logout clears session. `PATCH` updates display name verifiable via subsequent `GET`.
- **Status:** [ ]

---

## Phase 3: Database Schema

End state: all 21 tables deployed, RLS active, seed data queryable.

---

### Step 3.0 — Drizzle ORM setup
- **Depends on:** 1.5
- **Build:** Install `drizzle-orm@0.36`, `drizzle-kit@0.27`, `postgres@3.x`. Create `src/lib/platform/db/client.ts`. Create `drizzle.config.ts`. Add `db:generate`, `db:migrate`, `db:studio` scripts.
- **Definition of done:** `pnpm drizzle-kit studio` connects. `pnpm db:generate` runs without error.
- **Status:** [ ]

---

### Step 3.1 — Identity and access schema
- **Depends on:** 3.0
- **Build:** Define `organizations` and `organization_members` with all columns and indexes. Run `pnpm db:generate` and `pnpm db:migrate`.
- **Definition of done:** Both tables appear in Supabase Table Editor with correct columns and indexes.
- **Status:** [ ]

---

### Step 3.2 — Connections and sync schema
- **Depends on:** 3.1
- **Build:** Add `connections` (including `last_intelligence_run_at` column), `sync_jobs`, `data_quality_log`. Apply partial unique index `idx_connections_one_accounting_per_org` enforcing QB/Xero mutual exclusivity. Run generate and migrate.
- **Definition of done:** Migration applies. Inserting two active accounting connections for the same org via SQL returns a unique constraint violation.
- **Status:** [ ]

---

### Step 3.3 — Financial data schema (DECIMAL enforced)
- **Depends on:** 3.2
- **Build:** Add `accounts` and `transactions`. **All monetary columns use `decimal('col', { precision: 15, scale: 2 })` — never `real()` or `doublePrecision()`.** Apply all six transaction indexes. Run generate and migrate.
- **Definition of done:** `transactions.amount` shows type `numeric` (not `float4`) in Supabase. All six indexes appear.
- **Status:** [ ]

---

### Step 3.4 — Financial snapshots schema
- **Depends on:** 3.3
- **Build:** Add `financial_snapshots`. Monetary columns use `decimal`. JSONB columns use `jsonb()`. Run generate and migrate.
- **Definition of done:** Can insert a row with `expense_by_category='{"payroll":12000.00}'` via Drizzle Studio.
- **Status:** [ ]

---

### Step 3.5 — AI and conversation schema
- **Depends on:** 3.4
- **Build:** Add `conversations`, `messages`, `query_log`. `messages.content` is `text` (unlimited). Run generate and migrate.
- **Definition of done:** Migration applies. `messages(conversation_id, created_at ASC)` index appears.
- **Status:** [ ]

---

### Step 3.6 — Feature schema (alerts, billing, reports)
- **Depends on:** 3.5
- **Build:** Add `alerts`, `alert_configs`, `reports`, `subscriptions`. `UNIQUE(org_id)` on subscriptions. `UNIQUE(org_id, alert_type)` on alert_configs. Run generate and migrate.
- **Definition of done:** Both unique constraints visible in Supabase Table Editor.
- **Status:** [ ]

---

### Step 3.7 — Intelligence engine schema (V2 new tables)
- **Depends on:** 3.6
- **Build:** Add `intelligence_runs`, `findings`, `action_drafts`, `cash_flow_projections`. `findings.headline` enforces max 120 chars via check constraint. `findings.related_data` and `cash_flow_projections.projected_data` use `jsonb`. All monetary columns in `cash_flow_projections` use `decimal`. Apply all indexes from BACKEND_STRUCTURE.md including the findings expiry index. Run generate and migrate.
- **Definition of done:** All four tables appear. Inserting a `findings` row with headline > 120 chars returns a check constraint error. The `idx_findings_expiry` index appears.
- **Status:** [ ]

---

### Step 3.8 — Compliance and P2 schema
- **Depends on:** 3.7
- **Build:** Add `consent_log` and `firm_clients`. `CHECK(firm_org_id != client_org_id)`. Run generate and migrate.
- **Definition of done:** Inserting a `firm_clients` row where `firm_org_id = client_org_id` returns a check constraint violation.
- **Status:** [ ]

---

### Step 3.9 — RLS policies and isolation function
- **Depends on:** 3.8
- **Build:** Create `src/lib/platform/db/rls-policies.sql` with `get_accessible_org_ids()`, `ENABLE ROW LEVEL SECURITY` on all 21 org-scoped tables, and `CREATE POLICY` for each including all four new V2 tables. Apply **manually** via Supabase SQL Editor. Document in `SETUP.md`.
- **Definition of done:** Query `SELECT * FROM findings WHERE org_id = orgA_id` as User B (Org B) returns 0 rows. INSERT into Org A's `findings` as User B is rejected by `WITH CHECK`.
- **Status:** [ ]

---

### Step 3.10 — Seed data
- **Depends on:** 3.9
- **Build:** Create `scripts/seed.ts`. Creates: one org ("Demo Corp"), owner user, `subscriptions` row (trial), four `alert_configs` rows, 180 days of synthetic transactions (500+ rows), 7 months of `financial_snapshots`. Upserts on unique constraints.
- **Definition of done:** `pnpm tsx scripts/seed.ts` runs without error. 500+ transaction rows. 7 snapshot rows. Running twice does not increase counts.
- **Status:** [ ]

---

## Phase 4: QuickBooks Integration

End state: can authorize a QB sandbox account, sync transactions, and see them in the DB.

---

### Step 4.0 — QuickBooks developer app setup
- **Depends on:** 1.0
- **Build:** Register at `developer.intuit.com`. Create QBO Sandbox app. Register redirect URI: `http://localhost:3000/api/auth/quickbooks/callback`. Add `QB_CLIENT_ID`, `QB_CLIENT_SECRET`, `QB_ENVIRONMENT=sandbox` to `.env.local`. Install `intuit-oauth@4.0.4`, `node-quickbooks@2.0.5`. Create `src/lib/integrations/quickbooks/auth.ts`.
- **Definition of done:** `createOAuthClient()` executes without throwing. Sandbox app appears in Intuit developer console.
- **Status:** [ ]

---

### Step 4.1 — OAuth token encryption utilities
- **Depends on:** 1.3
- **Build:** Create `src/lib/platform/security/encryption.ts` with AES-256-GCM `encryptToken`/`decryptToken`. Add `OAUTH_ENCRYPTION_KEY` to `.env.local` via `openssl rand -hex 32`. Write unit tests: round-trip, different ciphertext per call, tampered ciphertext throws.
- **Definition of done:** `pnpm vitest run src/lib/platform/security/encryption.test.ts` passes all tests.
- **Status:** [ ]

---

### Step 4.2 — QB OAuth initiate (read-only scopes enforced)
- **Depends on:** 4.0, 4.1, 3.2
- **Build:** Create `src/app/api/auth/quickbooks/initiate/route.ts`. Requires auth + admin/owner. Generates PKCE and CSRF. Stores in httpOnly cookie (2-min TTL). Returns `{ authorizationUrl }` using **read-only scopes only**. The Intuit developer console must be configured to reject write scope requests.
- **Definition of done:** Endpoint returns an `authorizationUrl`. Response sets an httpOnly cookie.
- **Status:** [ ]

---

### Step 4.3 — QB OAuth callback handler
- **Depends on:** 4.2
- **Build:** Create `src/app/api/auth/quickbooks/callback/route.ts`. Validates state. Exchanges code for tokens. **Verifies only read scopes were granted — rejects connection if write scopes present.** Encrypts tokens. Upserts `connections`. Enqueues `sync/connection.requested`. Redirects to `/onboarding/sync` or `/settings/connections`.
- **Definition of done:** Complete OAuth flow. `connections` row exists with encrypted tokens. `access_token_encrypted` does not equal the original token.
- **Status:** [ ]

---

### Step 4.4 — QB API client factory
- **Depends on:** 4.1, 4.3
- **Build:** Create `src/lib/integrations/quickbooks/client.ts` with `getQuickBooksClient(connectionId)`. Decrypts tokens, checks expiry, refreshes if needed. On refresh failure: `sync_status='auth_expired'`.
- **Definition of done:** `pnpm tsx scripts/test-qb-client.ts` calls `qbo.getCompanyInfo()` — sandbox company info prints.
- **Status:** [ ]

---

### Step 4.5 — Chart of Accounts import
- **Depends on:** 4.4
- **Build:** Create `importAccounts(connectionId, syncJobId)`. Normalizes via `normalize.ts`. Upserts on `UNIQUE(org_id, source_system, external_id)`. Logs malformed accounts to `data_quality_log`.
- **Definition of done:** `importAccounts()` populates `accounts` table. Calling twice creates no duplicates.
- **Status:** [ ]

---

### Step 4.6 — Transaction import (initial 13-month pull)
- **Depends on:** 4.5
- **Build:** Create `importTransactions(connectionId, syncJobId, since?)`. Paginated batches of 1,000. Updates `sync_jobs.records_synced` per batch. Handles HTTP 429 with 30-second pause + retry.
- **Definition of done:** `transactions` table populated after initial import. Running twice creates no duplicates. `sync_jobs.records_synced` is correct.
- **Status:** [ ]

---

### Step 4.7 — Transaction normalization
- **Depends on:** 4.6
- **Build:** Create `src/lib/integrations/quickbooks/normalize.ts`. Maps QB `TxnType` to internal `transaction_type`. Maps QB categories to 15-category schema. Unmapped → `'other'`. Write unit tests for 10 QB transaction types.
- **Definition of done:** `pnpm vitest run src/lib/integrations/quickbooks/normalize.test.ts` passes. No `undefined` categories.
- **Status:** [ ]

---

### Step 4.8 — Incremental sync logic
- **Depends on:** 4.7
- **Build:** Add `incrementalSync(connectionId)`. Reads `connections.last_synced_at`. Queries QB for modifications since. Upserts. Updates `last_synced_at` and `sync_status`.
- **Definition of done:** After initial import, create a QB sandbox transaction. Run `incrementalSync()`. New transaction appears. `sync_jobs.records_synced` is small (not a full re-import).
- **Status:** [ ]

---

### Step 4.9 — Inngest sync job with ordered steps
- **Depends on:** 4.8, 1.7
- **Build:** Implement `jobs/sync/fan-out.ts` (cron `'0 */6 * * *'`). Implement `jobs/sync/single-org.ts` with **three ordered steps** — order is critical:
  1. `step.run('pull-transactions')` → `incrementalSync()`
  2. `step.run('recompute-snapshots')` → **stub returning immediately** (real implementation in Step 4.10)
  3. `step.sendEvent('trigger-intelligence-run')` → dispatches `intelligence/run.requested`
- **Definition of done:** Trigger `sync-fan-out` in Inngest dev UI. `sync-single-org` shows three steps in order. `recompute-snapshots` completes before `trigger-intelligence-run` fires.
- **Status:** [ ]

---

### Step 4.10 — Financial snapshots computation post-sync
- **Depends on:** 4.9
- **Build:** Create `src/lib/financial/aggregations/dashboard.ts` with `recomputeSnapshots(orgId)`. Aggregates transactions into `financial_snapshots` for current month, prior month, and last 7 months. **Replace the Step 4.9 stub** with the real call.
- **Definition of done:** After sync, `financial_snapshots` shows 7 rows. `total_revenue` matches raw SQL verification. Running sync twice creates no duplicate snapshot rows.
- **Status:** [ ]

---

## Phase 5: Financial Data Layer + Cash Flow Projection Engine

End state: all calculation functions tested, `GET /api/cashflow/projection` returns a 30/60/90-day forecast.

---

### Step 5.0 — P&L calculation functions
- **Depends on:** 3.10
- **Build:** Create `src/lib/financial/calculations/pnl.ts` with `calculatePnL(orgId, startDate, endDate)`. Fast path from `financial_snapshots`. Returns `{ revenue: string, expenses: string, netProfit: string }` — monetary values as strings (DECIMAL serialized, never JS number). Write unit tests.
- **Definition of done:** `pnpm vitest run src/lib/financial/calculations/pnl.test.ts` passes. Returned `revenue` matches seeded total to two decimal places.
- **Status:** [ ]

---

### Step 5.1 — Cash position and AR balance
- **Depends on:** 5.0
- **Build:** Create `getCashPosition(orgId)` (sums asset account balances) and `getArBalance(orgId)` in `src/lib/financial/calculations/cash-flow.ts`. Returns strings.
- **Definition of done:** `getCashPosition(orgId)` returns the sum of asset account balances verifiable via manual Supabase query.
- **Status:** [ ]

---

### Step 5.2 — Expense category aggregation
- **Depends on:** 5.0
- **Build:** Create `getExpensesByCategory(orgId, start, end)` in `src/lib/financial/aggregations/categories.ts`. Returns `{ category, amount, sharePct }[]` sorted by amount. Write unit tests.
- **Definition of done:** `pnpm vitest run` passes. Category amounts sum to same total as `calculatePnL().expenses`.
- **Status:** [ ]

---

### Step 5.3 — Period comparison and trend data
- **Depends on:** 5.0
- **Build:** Create `getPeriodComparison(orgId, current, prior)` and `getMonthlyRevenueTrend(orgId, 7)` in `src/lib/financial/aggregations/trends.ts`.
- **Definition of done:** Unit test: current=150, prior=100 → `{ changePct: 50, direction: 'up' }`. Passes.
- **Status:** [ ]

---

### Step 5.4 — AR aging schedule builder
- **Depends on:** 5.1
- **Build:** Create `src/lib/financial/intelligence/ar-aging.ts` with `buildArAgingSchedule(orgId)`. Assigns invoices to aging buckets (current, 1–30, 31–60, 61–90, 90+). Estimates payment probability per client from historical days-to-collect.
- **Definition of done:** Returns array with non-null `projectedPaymentDate` and `confidenceLevel` for each invoice. Unit test with mock invoice data passes.
- **Status:** [ ]

---

### Step 5.5 — Recurring expense detection
- **Depends on:** 5.0
- **Build:** Create `detectRecurringExpenses(orgId)` in `src/lib/financial/intelligence/cash-flow.ts`. Scans last 90 days for same-vendor charges within 10% of each other on a 25–35 day cycle. Returns `RecurringExpense[]` with vendor name, expected amount, next expected date.
- **Definition of done:** Against seeded data with 3 months of monthly AWS charges, function returns AWS as a recurring expense with the correct next expected date.
- **Status:** [ ]

---

### Step 5.6 — Cash flow projection algorithm
- **Depends on:** 5.4, 5.5
- **Build:** Create `buildCashFlowProjection(orgId, periodDays)` in `cash-flow.ts`. Combines: current cash position + projected inflows (from `buildArAgingSchedule`) + projected outflows (from `detectRecurringExpenses`). Produces daily balance array. Computes `minimumProjectedBalance` and `riskDate`.
- **Definition of done:** Returns 30 daily objects. `minimumProjectedBalance` is a valid DECIMAL string. With seeded overdue invoices, `riskDate` is non-null.
- **Status:** [ ]

---

### Step 5.7 — Cash flow projection storage and API endpoint
- **Depends on:** 5.6
- **Build:** Create `storeCashFlowProjection()` upsert. Implement `src/app/api/cashflow/projection/route.ts` (`GET`, `?days=30|60|90`). Returns 422 with `{ code: 'insufficient_data', daysAvailable: N, daysRequired: 60 }` if fewer than 60 days of data.
- **Definition of done:** Endpoint returns `projectedData` array of 30 entries. With fresh org (< 60 days), returns 422 with `daysAvailable` in error body.
- **Status:** [ ]

---

### Step 5.8 — AI financial context builder
- **Depends on:** 5.0, 5.2, 5.3
- **Build:** Create `src/lib/ai/context/builder.ts` with `buildFinancialContext(orgId)`. Assembles last 3 months P&L, cash position, top 5 expense categories, AR aging summary, org metadata. Returns formatted string under 8,000 tokens.
- **Definition of done:** Output contains real numbers and is under 8,000 tokens. No null values.
- **Status:** [ ]

---

### Step 5.9 — Financial summary API endpoint
- **Depends on:** 5.0, 5.1, 5.2, 5.3
- **Build:** Implement `src/app/api/financial/summary/route.ts`. Reads from pre-computed `financial_snapshots` only. Target: < 500ms.
- **Definition of done:** `time curl` shows response under 500ms. Response contains real non-null values for revenue, cash position, top expense categories, revenue trend.
- **Status:** [ ]

---

## Phase 6: Proactive Intelligence Engine

End state: nightly Inngest job generates findings stored in `findings`, sends severity-gated emails.

> **All three non-negotiable constraints apply to every step in this phase.**

---

### Step 6.0 — Intelligence runner scaffold and guards
- **Depends on:** 4.9, 3.7
- **Build:** Implement `jobs/intelligence/run.ts` (replacing the stub). Creates `intelligence_runs` row with `status='running'`. **Guard 1:** if fewer than 60 days of transaction data → `status='skipped'`, `skipped_reason='insufficient_history'`, return. **Guard 2:** if most recent `sync_jobs.status != 'completed'` → `status='skipped'`, `skipped_reason='sync_failed'`, return.
- **Definition of done:** Trigger for org with < 60 days data. `intelligence_runs` shows `status='skipped'`, `skipped_reason='insufficient_history'`. Zero findings written. No errors thrown.
- **Status:** [ ]

---

### Step 6.1 — AI provider routing utility (non-negotiable requirement)
- **Depends on:** 1.3
- **Build:** Create `src/lib/ai/models/router.ts` with `getModel()` reading `AI_PROVIDER` env var. `google` → `google('gemini-2.0-flash')`. `anthropic` → uses complexity scoring to return Haiku or Sonnet. Create `detectRateLimitError(error): boolean` returning `true` for HTTP 429. This is the **only** place `anthropic(...)` or `google(...)` may be called in the codebase.
- **Definition of done:** Unit test: `AI_PROVIDER=google` → model ID contains `gemini`. `AI_PROVIDER=anthropic` → model ID contains `claude`. `detectRateLimitError` returns `true` for mocked 429, `false` for generic error. `pnpm vitest run src/lib/ai/models/router.test.ts` passes.
- **Status:** [ ]

---

### Step 6.2 — Cash flow projection intelligence step
- **Depends on:** 5.6, 5.7, 6.0, 6.1
- **Build:** Add `step.run('cash-flow-projection', ...)` in the intelligence runner. Steps: (1) call `buildCashFlowProjection()`, (2) call `storeCashFlowProjection()`, (3) if `minimumProjectedBalance < bufferThreshold`: call `getModel()` (**not** `anthropic()` directly) to generate a plain-English finding headline and detail. **Rate-limit guard:** wrap AI call in `try/catch`. On `detectRateLimitError(err)===true`: set `status='skipped'`, `skipped_reason='rate_limit'`, `return`.
- **Definition of done:** Step appears in Inngest dev UI. Step duration under 8 seconds. `cash_flow_projections` row written. With seeded cash risk, `cash_flow_risk` finding appears in `findings`. Unit test confirms 429 causes clean skip with `skipped_reason='rate_limit'`.
- **Status:** [ ]

---

### Step 6.3 — Anomaly detection intelligence step (expense spike + collections slippage)
- **Depends on:** 6.2
- **Build:** Create `src/lib/financial/intelligence/anomaly.ts` with `runAnomalyDetection(orgId, runId)`. This module implements the deterministic analysis for expense spike (7-day vs 30-day rolling avg, threshold from `alert_configs`) and collections slippage (days-to-collect slippage > 25%). For each triggered condition, calls `getModel()` to generate a finding headline and detail. In `jobs/intelligence/run.ts`, add `step.run('anomaly-detection', () => runAnomalyDetection(orgId, runId))` — **its own isolated step, never combined with cash flow**. **Rate-limit guard in try/catch:** on 429, writes finding with `headline=null` (finding fires but without description — re-generated on next run). Returns findings.
- **Definition of done:** `src/lib/financial/intelligence/anomaly.ts` exists and exports `runAnomalyDetection()`. Separate step in Inngest dev UI from `cash-flow-projection`. Duration under 8 seconds. With seeded expense spike, `anomaly` finding generated. Unit test: mock 429 → step returns cleanly with `skipped_reason='rate_limit'`.
- **Status:** [ ]

---

### Step 6.4 — Margin deterioration detection step
- **Depends on:** 6.3
- **Build:** Add `step.run('margin-detection', ...)` — separate step, not combined with anomaly detection. Compares current month-to-date gross margin against same-period prior year (skip if < 12 months history). Rate-limit guard.
- **Definition of done:** Appears as its own step. Duration under 8 seconds. With seeded margin decline of 30% vs prior year, `margin_alert` finding generated. Unit test confirms 429 causes clean skip.
- **Status:** [ ]

---

### Step 6.5 — AR aging analysis step
- **Depends on:** 5.4, 6.4
- **Build:** Add `step.run('ar-aging-analysis', ...)`. Calls `buildArAgingSchedule(orgId)`. For invoices in 31–60 day or 60+ day buckets: generates `collections_opportunity` finding. **`related_data` JSONB must store:** invoice IDs, amounts, client names, days outstanding — this data is used by the agentic execution layer in Phase 9. Rate-limit guard.
- **Definition of done:** Step is its own isolated run. Duration under 8 seconds. Overdue invoices in seeded data → `collections_opportunity` finding with `related_data` containing `invoiceId`, `amount`, `clientName`, `daysOutstanding`.
- **Status:** [ ]

---

### Step 6.6 — Duplicate subscription scan step
- **Depends on:** 6.5
- **Build:** Create `src/lib/financial/intelligence/duplicates.ts` with `runDuplicateSubscriptionScan(orgId, runId)`. This module extends the recurring expense detection from Step 5.5 to identify same vendor across two different expense accounts with amounts within 10% in a 25–35 day window. `related_data` stores vendor name, both transaction IDs, amounts, and account names. In `jobs/intelligence/run.ts`, add `step.run('duplicate-subscription-scan', () => runDuplicateSubscriptionScan(orgId, runId))`. Rate-limit guard.
- **Definition of done:** `src/lib/financial/intelligence/duplicates.ts` exists and exports `runDuplicateSubscriptionScan()`. Own isolated step. Duration under 8 seconds. With seeded duplicate billing, `duplicate_subscription` finding generated. Unit test: mock 429 → clean skip.
- **Status:** [ ]

---

### Step 6.7 — Finding storage and run completion
- **Depends on:** 6.6
- **Build:** After all four analysis steps: call `writeFindings(orgId, runId, allFindings)` which inserts into `findings` with severity, selective `expires_at` (see below), and `status='active'`. Sets `intelligence_runs.status='completed'`, `findings_generated=count`. Updates `connections.last_intelligence_run_at`. Implement deduplication: skip writing a finding if same `finding_type` + `org_id` exists from same calendar day.
  **Selective `expires_at` rule (critical — do not apply blanket 7-day expiry):**
  - `cash_flow_risk` findings: set `expires_at` to the cash flow projection's `riskDate` (the date the shortfall is projected to occur). After that date passes, the finding is no longer actionable.
  - All other finding types (`anomaly`, `collections_opportunity`, `duplicate_subscription`, `margin_alert`): set `expires_at = NULL`. These findings persist until explicitly dismissed or actioned — setting a fixed expiry would silently remove unaddressed findings from the user's feed.
- **Definition of done:** After full run, `intelligence_runs.status='completed'`. `findings` contains correct rows. `connections.last_intelligence_run_at` updated. Running intelligence job twice same day does not create duplicate findings. A `cash_flow_risk` finding has a non-null `expires_at` set to the `riskDate`. A `duplicate_subscription` finding has `expires_at = NULL`.
- **Status:** [ ]

---

### Step 6.8 — Intelligence email trigger (severity-gated, full email spec)
- **Depends on:** 6.7
- **Build:** After findings written: `critical` → dispatch `intelligence/email.requested` with `delaySeconds: 0`; `high` → dispatch with `delaySeconds: 7200`; `medium/low/none` → **no event dispatched**. Implement `jobs/intelligence/email.ts` with the following **required** email spec:
  - **Subject line:** Critical: `"[Product Name] — urgent: [headline of highest-severity finding]"` (multiple findings: `"... (+ N more)"`). High-only: `"[Product Name] — action recommended: [headline]"`.
  - **Email body per finding:** bold headline, severity label, plain-English detail with dollar amounts, then two action links:
    - `"View full brief →"` → links to `/dashboard?finding_id=[id]`
    - `"Ask the AI about this →"` → links to `/ask?finding_id=[id]`
  - **Footer (always present):** "You're receiving this because a high or critical finding was detected in your QuickBooks data. This is AI-generated financial analysis. Not financial advice."
  - **No-resend deduplication:** Before sending, check whether this exact `finding.id` was included in the previous intelligence run's email for this org (query the prior `intelligence_runs` email history or store `last_emailed_finding_ids` on the run). Only re-include a finding in a new email if (a) its severity has changed or (b) the underlying projection amounts have changed by >10%. Unchanged findings from the prior cycle must be omitted.
- **Definition of done:** Seed a `critical` finding. Trigger email job. Email arrives within 2 minutes with: correct subject format, finding headline + severity label + dollar detail, "View full brief →" link, "Ask the AI →" link, and the standard footer. With only `medium` findings, no email is sent. Run the job twice with the same unchanged finding — the second email is either not sent or omits the already-emailed finding.
- **Status:** [ ]

---

### Step 6.9 — Intelligence fan-out wiring (daily cron)
- **Depends on:** 6.8, 1.7
- **Build:** Implement `jobs/intelligence/fan-out.ts` (function ID `intelligence-fan-out`, cron `'0 6 * * *'`). Queries all active-connection orgs. Dispatches one `intelligence/run.requested` per org with `runType: 'scheduled'`. Register all intelligence functions in the Inngest serve handler.
- **Definition of done:** Trigger `intelligence-fan-out` in Inngest dev UI. One `intelligence/run.requested` event fires per active org. Full pipeline (fan-out → run → findings → email if high/critical) completes.
- **Status:** [ ]

---

### Step 6.10 — GET /api/intelligence/feed endpoint
- **Depends on:** 6.7
- **Build:** Implement `src/app/api/intelligence/feed/route.ts`. Queries `findings` where `status='active'`. Sorted: critical → high → medium → low, then `created_at DESC` within tier. Cursor-based pagination. Returns `bySeverity` counts in `meta`. Includes `hasActionableType: boolean` per finding.
- **Definition of done:** Endpoint returns findings sorted critical-first. `meta.bySeverity` counts are correct. With no active findings, returns empty array.
- **Status:** [ ]

---

### Step 6.11 — POST /api/intelligence/findings/:id/dismiss endpoint
- **Depends on:** 6.10
- **Build:** Implement dismiss endpoint. Validates reason enum. Sets `status='dismissed'`, timestamps, `dismiss_reason`. Returns 409 if not `active`.
- **Definition of done:** Dismiss a finding. It no longer appears in `GET /api/intelligence/feed`. A second dismiss attempt returns 409.
- **Status:** [ ]

---

### Step 6.12 — Intelligence engine integration test
- **Depends on:** 6.11
- **Build:** Create `src/__tests__/intelligence/full-run.test.ts`. Seeds test org with: overdue invoice, duplicate vendor billing, recent expense spike. Calls intelligence runner directly. Asserts: `intelligence_runs.status='completed'`, at least 3 findings, each finding has non-null `headline`, `collections_opportunity` finding's `related_data` contains the expected invoice ID.
- **Definition of done:** `pnpm vitest run src/__tests__/intelligence/full-run.test.ts` passes all assertions in under 30 seconds.
- **Status:** [ ]

---

## Phase 7: Core Frontend — Layout and Design System

End state: app shell renders correctly, all base components work without data.

---

### Step 7.0 — Tailwind v4 + CSS design tokens + format utilities
- **Depends on:** 1.0
- **Build:** Install `tailwindcss@4.1`. Create CSS variables from FRONTEND_GUIDELINES.md Section 2.7 in `src/styles/globals.css`. Add `@theme` extension. Add `.font-numeric` utility. Load Inter and IBM Plex Mono via `next/font/google` in `src/app/layout.tsx` — **not CSS `@import`**. Also create `src/lib/format.ts` (missing from the original scaffold) with the three utility functions from FRONTEND_GUIDELINES.md Section 9.4: `formatCurrency(value: string | number, options?)`, `formatPercent(value: number)`, and `formatDate(date: string | Date)`. This file must exist before any Phase 7 component uses it. The system prompt in `src/lib/ai/prompts/system.ts` must also include the AI currency formatting instruction from FRONTEND_GUIDELINES.md Section 8.1.1 — add a placeholder comment here to be filled in Step 11.1.
- **Definition of done:** `--primary-500` resolves to `#2557A7` in DevTools. No `fonts.googleapis.com` requests in Network tab. `src/lib/format.ts` exists. `formatCurrency('-1234.56')` returns `'−$1,234.56'` (Unicode minus, two decimal places, comma separator). `pnpm tsc --noEmit` passes.
- **Status:** [ ]

---

### Step 7.1 — shadcn/ui and base primitives
- **Depends on:** 7.0
- **Build:** Run `pnpm dlx shadcn@latest init`. Install: `button`, `input`, `select`, `dialog`, `tooltip`, `skeleton`, `badge`, `separator`, `tabs`. Apply design token overrides. Install `sonner` for toasts.
- **Definition of done:** All components render in `test-components/page.tsx` without errors. Primary button color matches `#2557A7`.
- **Status:** [ ]

---

### Step 7.2 — App shell and navigation (V2 structure)
- **Depends on:** 7.1
- **Build:** Create `src/components/shared/AppNav.tsx` with five nav items: **Intelligence** (`/dashboard`), **Cash Flow** (`/cashflow`), **Ask** (`/ask`), **Reports** (`/reports`), Settings icon. "Intelligence" is first (not "Dashboard"). Create `(dashboard)` layout. Create stub pages at each route.
- **Definition of done:** Nav shows "Intelligence" as first item. Clicking each item navigates correctly at 1024px and 1280px viewports.
- **Status:** [ ]

---

### Step 7.3 — Severity badge and financial number components
- **Depends on:** 7.1
- **Build:** Create `SeverityBadge.tsx` (Critical/High/Medium/Low with correct colors). `CurrencyAmount.tsx` accepts `string | number`, formats as `$1,234.56`, negative in `loss-600` with Unicode minus (never parentheses). `MetricChange.tsx` with `sr-only` accessibility text.
- **Definition of done:** `<SeverityBadge severity="critical" />` shows correct critical color. `<CurrencyAmount value="-1234.56" />` renders `−$1,234.56` in `loss-600`.
- **Status:** [ ]

---

### Step 7.4 — Skeleton loading components
- **Depends on:** 7.1
- **Build:** Create `FindingCardSkeleton.tsx` (severity badge + headline + detail + CTA placeholders), `MetricCardSkeleton.tsx`, `AIResponseSkeleton.tsx` (3 lines at 90%/75%/55% with primary-200 left border already visible). All use `animate-pulse`.
- **Definition of done:** All three skeletons pulse smoothly. `AIResponseSkeleton` shows left border before content renders.
- **Status:** [ ]

---

### Step 7.5 — Financial table component
- **Depends on:** 7.1
- **Build:** Create `FinancialTable.tsx`. Right-aligns numeric columns. Applies `.font-numeric`. Renders `—` for null. 44px row height. `border-radius: 0` on container.
- **Definition of done:** Numeric columns are right-aligned. Null renders as `—`. Container has `border-radius: 0`.
- **Status:** [ ]

---

### Step 7.6 — Alert badge and DataTimestamp
- **Depends on:** 7.1
- **Build:** Create `AlertBadge.tsx` (0 = nothing, 1–9 = count, ≥10 = `9+`). Create `DataTimestamp.tsx` (turns amber if > 12 hours old). Update `AppNav.tsx` to use `AlertBadge` for Intelligence nav item.
- **Definition of done:** `<AlertBadge count={3} />` shows `3`. `<AlertBadge count={0} />` shows nothing. `<DataTimestamp>` with 13-hour-old date renders in amber.
- **Status:** [ ]

---

## Phase 8: Intelligence Feed Dashboard

End state: `/dashboard` renders the intelligence feed; `/cashflow` renders the forward-looking timeline.

---

### Step 8.0 — Intelligence Feed page layout and data fetching
- **Depends on:** 6.10, 7.2
- **Build:** Create `src/app/(dashboard)/dashboard/page.tsx` as Server Component. Fetches from `GET /api/intelligence/feed`. Creates `loading.tsx` with `FindingCardSkeleton`. Header: "Intelligence Feed" + `DataTimestamp` + data sovereignty badge ("🔒 Read-only — your books are unchanged").
- **Definition of done:** Finding data loads for the seeded demo org. Data sovereignty badge always visible. `loading.tsx` skeleton renders during fetch.
- **Status:** [ ]

---

### Step 8.1 — Finding card component
- **Depends on:** 8.0, 7.3
- **Build:** Create `src/components/dashboard/FindingCard.tsx`. Renders all five elements: (1) `SeverityBadge`, (2) headline, (3) "why it matters" detail, (4) recommended action (if non-null), (5) "Take action" button (disabled if `hasActionableType=false`) and "Tell me more →" link. Card expands inline on header click.
- **Definition of done:** Finding cards render for each finding. "Tell me more →" shows `href="/ask?finding_id=[id]"`. `hasActionableType=false` → "Take action" is disabled.
- **Status:** [ ]

---

### Step 8.2 — Intelligence Feed healthy and insufficient-data states
- **Depends on:** 8.1
- **Build:** When findings array is empty: render healthy state (checkmark list of what AI checked, next scan time, "Ask a question →" CTA). When < 60 days data: render progress bar + "building baseline" card + any immediate findings above it.
- **Definition of done:** Dismiss all findings → healthy state renders. Fresh org with < 60 days data → progress bar renders with correct count.
- **Status:** [ ]

---

### Step 8.3 — Finding dismiss action in UI
- **Depends on:** 8.1, 6.11
- **Build:** Add "•••" overflow menu to `FindingCard.tsx`. "Dismiss" opens a small modal with three reason radio buttons. On confirm, calls `POST /api/intelligence/findings/:id/dismiss`. Card fades out on success.
- **Definition of done:** Dismiss a finding card. It fades out. `GET /api/intelligence/feed` no longer returns it. `findings` table shows `status='dismissed'`.
- **Status:** [ ]

---

### Step 8.4 — Cash Flow Timeline page and visualization
- **Depends on:** 5.7, 7.2
- **Build:** Create `src/app/(dashboard)/cashflow/page.tsx`. Install `recharts@2.15`. Create `CashFlowChart.tsx` with `ComposedChart`: green inflow bars, red outflow bars, net balance line, `ReferenceLine` at y=0, red `ReferenceDot` markers on risk dates. Three view tabs (30/60/90). Confidence badge. Disclaimer always visible.
- **Definition of done:** Chart renders with real data. Risk date markers appear (if seeded data has a cash risk). Chart container has `border-radius: 0`. Tab switching re-fetches with correct `?days=` parameter.
- **Status:** [ ]

---

### Step 8.5 — Cash flow detail panel and insufficient-data empty state
- **Depends on:** 8.4
- **Build:** Clicking a risk date marker opens `CashFlowDetailPanel.tsx` inline (inflows list, outflows list, explanation). "Accelerate these invoices" CTA appears when invoices contribute to the risk (disabled for now, wired in Phase 9). Implement the 422/insufficient-data empty state: progress bar showing `daysAvailable / 60`, explanation, three "Ask a question" CTA links.
- **Definition of done:** Click a risk date → detail panel expands inline. For fresh org (< 60 days data) → progress bar renders with correct count and three CTA links.
- **Status:** [ ]

---

### Step 8.6 — Intelligence nav badge live count
- **Depends on:** 8.0, 7.6
- **Build:** Update `AppNav.tsx` to fetch active finding count from `GET /api/intelligence/feed?limit=1` (`meta.total`). `AlertBadge` renders the count on the Intelligence nav item.
- **Definition of done:** With 3 active findings, Intelligence nav shows badge `3`. After all dismissed, badge clears on next navigation.
- **Status:** [ ]

---

## Phase 9: Agentic Execution Layer

End state: user can trigger draft generation, review and edit inline, copy to clipboard, and track action in `action_drafts`.

---

### Step 9.0 — Draft generation endpoint
- **Depends on:** 6.10, 6.1
- **Build:** Implement `src/app/api/intelligence/findings/[id]/draft-action/route.ts` (`POST`). Validates org membership. Reads `finding.related_data`. Calls `getModel()` — **never `anthropic(...)` or `google(...)` directly**. Creates `action_drafts` row with `status='draft'`. Returns 422 if finding type has no draft template.
- **Definition of done:** Endpoint for `collections_opportunity` finding returns 201 with `draftContent`, `subjectLine`, `recipientEmail` (or null). `action_drafts` row created. Endpoint for `cash_flow_risk` finding returns 422.
- **Status:** [ ]

---

### Step 9.1 — Draft templates (all three action types)
- **Depends on:** 9.0
- **Build:** Create `src/lib/ai/prompts/drafts/invoice-acceleration.ts` (80–120 words, professional collections nudge; injects client name, invoice numbers, amounts, days overdue from `related_data`). Create `subscription-cancellation.ts` (professional inquiry, includes both transaction amounts and dates). Create `vendor-negotiation.ts` (100–150 words, asks to schedule a pricing call; includes current annual spend and year-over-year increase). Write unit tests for each template.
- **Definition of done:** All three templates generate valid draft text with mock `related_data` inputs. Unit tests pass. Draft for invoice acceleration contains the client name from input.
- **Status:** [ ]

---

### Step 9.2 — PATCH /api/intelligence/actions/:id endpoint
- **Depends on:** 9.0
- **Build:** Implement `src/app/api/intelligence/actions/[id]/route.ts` (`PATCH`). Accepts `{ status: 'approved' | 'copied' | 'rejected' }`. Validates legal transitions. Sets timestamps. On `copied`: also sets `findings.status='actioned'`. Returns 400 for illegal transitions.
- **Definition of done:** `draft→approved→copied` succeeds. On `copied`, parent `findings` row shows `status='actioned'`. Attempting `copied→approved` returns 400.
- **Status:** [ ]

---

### Step 9.3 — Agentic modal — States 1 and 2 (confirm + loading)
- **Depends on:** 8.1, 9.0
- **Build:** Create `src/components/dashboard/AgenticModal.tsx` using shadcn `Dialog`. State 1: finding summary + "Draft it" / "Not now". "Not now" closes, finding persists. "Draft it" calls `POST /api/intelligence/findings/:id/draft-action` → State 2. State 2: animated progress bar, "Drafting your message...". API failure: "Draft generation failed. [Try again] [Cancel]".
- **Definition of done:** Click "Take action" on a `collections_opportunity` card. State 1 opens with correct client name and amount. Click "Draft it". State 2 loading state appears. After 2–4 seconds, transitions to State 3.
- **Status:** [ ]

---

### Step 9.4 — Agentic modal — State 3 (review and inline edit)
- **Depends on:** 9.3
- **Build:** State 3 renders: `To:` field (from `recipientEmail`, or placeholder if null), `Subject:`, editable draft body. Clicking any text activates inline edit. "Looks good →" → State 4. "← Start over" → State 1.
- **Definition of done:** Click any word in the draft body — it becomes editable. Edit text — preserved after clicking outside. "← Start over" returns to State 1.
- **Status:** [ ]

---

### Step 9.5 — Agentic modal — State 4 (copy to clipboard) and no-email fallback
- **Depends on:** 9.4
- **Build:** State 4: read-only final draft. Prominent "📋 Copy to clipboard" button. Sub-text: "Paste this into your email client and send it. This product never sends on your behalf." "← Edit" returns to State 3. **No-email fallback:** if `recipientEmail` was null: warning banner "QuickBooks doesn't have an email address for [ClientName]. Add their address in the 'To:' field when you paste." Copy-to-clipboard includes `TO: [Add [ClientName]'s email address]` as a literal reminder.
- **Definition of done:** Copy button copies full draft. Paste into text editor — To, Subject, Body all present. For null `recipientEmail`: copied text includes the `TO:` placeholder literally.
- **Status:** [ ]

---

### Step 9.6 — Agentic modal — State 5 (confirmation) and action tracking
- **Depends on:** 9.5, 9.2
- **Build:** On copy: call `PATCH /api/intelligence/actions/:id` with `status:'copied'`. Render State 5: green checkmark, "✓ Copied to clipboard", "Open your email client, paste, and send." "Mark as sent" toggle. "Close" dismisses.
- **Definition of done:** After copying, `action_drafts` shows `status='copied'` and non-null `copied_at`. Parent `findings` row shows `status='actioned'`. Finding card disappears from Intelligence Feed on next refresh.
- **Status:** [ ]

---

### Step 9.7 — Wire all agentic CTAs
- **Depends on:** 9.6, 8.5
- **Build:** Wire "Take action" on `FindingCard.tsx` → open `AgenticModal` with correct `findingId`. Wire "Accelerate these invoices" on `CashFlowDetailPanel.tsx` → open `AgenticModal` pre-populated with all risk-date invoices (State 1 shows count and combined amount).
- **Definition of done:** "Take action" from Intelligence Feed card → modal with that finding's data. "Accelerate these invoices" from Cash Flow detail → modal with correct invoice count.
- **Status:** [ ]

---

## Phase 10: Bench Refugee Onboarding

End state: refugee users route through a dedicated data-sovereignty-focused flow with CSV upload support.

---

### Step 10.0 — Migration check screen (/onboarding/migration)
- **Depends on:** 2.5
- **Build:** Create `src/app/(dashboard)/onboarding/migration/page.tsx`. Two path cards: "Migrating from Bench or another service" → `/onboarding/refugee`; "Starting fresh" → `/onboarding/org`. If `?source=bench`: Card 1 highlighted. Update auth callback to route ALL new users to `/onboarding/migration` (not directly to `/onboarding/org`).
- **Definition of done:** Register with `?source=bench`. Auth callback → `/onboarding/migration?source=bench`. Card 1 is highlighted. Card 1 → `/onboarding/refugee`. Card 2 → `/onboarding/org`.
- **Status:** [ ]

---

### Step 10.1 — Refugee welcome page and CSV upload
- **Depends on:** 10.0
- **Build:** Create `src/app/(dashboard)/onboarding/refugee/page.tsx`. Headline: "You've been through this before. Let's make sure it never happens again." Body: structural difference explanation. Three path cards: "Have exports" → `/onboarding/csv`; "Have QBO/Xero" → `/onboarding/connect`; "Lost everything" → `/onboarding/start-fresh`. Install `papaparse@5.5`. Create `src/app/(dashboard)/onboarding/csv/page.tsx`. File input (`.csv` only). Calls `POST /api/connections/csv`. Shows progress and import summary. Persistent banner: "Static snapshot — connect QuickBooks for live monitoring."
- **Definition of done:** Refugee welcome page renders with three path cards. Upload a QB Transaction Detail Report CSV → `transactions` table rows appear with `source_system='csv'`. The persistent banner renders after import.
- **Status:** [ ]

---

### Step 10.2 — Start fresh and updated connect screen
- **Depends on:** 10.1
- **Build:** Create `src/app/(dashboard)/onboarding/start-fresh/page.tsx` (three instructional steps + "Connect my new QuickBooks account →" CTA). Update `src/app/(dashboard)/onboarding/connect/page.tsx` to show the data sovereignty statement: "**Read-only access. Always.** We connect to your QuickBooks or Xero file but never write to it. If you cancel, your accounting file is 100% intact."
- **Definition of done:** `/onboarding/start-fresh` renders with three steps. CTA navigates to `/onboarding/connect`. Data sovereignty statement is clearly visible above the connect options on `/onboarding/connect`.
- **Status:** [ ]

---

### Step 10.3 — Onboarding sync waiting page (/onboarding/sync)
- **Depends on:** 4.3, 4.9, 6.9
- **Build:** Create `src/app/(dashboard)/onboarding/sync/page.tsx`. This page has no server-side data fetch — it is a client component that polls for completion. **Polling mechanism:** every 3 seconds, call `GET /api/connections` and check `connections[0].syncStatus`. When `syncStatus === 'success'`, begin a second poll: call `GET /api/intelligence/feed?limit=1` every 3 seconds. Once the intelligence feed returns a response (either findings OR an empty array with `meta.lastIntelligenceRunAt` non-null), navigate to `/onboarding/first-brief`. This two-phase polling ensures the user lands on the first-brief screen after both the sync AND the intelligence run have completed. **Timeout:** if neither condition is met after 90 seconds total, show the failure state: "Import didn't complete. [Retry] [Continue — I'll scan with what's available]." "Continue" navigates to `/onboarding/first-brief` immediately. **Dynamic text:** cycle through "Importing your transaction history..." → "Reading your AR aging..." → "Analyzing expense patterns..." → "Running first intelligence scan..." every 5 seconds.
- **Definition of done:** After completing OAuth and triggering a sync, the user lands on `/onboarding/sync`. The page polls for `syncStatus === 'success'` from `GET /api/connections`. After sync completes and intelligence engine produces its first run record (`lastIntelligenceRunAt` non-null in the connections response), the page redirects to `/onboarding/first-brief`. The `/onboarding/first-brief` page shows at least one finding OR the healthy state — not an empty loading state.

---

### Step 10.4 — First intelligence brief screen
- **Depends on:** 8.1, 10.2, 10.3
- **Build:** Create `src/app/(dashboard)/onboarding/first-brief/page.tsx`. Fetches up to 3 findings from `GET /api/intelligence/feed`. Shows: "Here's what I found in your first scan" + finding cards (or healthy state if none). Below: "Your data lives in QuickBooks — not here. If you cancel, your books are unchanged." Primary CTA: "Go to Intelligence Feed →". Secondary CTA (if ≥ 60 days data): "View Cash Flow Projection →". Because Step 10.3 ensures the intelligence run has completed before the user reaches this page, the feed will always return either findings or the healthy empty state — never a loading state.
- **Definition of done:** Complete the full onboarding through sync. The page renders before `/dashboard`. Finding cards (or healthy state) appear. Data sovereignty text is present.
- **Status:** [ ]

---

### Step 10.5 — Data & Privacy section in settings and data export endpoint
- **Depends on:** 2.6
- **Build:** In `src/app/(dashboard)/settings/account/page.tsx`, add "Data & Privacy" section: read-only access summary + "Download your data" button. Implement `GET /api/data/export` endpoint (specification in BACKEND_STRUCTURE Section 3 Data Export Endpoints). The endpoint zips: all reports (PDF + JSON), full conversation history (JSON), all findings history (JSON), all action drafts (JSON), and a README.txt. Rate-limited to one export per org per hour.
- **Definition of done:** Navigate to `/settings/account`. "Download your data" triggers a file download. The downloaded zip contains `reports/`, `conversations/`, `findings/`, `action_drafts/`, and `README.txt` directories/files. Clicking the button a second time within one hour returns a `429` response with a "Try again after [time]" message.
- **Status:** [ ]

---

## Phase 11: Reactive Q&A Interface

End state: `/ask` has a context-aware empty state, streaming responses work, conversation history is accessible.

---

### Step 11.0 — AI provider setup (Gemini free tier)
- **Depends on:** 1.3
- **Build:** Get Google AI Studio API key (free). Add `GOOGLE_AI_API_KEY` to `.env.local`. Set `AI_PROVIDER=google`. Install `ai@4.2`, `@ai-sdk/anthropic@1.1`, `@ai-sdk/google@1.1`, `@anthropic-ai/sdk@0.32`. Verify `getModel()` from Step 6.1 returns Gemini when `AI_PROVIDER=google`.
- **Definition of done:** Test script calls `getModel()` + `streamText()` with "What is 2+2?" → answer streams to stdout at $0 cost.
- **Status:** [ ]

---

### Step 11.1 — System prompt, guardrails, and streaming handler
- **Depends on:** 5.8, 11.0
- **Build:** Create `src/lib/ai/prompts/system.ts` with `buildSystemPrompt(orgId)` (under 10,000 tokens). The system prompt must include: (a) the org's financial context from `buildFinancialContext()`, (b) the role/prohibition instructions, and (c) the **currency formatting instruction** from FRONTEND_GUIDELINES.md Section 8.1.1 — instruct the AI to always format monetary values as `$1,234.56` (comma-separated, two decimal places, Unicode minus for negatives). This ensures AI-generated text matches the `formatCurrency()` output used by UI components. Create `src/lib/ai/guardrails/financial-advice.ts` with `checkGuardrails(question)`. Create `src/lib/ai/streaming/handler.ts` with `handleFinancialQuery()` — appends disclaimer as final text chunk.
- **Definition of done:** `buildSystemPrompt()` contains real financial numbers and includes the currency formatting instruction text. Guardrail unit tests: "Should I take out a loan?" → flagged; "What are my top expenses?" → not flagged. A test call to the AI asking "what is $45000 + $12500?" produces a response with `$57,500.00` format (with comma and decimals). `pnpm vitest run` passes.
- **Status:** [ ]

---

### Step 11.2 — Context-aware /ask empty state
- **Depends on:** 6.10
- **Build:** Create `src/app/(dashboard)/ask/page.tsx`. Empty state is context-aware: if active high/critical finding exists → shows finding headline + "Want to talk through your options?" + auto-submit CTA; if `?finding_id=[id]` param → context block pre-loaded, question auto-submitted; if healthy → four standard question chips. Pre-create a conversation on page load via `POST /api/conversations`.
- **Definition of done:** With active critical finding → finding headline appears in empty state. With `?finding_id=[id]` → question auto-submits. With no findings → healthy chips appear.
- **Status:** [ ]

---

### Step 11.3 — Messages API endpoint and streaming rendering
- **Depends on:** 11.1, 6.7, 3.5
- **Build:** Before implementing the messages route, create three support modules that the route will import (these are in the folder structure but have no prior creation step):
  1. `src/lib/billing/quota.ts` — exports `checkAndIncrementQuota(orgId, db)`: acquires a row lock on the `subscriptions` row, checks `queries_used_this_period >= queries_limit`, increments if allowed, returns `{ allowed: boolean, queriesRemaining: number }`. The lock must be released whether the check passes or fails.
  2. `src/lib/ai/prompts/financial-qa.ts` — exports `buildFinancialQAPrompt(orgId, question)`: constructs the user-turn prompt from the financial context. Wraps `buildFinancialContext(orgId)` from Step 5.8 and formats the question for the Q&A handler.
  3. `src/lib/ai/context/history.ts` — exports `loadConversationHistory(conversationId, limit = 20)`: loads the most recent N messages for a conversation, trims to the last 20, and returns them formatted for the AI SDK's `messages` array.
  Then implement `src/app/api/conversations/[id]/messages/route.ts`. Processing order: session → `checkAndIncrementQuota()` (row lock) → rate limit (Upstash, install `@upstash/redis@1.34`, `@upstash/ratelimit@2.0`) → guardrails → `loadConversationHistory()` → `buildFinancialQAPrompt()` → stream via `getModel()`. Set `X-Queries-Remaining` response header. The `useChat` hook uses the pre-created conversation ID — **never a literal `:id` string**. Wire chat input, message rendering (`AIResponse.tsx` with disclaimer), quota exhaustion state.
- **Definition of done:** `src/lib/billing/quota.ts`, `src/lib/ai/prompts/financial-qa.ts`, and `src/lib/ai/context/history.ts` all exist with their exported functions. Submit a question. SSE stream appears. `messages` table contains both question and AI answer with disclaimer. `query_log` shows `success=true`. `X-Queries-Remaining` header is present in the response. The conversation UUID is in the API URL (verify in Network tab — no literal `:id`).
- **Status:** [ ]

---

### Step 11.4 — Conversation history and 12-month cleanup
- **Depends on:** 11.3
- **Build:** Implement `GET /api/conversations`, `GET /api/conversations/:id`, `GET /api/conversations/export`. Create `src/app/(dashboard)/conversations/page.tsx` (list with search, org-wide label, export button) and `/conversations/[id]/page.tsx` (full Q&A, disclaimer, "Ask a follow-up", "Copy answer"). Add nightly cleanup job in `jobs/billing/reset-quotas.ts`: deletes messages older than 12 months and orphaned conversations.
- **Definition of done:** Ask two questions. Both appear in `/conversations`. Single view renders full Q&A. Seeding 13-month-old messages + triggering cleanup job removes them.
- **Status:** [ ]

---

## Phase 12: Xero Integration

End state: Xero sandbox account connectable, transactions synced, displayed identically to QuickBooks data.

---

### Step 12.0 — Xero developer app, OAuth, import, and normalization
- **Depends on:** 4.0
- **Build:** Register at `developer.xero.com`. Create Xero Sandbox app. Add `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET` to `.env.local`. Install `xero-node@9.3`. Create `src/lib/integrations/xero/auth.ts`. Create `initiate/route.ts` and `callback/route.ts` (enforces QB/Xero mutual exclusivity — returns 409 if QB connection active). Create `src/lib/integrations/xero/import.ts` and `normalize.ts`. Write unit tests.
- **Definition of done:** Complete Xero OAuth. `connections` row with `provider='xero'`. `transactions` rows with `source_system='xero'`. Attempting to connect Xero when QB is active returns 409. `pnpm vitest run src/lib/integrations/xero/normalize.test.ts` passes.
- **Status:** [ ]

---

### Step 12.1 — Xero sync + connections settings page
- **Depends on:** 12.0, 4.9
- **Build:** Update `jobs/sync/single-org.ts` to branch on `provider='xero'` → calls `importXeroTransactions`. Create `src/app/(dashboard)/settings/connections/page.tsx` showing active connection card (QB or Xero) with status, last sync, last intelligence run. Both options visible; inactive one greyed with "Disconnect [current] first to switch."
- **Definition of done:** Trigger `sync-fan-out` with Xero connection. `financial_snapshots` updated with Xero data. `/settings/connections` shows the Xero connection card.
- **Status:** [ ]

---

## Phase 13: Reports and Billing

End state: Stripe billing and monthly reports work end-to-end.

---

### Step 13.0 — Stripe setup, Checkout, webhook, and portal
- **Depends on:** 1.0
- **Build:** Create Stripe account (test mode). Create "Starter" ($99/mo, 500 queries) and "Growth" ($199/mo, 2000 queries) products. Add all Stripe env vars. Install `stripe@16.12`, `@stripe/stripe-js@4.5`. Create `src/lib/billing/stripe.ts` (Stripe client singleton). Create `src/lib/billing/webhooks.ts` (exports `processStripeEvent(event)`: handles `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed` — updates `subscriptions` table with correct `plan_tier` and `queries_limit` values: Trial=20, Starter=500, Growth=2000). Implement `POST /api/billing/checkout` (imports from `stripe.ts`), `POST /api/webhooks/stripe` (imports from `webhooks.ts`), `GET /api/billing/portal`. Create `/settings/billing` page.
- **Definition of done:** Stripe CLI test checkout with card `4242...`. `subscriptions.plan_tier='starter'`, `queries_limit=500`. Stripe CLI shows 200 from webhook. `src/lib/billing/stripe.ts` and `src/lib/billing/webhooks.ts` both exist as importable modules.
- **Status:** [ ]

---

### Step 13.1 — Monthly quota reset job and quota warning UI
- **Depends on:** 13.0, 2.3, 11.3
- **Build:** Implement `resetMonthlyQuotas` in `jobs/billing/reset-quotas.ts` (cron `'0 0 1 * *'`). In `ask/page.tsx`: read `x-queries-remaining` response header. At 80% → non-blocking banner. At 100% → quota-exhausted system message with upgrade CTA.
- **Definition of done:** Trigger reset job → `queries_used_this_period` resets to 0. Set `queries_limit=10`, `queries_used_this_period=8` → warning banner appears. At 10/10 → quota-exhausted message appears.
- **Status:** [ ]

---

### Step 13.2 — Monthly report generation, delivery, and export
- **Depends on:** 5.0, 11.0
- **Build:** Create `src/lib/ai/prompts/report.ts` with `buildReportPrompt()`. Implement `jobs/reports/monthly.ts` (cron `'0 6 1 * *'`) + `generate-single-report` event-triggered function. Uses `getModel()` — **never hardcoded**. Report email must include the financial disclaimer footer. Implement `POST /api/reports/generate`, `GET /api/reports`, `GET /api/reports/:id`, `GET /api/reports/:id/export?format=csv|pdf`. Install `@react-pdf/renderer@4.1`.
- **Definition of done:** Generate a report. `plain_text_summary` is 250–400 words. Email received with disclaimer in footer. CSV export opens in spreadsheet with numeric amounts. PDF is under 200KB.
- **Status:** [ ]

---

## Phase 14: Polish

End state: all edge cases, loading states, and error states implemented.

---

### Step 14.0 — Alerts historical archive page (/alerts) and GET /api/intelligence/findings endpoint
- **Depends on:** 6.11, 7.2
- **Build:** First implement `src/app/api/intelligence/findings/route.ts` (`GET`) — this is the multi-status archive endpoint, distinct from `GET /api/intelligence/feed` (which returns only active findings). It accepts query params: `status` (default: `all`), `finding_type`, `severity`, `startDate`, `endDate`, `cursor`, `limit`. It is the data source for the `/alerts` page. Then create `src/app/(dashboard)/alerts/page.tsx` fetching from this new endpoint. Renders filter controls (severity, type, status, date range). "Take action" → `AgenticModal`. "Configure alerts →" → `/settings/notifications`. Empty state: "No findings yet. Your first intelligence scan runs after your first QuickBooks sync."
- **Definition of done:** `GET /api/intelligence/findings?status=dismissed` returns dismissed findings. `GET /api/intelligence/findings?status=active` returns the same set as `GET /api/intelligence/feed`. Dismissed findings appear in `/alerts` but not in `/dashboard`. Filter by severity reduces the list correctly.
- **Status:** [ ]

---

### Step 14.1 — Notification preferences and QBO token expiry
- **Depends on:** 3.6, 7.7
- **Build:** Create `src/app/(dashboard)/settings/notifications/page.tsx`. Shows four finding type rows. Email delivery rule shown as information block (non-configurable). "Opt out of all email" toggle. Implement `GET /api/alert-configs` and `PATCH /api/alert-configs/:alertType`. Also implement QBO token expiry mid-session behavior: persistent amber banner on all authenticated screens when `sync_status='auth_expired'`. If mid-agentic-modal: preserve draft in state, show banner, offer "Reconnect QuickBooks."
- **Definition of done:** Toggle expense spike alert off → next intelligence run generates no expense spike findings. Set `connections.sync_status='auth_expired'` → amber banner appears on all authenticated pages.
- **Status:** [ ]

---

### Step 14.2 — 14-day medium finding suppression and privacy/ToS pages
- **Depends on:** 8.0
- **Build:** After 14 days of active use with zero actions/dismissals: suppress MEDIUM findings from Intelligence Feed, show one-time prompt ("Medium-priority findings moved to Alerts archive"). Critical/High never suppressed. Create `src/app/(auth)/terms/page.tsx` (includes "Not Financial Advice" and "Data Sovereignty" sections) and `src/app/(auth)/privacy/page.tsx`. Both linked from consent checkbox, footer disclaimer, and settings Data & Privacy section.
- **Definition of done:** Simulate 14-day inaction. Medium findings disappear from feed; prompt appears. Critical/High remain. `/terms` has both required sections. Both pages accessible without authentication.
- **Status:** [ ]

---

## Phase 15: Pre-Launch

End state: security audit passes, performance verified, deployed to production, smoke test complete.

---

### Step 15.0 — Cross-org RLS isolation test suite
- **Depends on:** 3.9
- **Build:** Create `src/__tests__/security/rls-isolation.test.ts`. Two test orgs, two users. Inserts data into Org A. As User B: asserts 0 rows returned for all 21 org-scoped tables including all four new V2 tables. INSERT into Org A as User B is rejected.
- **Definition of done:** `pnpm vitest run src/__tests__/security/rls-isolation.test.ts` passes all assertions including `intelligence_runs`, `findings`, `action_drafts`, `cash_flow_projections`.
- **Status:** [ ]

---

### Step 15.1 — Token encryption and API auth audit
- **Depends on:** 4.1
- **Build:** `src/__tests__/security/token-encryption.test.ts` (round-trip, per-call uniqueness, tamper detection, no plaintext tokens in DB). `src/__tests__/security/api-auth.test.ts` covering every endpoint including all five new V2 endpoints — unauthenticated returns 401.
- **Definition of done:** Both files pass. All five new endpoints (`/api/intelligence/feed`, `/api/intelligence/findings/:id/dismiss`, `/api/intelligence/findings/:id/draft-action`, `/api/intelligence/actions/:id`, `/api/cashflow/projection`) return 401 without a session.
- **Status:** [ ]

---

### Step 15.2 — Intelligence engine accuracy review
- **Depends on:** 6.12
- **Build:** Create `scripts/benchmark-intelligence-accuracy.ts`. Seeds 5 test orgs: (1) clear cash shortfall, (2) expense spike, (3) AR aging anomaly, (4) duplicate subscription, (5) healthy. Runs full intelligence engine for each. Asserts: orgs 1–4 generate the expected finding type; org 5 generates zero findings.
- **Definition of done:** `pnpm tsx scripts/benchmark-intelligence-accuracy.ts` passes all 5 assertions.
- **Status:** [ ]

---

### Step 15.3 — Vercel timeout compliance and performance benchmark
- **Depends on:** 6.9
- **Build:** Create `src/__tests__/intelligence/step-timing.test.ts`. Mocks DB calls. Measures computation + AI call time per step. Asserts all five steps complete in under 8 seconds in isolation. Create `scripts/benchmark-financial-queries.ts` with 10,000 transactions: measures summary, cash flow projection, intelligence feed, and transaction list response times.
- **Definition of done:** Step timing test passes — all five steps under 8 seconds. Financial summary and intelligence feed under 500ms. Cash flow projection under 2 seconds. All measured against Supabase free tier.
- **Status:** [ ]

---

### Step 15.4 — Disclaimer audit and production deployment
- **Depends on:** 15.3
- **Build:** Create `src/__tests__/compliance/disclaimer-presence.test.ts` (all AI surfaces include disclaimer, report emails include disclaimer footer, intelligence brief emails include disclaimer footer). Create production Supabase project. Run migrations. Apply RLS SQL. Deploy to Vercel with production environment variables. Set `cron-job.org` ping. Set `AI_PROVIDER=anthropic` and add production Anthropic API key.
- **Definition of done:** Compliance test passes. Production URL loads landing page. `/api/auth/me` without session returns 401. All 21 tables in production Supabase. `pnpm db:migrate` shows "No pending migrations."
- **Status:** [ ]

---

### Step 15.5 — Production smoke test
- **Depends on:** 15.4
- **Build:** Run the complete journey on production: (1) register → magic link → click; (2) standard onboarding → connect QB sandbox → sync; (3) `/dashboard` intelligence feed renders (or healthy state); (4) `/cashflow` projection renders; (5) trigger a draft → modal opens → copy works; (6) ask a question in `/ask`; (7) generate a report → email received; (8) check `/settings/billing` → trial tier shown.
- **Definition of done:** All 8 steps complete on production without errors. No 500 errors in Vercel logs. Intelligence brief email received. Stripe test checkout completes.
- **Status:** [ ]

---

*End of IMPLEMENTATION_PLAN.md v0.2. Replaces v0.1 entirely.*

*Structural changes from V1:*
- Cash flow projection → Phase 5 (was Phase 8+; now P0)
- Phase 6 (Proactive Intelligence Engine) is new — 13 steps with three non-negotiable constraints
- Phase 9 (Agentic Execution Layer) is new — 5-state draft-and-approve modal flow
- Phase 10 (Bench Refugee Onboarding) is new — migration check, refugee flow, CSV upload, data sovereignty
- Alert detection merged into Phase 6 (intelligence engine subsumes the alert system)
- Total: 136 steps (vs 114 in V1)
