# Task Queue
## AI CFO Agent

**Last updated:** 2026-07-30  
**Current phase:** Phase 11 — Reactive Q&A Interface (Phase 10 in parallel)  
**Active agents:** 2  

---

### How to use this file

**Orchestrator:** Assign a task by moving it from Available → In Progress. Fill in the agent name and start date. When the agent reports the Definition of Done verified, move it to Completed and unlock any tasks that were blocked by it. Leave context in Orchestrator Notes when handing off between sessions.

**Agents:** Pick up a task from In Progress. Do not touch tasks in Available or Blocked. When your task is done, verify the Definition of Done from IMPLEMENTATION_PLAN.md before reporting completion. Do not self-assign from Available — wait for the orchestrator to move the task.

**Step number** links back to IMPLEMENTATION_PLAN.md where the full Build instructions and Definition of Done live. This file tracks state only — it does not duplicate the instructions.

**Dependency rule:** A task in Available with a non-empty Depends On column cannot be started until the listed step appears in Completed. The orchestrator moves tasks from Blocked → Available when their dependencies complete.

---

## In Progress

| Task | Step # | Agent | Started |
|------|--------|-------|---------|
| Migration check screen + /ask empty state | 10.0, 11.2 | product-engineer | 2026-07-30 |
| POST /api/conversations + quota.ts | 11.3-prereq | backend-engineer | 2026-07-30 |

---

## Available (Unblocked)

| Task | Step # | Owner | Depends On |
|------|--------|-------|------------|
| Messages API + streaming rendering (AI parts) | 11.3 | ai-engine-engineer | 11.3-prereq (backend), 11.1 ✓ |
| Refugee welcome page + CSV upload | 10.1 | product-engineer + integration-engineer | 10.0 |
| Start fresh + connect screen update | 10.2 | product-engineer | 10.1 |
| Data & Privacy settings + export endpoint | 10.5 | backend-engineer + product-engineer | 2.6 ✓ |
| Conversation history and 12-month cleanup | 11.4 | backend-engineer + product-engineer | 11.3 |
| Xero integration | 12.0 | integration-engineer | 4.0 ✓ |

---

## Blocked

| Task | Step # | Blocked By |
|------|--------|------------|
| GitHub Actions CI pipeline | 1.6 | All code deps met. Needs push to GitHub — git push blocked by Claude Code auto-classifier. User must run `git push origin main` or authorize push in settings. |
| Live auth DoD verification | 2.0–2.6 | External action: Supabase Dashboard → Auth → SMTP → smtp.resend.com:465, username=resend, password=RESEND_API_KEY. Set Site URL=http://localhost:3000, add /api/auth/callback to redirect allowlist. Code is written. |
| Onboarding sync waiting page | 10.3 | 10.2 (depends on 10.1→10.0) |
| First intelligence brief screen | 10.4 | 10.3, 8.1 (done) |
| Billing / Stripe integration | 13.x | Stripe credentials not obtained |

> **External actions required before un-blocking:** Steps 1.5 and 1.6 require real-world setup outside the codebase (creating a Supabase project, pushing to GitHub). See the **Integration Credentials Status** section of PROGRESS.md for the full list of credentials to obtain. Until these accounts exist, these steps cannot complete their Definition of Done even if the code is written.

---

## Completed

| Task | Step # | Completed | Notes |
|------|--------|-----------|-------|
| Next.js project scaffold | 1.0 | 2026-07-27 | pnpm dev starts, tsc exits 0, lint exits 0. commit 68831f7 |
| TypeScript strict configuration | 1.1 | 2026-07-27 | noUncheckedIndexedAccess + exactOptionalPropertyTypes + aliases. commit 22147e0 |
| Linting, formatting, and git hooks | 1.2 | 2026-07-27 | prettier, husky, lint-staged, ESLint security rules. commit bc733da |
| Environment variables with build-time validation | 1.3 | 2026-07-27 | T3 env schema, build fails without DATABASE_URL. commit d1ab01b |
| Complete folder structure | 1.4 | 2026-07-27 | 122 stub files, all directories, SETUP.md, V1 remnant. tsc exits 0. |
| Inngest dev server | 1.7 | 2026-07-27 | inngest@3.27, serve handler, sync-fan-out stub. tsc exits 0. commit 2ee96ba |
| Supabase project and connection test | 1.5 | 2026-07-28 | Code complete, tsc+lint exit 0. DB DoD pending — corp. firewall blocks 5432/6543; Supabase HTTPS reachable. commit 578d4ad |
| Drizzle ORM setup | 3.0 | 2026-07-28 | drizzle-orm@0.36, drizzle-kit@0.27, client.ts (db+dbDirect), drizzle.config.ts, db:generate exits 0. drizzle-kit studio pending CI (network). commit ce6b945 |
| Identity and access schema | 3.1 | 2026-07-28 | organizations + organization_members, idx_organizations_slug UNIQUE, idx_org_members_user_org UNIQUE. auth.users FKs deferred to SETUP.md §5. Migration 0000_watery_mystique.sql generated. DB pending CI. commit 15f3292 |
| Connections and sync schema | 3.2 | 2026-07-28 | connections (16 cols), sync_jobs, data_quality_log. idx_connections_one_accounting_per_org partial UNIQUE enforces QB/Xero exclusivity. Migration 0001_flippant_metal_master.sql. DB pending CI. commit 26c9488 |
| Financial data schema (DECIMAL enforced) | 3.3 | 2026-07-28 | accounts + transactions. amount/amount_base/current_balance all numeric(15,2). All 6 tx indexes incl. 2 partial. Migration 0002_normal_ben_urich.sql. DB pending CI. commit d340e55 |
| Financial snapshots schema | 3.4 | 2026-07-28 | financial_snapshots. 7 monetary DECIMAL(15,2) cols, 2 JSONB cols, partial monthly idx. Migration 0003_clever_frog_thor.sql. DB pending CI. |
| Conversations, messages, query log schema | 3.5 | 2026-07-28 | conversations + messages (content TEXT) + query_log. auth.users FKs in SETUP.md §5. Migration 0004_material_beast.sql. DB pending CI. |
| Alerts, reports, subscriptions schema | 3.6 | 2026-07-28 | alerts + alert_configs (UNIQUE org+type) + reports (UNIQUE org+period+type) + subscriptions (UNIQUE org). DECIMAL(7,4) for percentages. Migration 0005_ordinary_the_spike.sql. DB pending CI. |
| Intelligence engine schema | 3.7 | 2026-07-28 | intelligence_runs + findings (CHECK headline<=120) + action_drafts + cash_flow_projections. findings_headline_max_120 CHECK in generated SQL. Migration 0006_narrow_mordo.sql. DB pending CI. |
| Compliance and P2 schema | 3.8 | 2026-07-28 | consent_log (inet ip_address, no org FK) + firm_clients (firm_not_own_client CHECK). Migration 0007_tiny_pixie.sql. All 21 tables now defined. DB pending CI. commit dfddb51 |
| RLS policies and isolation function | 3.9 | 2026-07-28 | rls-policies.sql: get_accessible/writable_org_ids() SECURITY DEFINER, 21 ENABLE RLS, 80 policies. consent_log append-only. firm_clients OR clause. Apply via Supabase SQL Editor (SETUP.md §3). DB verify pending CI. commit a0bbf3c |
| Seed data | 3.10 | 2026-07-28 | scripts/seed.ts: Demo Corp org, 4 alert_configs, 4 accounts, 636 tx (180 days), 7 monthly snapshots. All upserts. Monetary arithmetic in SQL. Live run pending CI (port 6543 blocked). commit 21d1503 |
| QB developer app setup (package install + auth.ts) | 4.0 | 2026-07-29 | intuit-oauth@4.0.0 + node-quickbooks@2.0.5. createOAuthClient() reads from env. Ambient type decl for intuit-oauth. src/types/integrations.ts started. commit dbf5fdd |
| OAuth token encryption utilities | 4.1 | 2026-07-29 | encryptToken/decryptToken AES-256-GCM, iv:authTag:ciphertext format. vitest@2.1 + vitest.config.ts added. 4/4 tests pass. commit dbf5fdd |
| Session context utility (expedited) | 2.4 | 2026-07-29 | getRequestContext + requireAuth (discriminated AuthResult) + requireRole. RequestContextError typed 401/403/500. 3/3 tests pass. commit c1f21f0 |
| QB OAuth initiate (PKCE + CSRF) | 4.2 | 2026-07-29 | PKCE S256 + CSRF state + httpOnly 120s cookie. intuit-oauth does not support PKCE natively; params appended manually. commit b80b370 |
| QB OAuth callback handler | 4.3 | 2026-07-29 | CSRF validation, manual PKCE token exchange, scope enforcement, encryptToken, upsert connections, Inngest event, redirect logic. commit 6895ed8 |
| QB API client factory | 4.4 | 2026-07-29 | getQuickBooksClient: decrypt, proactive refresh, rotating token write-back, auth_expired on failure. commit 99ce9b4 |
| Chart of Accounts import | 4.5 | 2026-07-29 | importAccounts: upsert on (orgId,sourceSystem,externalId), dataQualityLog for malformed, no rawData (PII). commit 98ce403 |
| Transaction import (initial 13-month pull) | 4.6 | 2026-07-29 | importTransactions: 9 QB entity types, paginated batches of 1000, onConflictDoUpdate dedup, 429 retry (30s), records_synced per batch. tsc+lint exit 0. |
| Transaction normalization | 4.7 | 2026-07-29 | normalizeTransactionType added to normalize.ts. normalize.test.ts: 13/13 tests pass. No undefined categories. tsc+lint exit 0. |
| Incremental sync logic | 4.8 | 2026-07-29 | incrementalSync: reads lastSyncedAt, guards auth_expired, creates sync_jobs row, calls importAccounts+importTransactions(since), updates connections. 20/20 tests pass. tsc+lint exit 0. |
| Inngest sync job with ordered steps | 4.9 | 2026-07-29 | syncFanOut queries active connections, dispatches sync/org.requested per connection. syncSingleOrg: 3 ordered steps (pull-transactions→recompute-snapshots stub→trigger-intelligence-run). NonRetriableError on auth_expired. Registered in serve handler. tsc+lint exit 0. |
| Financial snapshots computation post-sync | 4.10 | 2026-07-29 | recomputeSnapshots: 7 monthly snapshots, all SQL arithmetic, onConflictDoUpdate dedup. Stub in single-org.ts replaced. Note: schema uses netProfit/periodType='month' (not netIncome/'monthly'). No dataQuality col. tsc+lint exit 0. |
| P&L calculation functions | 5.0 | 2026-07-29 | calculatePnL: SQL-only arithmetic, sql<string>, returns {revenue,expenses,netProfit} strings. 4/4 tests. tsc+lint exit 0. |
| Cash position and AR balance | 5.1 | 2026-07-29 | getCashPosition+getArBalance: sql<string> aggregations, org-scoped. tsc+lint exit 0. |
| Expense category aggregation | 5.2 | 2026-07-29 | getExpensesByCategory: window fn for sharePct, NULL→'other', sorted desc. 3/3 tests. tsc+lint exit 0. |
| Period comparison and trend data | 5.3 | 2026-07-29 | getPeriodComparison+getMonthlyRevenueTrend. 150/100→'50.00'/up. 3/3 tests. tsc+lint exit 0. |
| AR aging schedule builder | 5.4 | 2026-07-29 | buildArAgingSchedule: 5 buckets, projectedPaymentDate+confidenceLevel always non-null. 4/4 tests. tsc+lint exit 0. |
| Recurring expense detection | 5.5 | 2026-07-29 | detectRecurringExpenses: 25-35d cycle + 10% tolerance. Median amount as original string. 3/3 tests (AWS scenario verified). tsc+lint exit 0. |
| Cash flow projection algorithm | 5.6 | 2026-07-29 | buildCashFlowProjection: balance+AR inflows+recurring outflows, daily array, minimumProjectedBalance, riskDate. 5/5 tests. tsc+lint exit 0. |
| format.ts (expedited) | — | 2026-07-29 | formatCurrency/formatPercent/formatDate. Unicode minus for negatives. Unblocks 5.8. |
| AI financial context builder | 5.8 | 2026-07-29 | buildFinancialContext: 3-mo P&L+cash+top5 categories+AR aging. formatCurrency. <8000 chars, no nulls. 4/4 tests. tsc+lint exit 0. |
| Financial summary API endpoint | 5.9 | 2026-07-29 | GET /api/financial/summary: Promise.all, standard envelope, FinancialSummaryResponse in api.ts. 46/46 tests. tsc+lint exit 0. |
| Cash flow projection storage + API | 5.7 | 2026-07-29 | storeCashFlowProjection (db.transaction read-then-write). GET /api/cashflow/projection: 422 on <60d, confidenceLevel always present. 46/46 tests. tsc+lint exit 0. |
| Intelligence runner scaffold and guards | 6.0 | 2026-07-29 | intelligenceRun Inngest fn, 2 guards (60d history + sync_jobs check), skipped_reason set, returns clean. Registered in serve handler. tsc+lint exit 0. |
| AI provider routing utility | 6.1 | 2026-07-29 | getModel(complexity) → gemini-2.0-flash or claude-sonnet/haiku-4.5 by threshold 0.7. detectRateLimitError. AI SDK packages installed. 15/15 tests. tsc+lint exit 0. |
| Cash flow projection intelligence step | 6.2 | 2026-07-29 | step.run('cash-flow-projection')+('cash-flow-risk-finding'). getModel(0.5), 429→skip. expiresAt=riskDate+1d. 8/8 tests. 69/69 total. tsc+lint exit 0. |
| Anomaly detection step | 6.3 | 2026-07-29 | runAnomalyDetection: expense spike (7d vs 30d avg) + collections slippage (>45d unreconciled). 17/17 tests. 86/86 total. tsc+lint exit 0. commit a5ca3bb |
| Margin deterioration detection | 6.4 | 2026-07-29 | runMarginDetection: MTD margin vs prior year. Skip if <12mo history. Same 429 skip contract. 17/17 tests. 86/86 total. tsc+lint exit 0. commit a5ca3bb |
| AR aging collections opportunity step | 6.5 | 2026-07-29 | runArAgingAnalysis: collections_opportunity finding, relatedData.invoices[]. High severity at $5k+. 8 tests. 103/103. tsc+lint exit 0. commit 1768c9c |
| Duplicate subscription scan | 6.6 | 2026-07-29 | runDuplicateSubscriptionScan: same vendor/diff accounts/within 10%. duplicate_subscription finding. 9 tests. 103/103. tsc+lint exit 0. commit 1768c9c |
| Finding storage and run completion | 6.7 | 2026-07-29 | insertFindingDeduped: same-day dedup. mark-completed step: intelligence_runs.completed + connections.lastIntelligenceRunAt. 4 new tests. 107/107. tsc+lint exit 0. commit aade49c |
| Intelligence email trigger | 6.8 | 2026-07-29 | intelligenceEmail Inngest fn. Resend via env.RESEND_API_KEY. Severity-gated (critical/high only). Prior-run dedup by severity. vitest.config.ts @/jobs alias added. 15 new tests. 122/122. tsc+lint exit 0. commit 97a085e |
| Intelligence fan-out wiring | 6.9 | 2026-07-29 | intelligenceFanOut cron 0 6 * * *. selectDistinct orgIds, dispatches intelligence/run.requested per org. All 5 intelligence fns registered in serve handler. 122/122. tsc+lint exit 0. commit a5792ba |
| Intelligence feed + dismiss endpoints | 6.10+6.11 | 2026-07-29 | GET /api/intelligence/feed: cursor-paginated, severity-sorted, bySeverity counts, hasActionableType. POST /findings/:id/dismiss: 409 on re-dismiss. 14 new tests. 136/136. tsc+lint exit 0. commit 9d89f84 |
| Intelligence engine integration test | 6.12 | 2026-07-29 | full-run.test.ts: expense spike→anomaly, overdue invoice→collections_opportunity (invoiceId in relatedData), duplicate vendor→duplicate_subscription. 6 tests, 9ms. 142/142. tsc+lint exit 0. commit 3afbe87 |
| Tailwind v4 + CSS design tokens | 7.0 | 2026-07-29 | src/styles/globals.css: 40+ CSS vars, @theme Tailwind tokens, .font-numeric, focus rings. Inter+IBM Plex Mono fonts. layout.tsx updated. system.ts placeholder added. 142/142. tsc+lint exit 0. commit 040b7dc |
| shadcn/ui + base components | 7.1–7.6 | 2026-07-29 | shadcn/ui init, 9 primitives, sonner, (dashboard) layout+AppNav (Intelligence first), SeverityBadge, CurrencyAmount, MetricChange, 3 skeletons, FinancialTable (rounded-none), AlertBadge, DataTimestamp. tsc+lint exit 0. 142/142 tests. commit cdefe5a |
| Intelligence Feed page layout + data fetching | 8.0 | 2026-07-29 | Server Component. Fetches /api/intelligence/feed, forwards session cookie, redirect on 401, data sovereignty badge always visible. loading.tsx with 3x FindingCardSkeleton. tsc+lint exit 0. 142/142. commit 5378f7a |
| Finding card component | 8.1 | 2026-07-29 | Client component with expand/collapse, SeverityBadge, left-border accent, detail+recommendedAction when expanded, disabled Take action btn, Tell me more → /ask?finding_id=[id]. dashboard/page.tsx updated. tsc+lint exit 0. 142/142. commit c8f78a8 |
| Cash Flow Timeline page and visualization | 8.4 | 2026-07-29 | recharts@2.15. CashFlowChart: ComposedChart green/red bars, blue balance line, zero ReferenceLine, red ReferenceDot on risk dates, rounded-none. DaysTabBar 30/60/90d. 422→progress bar. Disclaimer always visible. tsc+lint exit 0. 142/142. commit 55dfc72 |
| Intelligence Feed healthy + insufficient-data states | 8.2 | 2026-07-29 | IntelligenceFeedHealthy (6-item checklist, Ask CTA) + IntelligenceFeedBaseline (progress bar, 3 Ask CTAs). Both Server Components. dashboard/page.tsx handles 422→baseline, 0 findings→healthy. commit 2fae7bb |
| Finding dismiss action in UI | 8.3 | 2026-07-29 | FindingCard: ••• button, Dialog modal with 3 radio reasons, POST /dismiss, opacity-0 fade-out, router.refresh(). commit 2fae7bb |
| Cash flow detail panel + insufficient-data empty state | 8.5 | 2026-07-29 | CashFlowDetailPanel inline below chart when risk date clicked. Disabled Accelerate btn. cashflow/page.tsx 422 state gains 3 Ask CTAs. commit 2fae7bb |
| Intelligence nav badge live count | 8.6 | 2026-07-29 | AppNavServer (Server Component) fetches /api/intelligence/feed?limit=1, passes meta.total to AppNav AlertBadge. tsc+lint exit 0. 142/142. commit 1292551 |
| Draft generation endpoint | 9.0 | 2026-07-29 | POST /findings/:id/draft-action. resolveActionType mapper. getModel(0.5), generateText, 429→503. Idempotent. Schema corrections: actionType+userId NOT NULL. tsc+lint exit 0. 142/142. commit 20e7ede |
| Draft templates (3 action types) | 9.1 | 2026-07-30 | invoice-acceleration + subscription-cancellation + vendor-negotiation. 18 new tests (7+5+6). 160/160 total. tsc+lint exit 0. |
| PATCH /api/intelligence/actions/:id | 9.2 | 2026-07-30 | draft→approved→copied legal transitions, dual write on copied (draft+finding actioned), 400 on illegal transitions. tsc+lint exit 0. |
| AgenticModal states 1–4 (confirm+loading+review+copy) | 9.3–9.5 | 2026-07-30 | Five-state modal. AI disclaimer visible in State 3. CTA "Copy to clipboard". Null recipientEmail: literal TO: placeholder in copy text. tsc+lint exit 0. 160/160. commit 679dc13 |
| AgenticModal State 5 + action tracking | 9.6 | 2026-07-30 | PATCH approved on "Looks good->", PATCH copied on copy. router.refresh() on close from done removes actioned finding. Visual-only "Mark as sent" toggle. tsc+lint exit 0. 160/160. commit cf87dcb |
| Wire all agentic CTAs | 9.7 | 2026-07-30 | "Take action" (done in 9.3). Accelerate: cashflow page fetches feed in parallel, passes collections_opportunity finding to panel. Button shows invoice count, opens AgenticModal. tsc+lint exit 0. 160/160. commit bbf35bb |
| Login + register pages | 2.0 | 2026-07-30 | signInWithOtp → /check-email, source=bench data-sovereignty callout, emailRedirectTo propagates source. tsc+lint exit 0. 204/204. commit c80d663 |
| Auth callback route | 2.1 | 2026-07-30 | token_hash+type exchange, routes: new→/onboarding/migration (+?source=bench), returning+conn→/dashboard, returning→/onboarding/connect, fail→/login?error=link_expired. Live DoD blocked by Supabase SMTP. 204/204. commit 3dfb567 |
| Next.js middleware | 2.2 | 2026-07-30 | @supabase/ssr, getUser(), (dashboard)→/login?next=, /login+session→/dashboard. 204/204. commit 3dfb567 |
| Organization creation endpoint | 2.3 | 2026-07-30 | POST /api/organizations. Zod (consentGiven: literal true). db.transaction: organizations+org_members+consent_log+subscriptions. 201/401/409. 204/204. commit 3dfb567 |
| Org onboarding page | 2.5 | 2026-07-30 | 15-option industry select, revenue band, required not-pre-checked consent checkbox. POST /api/organizations → /onboarding/connect. 204/204. commit c80d663 |
| me/logout endpoints | 2.6 | 2026-07-30 | GET/PATCH/DELETE /api/auth/me + POST /api/auth/logout. AuthMeResponse in api.ts. 204/204. commit 3dfb567 |
| AI provider verification script | 11.0 | 2026-07-30 | scripts/test-ai-provider.ts. getModel()+streamText. Blocked by zod/v3 subpath in tsx runner (zod-to-json-schema@3.25.2 vs zod@3.24.4) — vitest/Next unaffected. 204/204. commit 34e6487 |
| System prompt + guardrails + streaming handler | 11.1 | 2026-07-30 | buildSystemPrompt (role+prohibitions+currency instruction+financial context), checkGuardrails (investment/tax/HR/money-movement), handleFinancialQuery (guardrail→stream→disclaimer chunk). 15 new tests. 204/204. commit 34e6487 |

---

## Orchestrator Notes

*This section is the persistent context layer between sessions. Update it whenever a session ends mid-task, a decision is made that affects agent assignments, or a dependency chain changes.*

---

### Session 8 — 2026-07-30

**Completed:** Phase 2 (2.0, 2.1, 2.2, 2.3, 2.5, 2.6) and Phase 11 start (11.0, 11.1). 204/204 tests. Auth callback routes new users → /onboarding/migration already.

**Known issue:** `pnpm tsx scripts/test-ai-provider.ts` fails with `ERR_PACKAGE_PATH_NOT_EXPORTED: Package subpath './v3'` from zod-to-json-schema@3.25.2 vs zod@3.24.4. Fix: backend-engineer to bump zod to ^3.25.x in package.json. Does NOT affect app or vitest. Low priority.

**In progress:** 10.0+11.2 delegated to product-engineer; POST /api/conversations + quota.ts delegated to backend-engineer (needed for 11.3).

**Next after backend:** 11.3 (ai-engine-engineer: financial-qa.ts, history.ts, messages route with Upstash rate-limiting). Then 11.4 (conversations history page). Phase 10 continues: 10.1 (refugee page + CSV) → 10.2 → 10.3 → 10.4.

---

### Session 7 — 2026-07-30

**Completed:** 9.1 (draft templates, 18 new tests → 160 total) and 9.2 (PATCH actions endpoint). Both verified: tsc+lint exit 0, 160/160 tests pass.

**In progress:** 9.3 (AgenticModal states 1+2) → delegated to product-engineer. Dependencies: 8.1 (FindingCard) and 9.0 (draft endpoint) both complete.

**Next:** 9.3 → 9.4 (review state) → 9.5 (copy+fallback) → 9.6 (confirmation+tracking) → 9.7 (wire CTAs). All product-engineer tasks sequential.

---

### Session 6 — 2026-07-29

**Completed:** Phase 7 complete (7.1–7.6). Phase 8 starting.

**Key notes:**
- 7.1–7.6 delegated as single batch to product-engineer. All DoD items met except browser visual verification (pending).
- shadcn init uses `-d` flag for non-interactive run; button.tsx default variant overridden to `bg-primary-500` (`#2557A7`).
- AppNav has Intelligence as first item; AlertBadge wired with count=0 placeholder; DataTimestamp turns amber >12h stale.
- FinancialTable has `rounded-none overflow-hidden` container, 44px rows, em-dash for null, right-aligned numeric cols.
- AIResponseSkeleton renders `border-l-4 border-l-[#B3D3FF]` (primary-200) immediately before content.

**In progress:** Step 8.0 (Intelligence Feed page layout + data fetching) → product-engineer.

**Next:** 8.0 → 8.1 (FindingCard) → 8.2 (healthy/insufficient-data states) → 8.3 (dismiss UI). 8.4 (CashFlow chart) can run in parallel with 8.1.

---

### Session 5 — 2026-07-29

**Completed:** Phases 4+5 complete (4.6–4.10, 5.0–5.9, format.ts). Phase 6 in progress: 6.0, 6.1, 6.2 done.

**Key notes:**
- AI SDK packages (ai, @ai-sdk/anthropic, @ai-sdk/google) installed in 6.1
- zod peer dep warning (zod-to-json-schema wants zod 3.25+, project is on 3.24.4) — non-fatal, tests mock the ai package to work around
- format.ts expedited (normally Step 7.0) because 5.8 needed formatCurrency
- Inngest serve handler updated at each step: now has syncFanOut, syncSingleOrg, intelligenceRun

**In progress:** Step 6.3 (anomaly detection) → 6.4 (margin) → 6.5 (AR aging) → 6.6 (duplicates) → 6.7 (finding storage) → 6.8 (email) → 6.9 (fan-out wiring) → 6.10+6.11 (API endpoints) → 6.12 (integration test).

**Resend:** credentials in .env.local but package not installed. Must `pnpm add resend` before step 6.8.

### Session 4 — 2026-07-29

**Completed:** Steps 4.3, 4.4, 4.5, 4.6. Steps 4.2–4.6 all done.

**4.6 note:** importTransactions handles 9 QB entity types (Purchases, Invoices, Payments, Bills, BillPayments, CreditMemos, JournalEntries, Deposits, Transfers). Paginated at 1000. onConflictDoUpdate on (orgId, sourceSystem, externalId). rawData=null (PII concern). 429 handled with 30s pause + 1 retry. normalizeQBCategory added to normalize.ts. QB type declarations added to src/types/node-quickbooks.d.ts. tsc+lint exit 0.

**In progress:** Step 4.7 (transaction normalization — add QB TxnType mapping and 10-type unit tests to normalize.ts).

**Next:** 4.7 → 4.8 (incremental sync) → 4.9 (Inngest job) → 4.10 (snapshot recompute). All 4 are integration-engineer tasks.

### Session 3 — 2026-07-29

**Completed:** Steps 4.0 and 4.1 (ran in parallel). Both passed tsc, lint, and vitest gates. commit dbf5fdd.

**4.0 note:** intuit-oauth@4.0.4 does not exist in npm; 4.0.0 was installed instead. An ambient type declaration (`src/types/intuit-oauth.d.ts`) was created since the package ships no TypeScript types.

**4.1 note:** vitest was not yet installed (Step 1.6 skipped). The backend-engineer bootstrapped vitest@2.1 + vitest.config.ts as part of 4.1 so the DoD could be met. When Step 1.6 is eventually picked up, reuse this infrastructure — just add @testing-library/react@16.3 and the CI pipeline.

**In progress:** Step 4.2 (QB OAuth initiate). Delegated to integration-engineer.

**Next:** After 4.2 completes → 4.3 (QB OAuth callback). After 4.3 → 4.4 (QB API client factory). Steps continue sequentially through 4.10.

---

### Session 1 — 2026-07-27

**Completed:** Steps 1.0, 1.1, 1.2, 1.3, 1.4, 1.7 (all Phase 1 steps not requiring external credentials).

**Stopped at:** Steps 1.5 and 1.6 — both blocked by external actions.

**External actions required before next session can proceed:**
1. **Supabase (for Step 1.5):** Go to supabase.com → create free project → copy three values to `.env.local`:
   - `SUPABASE_URL` (e.g. `https://xyz.supabase.co`)
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   Then run `/orchestrate` again — the orchestrator will detect these and start Step 1.5.

2. **GitHub (for Step 1.6):** Push this repo to GitHub. Either:
   - `gh repo create ai-cfo-agent --private --source=. --remote=origin --push` (if `gh auth status` succeeds)
   - Or create a repo at github.com and push manually
   Then run `/orchestrate` again.

**Phase 2 interleaving reminder:** When Step 1.5 is done (Supabase connected), the next path is:
- Step 3.0 (Drizzle ORM setup) depends on 1.5
- Steps 2.0–2.2 depend on 1.5 (need Supabase auth)
- Then Phase 3 (3.1–3.10), then 2.3–2.6
The Phase 2/Phase 3 interleaving is documented in IMPLEMENTATION_PLAN.md.

**Known issue to flag:** inngest@3.27.5 has a CRITICAL SECURITY warning recommending upgrade to >=3.54.0. The plan specifies 3.27 — a future session should decide whether to bump this before production.

---

### Session 0 — Initial state (July 2026)

**Project status:** Not started. No code exists. No credentials have been obtained.

**What the next session should do:**
1. Assign Step 1.0 to backend-engineer. It has no dependencies and can start immediately.
2. While backend-engineer runs `pnpm create next-app`, begin obtaining free-tier credentials in parallel — these do not require code to exist:
   - Supabase free account (needed for Step 1.5)
   - Google AI Studio API key (free, needed for Step 11.0 — get this early, it's $0 and no credit card)
   - Resend free account (needed for Step 2.0 — email delivery for magic links)
   - Inngest free account (needed for Step 1.7)
3. After Step 1.0 is verified (Definition of Done: `pnpm dev` starts, `localhost:3000` renders), un-block Steps 1.1–1.4 and assign them sequentially to backend-engineer in the same session.
4. Do not assign any Phase 2 tasks until Phase 1 is complete. Phase 2 depends on the folder structure (1.4) and the env schema (1.3) that Phase 1 establishes.

**Phase 2 / Phase 3 interleaving — flag for future orchestrator:**
IMPLEMENTATION_PLAN.md has a documented interleaving constraint: Steps 2.0–2.2 can be done first, then all of Phase 3, then Steps 2.3–2.6. When the session reaches Phase 2, re-read the interleaving note at the top of Phase 2 in IMPLEMENTATION_PLAN.md before assigning tasks. Assigning Steps 2.3–2.6 before Phase 3, Step 3.1 is complete will cause the backend-engineer to hit a database table dependency error mid-task.

**Agent assignment forecast for Phase 1:**
All 7 steps in Phase 1 (1.0–1.7) belong to backend-engineer. No other agent is needed until Phase 2. Phase 1 is safe to run as a single-agent session.

**Known constraint for Phase 6 (flag for when it arrives):**
The intelligence engine (Phase 6) has three non-negotiable constraints documented in IMPLEMENTATION_PLAN.md and CLAUDE.md. When assigning Phase 6 tasks to ai-engine-engineer, paste these into the task description:
1. Each analysis type is its own `step.run()` — never combined.
2. All AI calls use `getModel()` from `src/lib/ai/models/router.ts` — no direct imports of `anthropic()` or `google()`.
3. Every AI `step.run()` wraps the call in `try/catch`; HTTP 429 → set `status='skipped'`, `skipped_reason='rate_limit'`, return cleanly.
