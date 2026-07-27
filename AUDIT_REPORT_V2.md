# Cross-Document Audit Report — V2
## AI CFO Agent

**Auditor:** Senior Technical Architect  
**Documents reviewed:** PRD, APP_FLOW, TECH_STACK, FRONTEND_GUIDELINES, BACKEND_STRUCTURE, IMPLEMENTATION_PLAN  
**Date:** July 2026  
**Total issues found:** 19  
**Status:** Report only — no fixes applied

---

## Severity key

- 🔴 **Critical** — runtime failure, security gap, or broken user flow if built as written
- 🟠 **High** — feature cannot be completed; a screen, endpoint, or job is missing from one document
- 🟡 **Medium** — inconsistency that will cause developer confusion, rework, or a subtle bug
- 🟢 **Low** — comment, naming gap, or minor omission; no functional impact

---

## Check 1: P0 features → screens → endpoints → steps

### Issue 1 🟠
**Documents:** PRD (Feature: "You own your data" onboarding screen, acceptance criterion 2), APP_FLOW (Section 1 `/settings/account`), IMPLEMENTATION_PLAN (Step 10.4), BACKEND_STRUCTURE

**What is missing:** The PRD P0 "data sovereignty" feature requires a one-click data export ("Download your data" button). APP_FLOW documents this on `/settings/account`. IMPLEMENTATION_PLAN Step 10.4 says "Implement `GET /api/data/export` endpoint." BACKEND_STRUCTURE shows `src/app/api/data/` in the folder tree but has **no endpoint specification** for `GET /api/data/export` anywhere in Section 3 (API Endpoints). The response shape, auth requirements, download format, file name, and error conditions are completely undocumented.

**What needs to be added:** A full endpoint specification for `GET /api/data/export` in BACKEND_STRUCTURE Section 3, including: auth (session required), response type (file download), `Content-Disposition` header format, zip contents (all reports as PDF+JSON, all conversation history as JSON, all findings history as JSON), rate limit (once per hour per org to prevent abuse), and error conditions.

---

### Issue 2 🟠
**Documents:** PRD (Feature: Intelligence brief, acceptance criteria 2 and edge case 2), BACKEND_STRUCTURE (Section 5, Job 6 email job), IMPLEMENTATION_PLAN (Step 6.8)

**What is missing:** The PRD specifies two requirements for the intelligence email that are completely absent from BACKEND_STRUCTURE's email job description and IMPLEMENTATION_PLAN Step 6.8:

1. **Subject line format:** PRD acceptance criterion 1 specifies exact subject line formats: `"[Product Name] — urgent: [brief description]"` for critical and `"[Product Name] — action recommended: [brief description]"` for high. BACKEND_STRUCTURE Job 6's `sendIntelligenceBriefEmail()` code comment says only "specific finding headlines and details" — no subject format.

2. **Email body links:** PRD acceptance criterion 2 requires the email body to contain a `"View full brief"` link to the in-app finding detail AND an `"Ask the AI about this"` link that opens `/ask?finding_id=[id]`. Neither BACKEND_STRUCTURE nor IMPLEMENTATION_PLAN mention these deep links.

3. **No-resend rule:** PRD edge case 2 says: "Do not re-send the exact same finding twice in consecutive cycles; this trains users to ignore repeated alerts." No document specifies how this deduplication is implemented (check the last `intelligence/email.requested` event against existing findings? Check `action_drafts.copied_at`?).

**What needs to be added:** BACKEND_STRUCTURE Job 6 email job description must specify the subject line template, the two required deep links in the email body, and the consecutive-cycle deduplication logic. IMPLEMENTATION_PLAN Step 6.8 must include the same.

---

## Check 2: APP_FLOW screens that fetch data → GET endpoints

### Issue 3 🟠
**Documents:** APP_FLOW (Section 1 `/alerts` screen, Section 2 Flow 6), IMPLEMENTATION_PLAN (Step 14.0), BACKEND_STRUCTURE (Section 3 Intelligence Endpoints)

**What is missing:** APP_FLOW Section 1 documents the `/alerts` screen as: "Fetches all findings (active, dismissed, actioned, expired) with filter controls (severity, type, date range, status)." IMPLEMENTATION_PLAN Step 14.0 confirms: "Fetches all findings (active, dismissed, actioned, expired) with filter controls."

BACKEND_STRUCTURE Section 3 has only `GET /api/intelligence/feed` which is hard-coded to return only `status='active'` findings and has no `status` filter parameter. Its documentation explicitly states "Only findings with `status = 'active'` are returned; dismissed, actioned, and expired findings are excluded."

The `/alerts` archive page requires a separate endpoint — either a new `GET /api/intelligence/findings` with a `status` filter, or an extension of `GET /api/intelligence/feed` to accept `status` as an optional query parameter. Neither exists in BACKEND_STRUCTURE.

**What needs to be added:** A new endpoint specification in BACKEND_STRUCTURE — either `GET /api/intelligence/findings?status=active|dismissed|actioned|expired|all` or an extended `GET /api/intelligence/feed` — that supports the multi-status query required by the `/alerts` archive screen. The folder structure would also need a new route file or the existing feed route updated.

---

### Issue 4 🔴
**Documents:** APP_FLOW (Section 1 `/onboarding/sync` screen), BACKEND_STRUCTURE (Section 5 Job 2), IMPLEMENTATION_PLAN (Steps 4.3, 10.3)

**What is missing:** APP_FLOW describes `/onboarding/sync` as a waiting state that "polls every 3 seconds" for completion, then redirects to `/onboarding/first-brief` when "sync + scan completes." However:

1. **No polling endpoint is specified.** APP_FLOW does not name which endpoint the page polls, which response field it reads to detect completion, or what "completed" looks like in the API response.

2. **Sync and intelligence run are separate async Inngest jobs with no shared completion state.** IMPLEMENTATION_PLAN Step 4.9 has the sync job dispatch `intelligence/run.requested` as a fire-and-forget event. The intelligence run executes independently. The sync job's `sync_jobs` table will show `status='completed'` when the data import finishes — but the intelligence engine's findings are written later, in a separate Inngest execution, by a different function. APP_FLOW says the page waits for "sync + scan completes" as if they finish together. They do not. If the page polls `GET /api/connections` for `syncStatus='success'`, it will redirect to `/onboarding/first-brief` before the intelligence engine has produced any findings, and that screen will show the empty/healthy state regardless of what the engine later finds.

**What needs to be added:**
- APP_FLOW must specify which endpoint `/onboarding/sync` polls and what field it checks.
- BACKEND_STRUCTURE or IMPLEMENTATION_PLAN must define a mechanism to track when both the sync AND the subsequent intelligence run have completed for a given org (e.g., a combined status check, or polling `GET /api/intelligence/feed` until the first response is not empty, or a new `intelligence_runs` status endpoint). The current architecture does not support the APP_FLOW requirement of showing intelligence findings on the first-brief screen.

---

### Issue 5 🟡
**Documents:** APP_FLOW (Section 1 `/settings/connections` screen), BACKEND_STRUCTURE (Section 3 `GET /api/connections` response spec)

**What is missing:** APP_FLOW's `/settings/connections` screen shows "last scan timestamp, last intelligence run time" on each connection card. The `connections` table has a `last_intelligence_run_at` column (added in the V2 update). However, `GET /api/connections` response spec at line 1107–1120 lists only: `id, provider, providerCompanyName, isActive, syncStatus, lastSyncedAt, currencyCode, recentSyncJobs`. The `lastIntelligenceRunAt` field is absent from the response type.

**What needs to be added:** Add `lastIntelligenceRunAt: string | null` to the `GET /api/connections` response TypeScript shape in BACKEND_STRUCTURE Section 3.

---

## Check 3: Financial data conventions → components and conversational UI

### Issue 6 🟡
**Documents:** FRONTEND_GUIDELINES (Section 7 Financial Data Display Conventions, Section 8 Conversational UI Conventions)

**What is missing:** FRONTEND_GUIDELINES Section 7 specifies that monetary values must be formatted as `$1,234.56` and negative values must use a Unicode minus (`−$1,234.56`). Section 8 (Conversational UI) documents the visual format of AI responses (left border, line height, typography) but never states that monetary values appearing inside AI-generated text must follow the same formatting conventions as the `CurrencyAmount` component.

This creates an ambiguity: the AI model streams text that includes dollar amounts (e.g., "your cash position is $45000"). Section 8 does not specify whether the system prompt must instruct the AI to format numbers as `$45,000.00` (with comma and two decimal places), or whether numbers in streamed text are exempt from the formatting rules that apply to `<CurrencyAmount>` component rendering.

**What needs to be added:** Section 8 should include a note clarifying the expected behavior: either (a) the system prompt instructs the AI to format monetary values as `$1,234.56` (comma-separated, two decimal places) and the conversational UI does not apply `formatCurrency()` post-processing to streamed text, or (b) the streaming handler post-processes the AI output to normalize monetary strings before display. Without this, AI responses may show `$45000` while the dashboard shows `$45,000.00` for the same figure.

---

## Check 4: QuickBooks OAuth flow

### Issue 7 🔴
**Documents:** BACKEND_STRUCTURE (Section 3 `GET /api/auth/quickbooks/callback` side effects note, `POST /api/connections/:id/sync` side effects note), BACKEND_STRUCTURE (Section 5 Job 2 Single-Org Sync code)

**What is missing:** Two API endpoint side-effect descriptions use the event name `sync/org.requested` (lines 1138 and 1163), but the actual Job 2 Single-Org Sync function in Section 5 uses `sync/connection.requested` as its trigger event (lines 1770, 1776). These are two different Inngest event names for the same intent.

Specifically:
- `GET /api/auth/quickbooks/callback`: "triggers Inngest `sync/org.requested` event"
- `POST /api/connections/:id/sync`: "Enqueues Inngest `sync/org.requested` event"
- Job 2 code: `{ event: 'sync/connection.requested' }` and the fan-out sends `name: 'sync/connection.requested'`

If a developer implements the callback and manual sync endpoints to dispatch `sync/org.requested` (as the endpoint specs say), and Job 2 listens on `sync/connection.requested` (as the code says), no syncs will ever trigger. This is a runtime failure.

**What needs to be changed:** All three references must be reconciled to the same event name. The Job 2 code is the implementation reference — `sync/connection.requested` is the correct name (it carries `connectionId`, `orgId`, `provider`). The two endpoint side-effect notes must be updated to use `sync/connection.requested`.

---

### Issue 8 🟠
**Documents:** APP_FLOW (Section 2 User Flows, Navigation Map, all references to `/api/auth/callback`), BACKEND_STRUCTURE (Section 1 folder tree, Section 3 API Endpoints)

**What is missing:** The Supabase magic link callback route (`src/app/api/auth/callback/route.ts`) is referenced throughout APP_FLOW as the entry point every user passes through after clicking a magic link. IMPLEMENTATION_PLAN Step 2.1 creates this route. However:

1. The BACKEND_STRUCTURE **folder tree** (Section 1) lists only `me/route.ts` and `logout/route.ts` under `src/app/api/auth/`. The `callback/route.ts` file is absent from the folder tree.
2. BACKEND_STRUCTURE **Section 3** has no endpoint specification for `GET /api/auth/callback` — no auth requirements, no routing logic documentation, no error states.

This is the highest-traffic route in the entire application (every user passes through it at least once per session) and it has no specification.

**What needs to be added:** Add `callback/route.ts` to the folder tree under `src/app/api/auth/` with a comment describing its purpose. Add a `GET /api/auth/callback` endpoint specification in Section 3 documenting: the token exchange with Supabase, the session routing logic (new user → `/onboarding/migration`; returning user → `/dashboard`; `?source=bench` handling; expired token → `/login`), and error handling.

---

## Check 5: Subscription/billing model

No issues found. The PRD billing model (Trial/Starter/Growth with explicit query limits), `subscriptions` table, Stripe endpoints (`POST /api/billing/checkout`, `GET /api/billing/portal`, `POST /api/webhooks/stripe`), `GET /api/billing/usage` (which correctly includes `planTier` in its response), and Phase 13 in IMPLEMENTATION_PLAN are all consistent and complete.

---

## Check 6: Multi-tenant RLS

No issues found. BACKEND_STRUCTURE Section 4 documents the RLS architecture. IMPLEMENTATION_PLAN Step 3.9 creates `rls-policies.sql` and applies it. IMPLEMENTATION_PLAN Step 15.0 is the isolation test suite. All three are present.

---

## Check 7: "Not financial advice" disclaimer

No issues found on the core requirement. FRONTEND_GUIDELINES Section 8.2 documents the disclaimer visual spec. BACKEND_STRUCTURE messages endpoint spec states "The disclaimer is appended as the final text chunk." IMPLEMENTATION_PLAN Step 11.1 implements disclaimer injection in the streaming handler. Step 15.4 includes a disclaimer compliance test. The V1 audit also added the disclaimer requirement to report emails and intelligence brief emails.

*(See Issue 2 for the separate gap in intelligence brief email body content requirements.)*

---

## Check 8: `firm_clients` table (P2 — scaffold only)

No issues found. `firm_clients` is created in IMPLEMENTATION_PLAN Step 3.8 without any associated UI or portal features. APP_FLOW marks `/firm/clients` and `/firm/clients/:id` as "P2 — do not build until validated." No IMPLEMENTATION_PLAN phase builds the firm portal.

---

## Check 9: Naming consistency

### Issue 9 🟡
**Documents:** BACKEND_STRUCTURE (Section 5 Job 2 Single-Org Sync, Section 3 `GET /api/auth/quickbooks/callback`, `POST /api/connections/:id/sync`)

**What is inconsistent:** Already captured in Issue 7 (event name `sync/org.requested` vs `sync/connection.requested`), but there is a second layer of naming inconsistency in the same area. BACKEND_STRUCTURE Section 5 Job 2 comment line says:

> `// Flow: decrypt tokens → call provider API → normalize → upsert → update snapshot → trigger alerts`

This comment describes the V1 architecture where the sync triggers "alert evaluation." In V2, the sync triggers the intelligence engine (not an alert evaluation job). The comment in the code block should say "trigger intelligence run" not "trigger alerts."

**What needs to be changed:** The Job 2 comment in BACKEND_STRUCTURE Section 5 should be updated to reflect the V2 flow: `decrypt tokens → call provider API → normalize → upsert → update snapshot → trigger intelligence run`.

---

### Issue 10 🟡
**Documents:** BACKEND_STRUCTURE (Section 1 folder tree, `src/app/api/auth/me/route.ts` comment), BACKEND_STRUCTURE (Section 3 `PATCH /api/auth/me`, `DELETE /api/auth/me`)

**What is inconsistent:** The folder tree comment for `me/route.ts` reads: `# GET current user + org context`. However, during the V1 audit update, `PATCH /api/auth/me` (update display name, timezone) and `DELETE /api/auth/me` (delete account) were added to Section 3 as fully documented endpoints. The folder tree comment accurately reflected the V1 state but now misrepresents what the file contains — a developer following the folder tree alone would implement only a GET handler and miss PATCH and DELETE.

**What needs to be changed:** The folder tree comment should read: `# GET user + org context · PATCH update profile · DELETE account`.

---

## Check 10: IMPLEMENTATION_PLAN assumes non-existent tables or endpoints

### Issue 11 🔴
**Documents:** BACKEND_STRUCTURE (Section 5 Job 2 Single-Org Sync code, Job 3 Alert Evaluation), IMPLEMENTATION_PLAN (Step 4.9, Step 1.4)

**What is conflicting:** This is the most significant V1→V2 migration gap in the documentation. BACKEND_STRUCTURE Section 5 shows two separate post-sync architectures simultaneously:

**In Job 2 code (Section 5):** The sync job ends with:
```
await step.sendEvent('trigger-alert-evaluation', {
  name: 'alerts/evaluate.requested',
  ...
});
```
This dispatches to **Job 3: Alert Evaluation** (`jobs/alerts/evaluate.ts`), a V1-style job that evaluates alert conditions.

**In IMPLEMENTATION_PLAN Step 4.9:** The sync job ends with:
```
step.sendEvent('trigger-intelligence-run') → dispatches intelligence/run.requested
```
This dispatches to the **V2 intelligence engine** (`jobs/intelligence/run.ts`).

These are two incompatible architectures for what happens after a sync. BACKEND_STRUCTURE was not fully updated when the intelligence engine replaced the alert evaluation system. `jobs/alerts/evaluate.ts` is listed in the folder tree, has a stub created in IMPLEMENTATION_PLAN Step 1.4, is documented as a background job in Section 5, and receives `alerts/evaluate.requested` events — but no IMPLEMENTATION_PLAN step ever implements it, and the post-sync event dispatch in IMPLEMENTATION_PLAN dispatches a different event entirely.

**What needs to be changed:**
- BACKEND_STRUCTURE Section 5 Job 2 must be updated to dispatch `intelligence/run.requested` instead of `alerts/evaluate.requested`, consistent with IMPLEMENTATION_PLAN Step 4.9.
- BACKEND_STRUCTURE Section 5 Job 3 (Alert Evaluation) should be removed or replaced with a note that alert/anomaly detection was absorbed into the intelligence engine (Job 6) in V2.
- BACKEND_STRUCTURE folder tree should remove `jobs/alerts/evaluate.ts` or mark it as a V1 remnant.
- IMPLEMENTATION_PLAN Step 1.4 creates a stub for `jobs/alerts/evaluate.ts` that will never be implemented — this stub creation step should be removed or the stub file should be removed from the folder structure.

---

### Issue 12 🟡
**Documents:** BACKEND_STRUCTURE (Section 1 folder tree), IMPLEMENTATION_PLAN

**What is missing:** `src/lib/format.ts` (exports `formatCurrency`, `formatPercent`, `formatDate`) is referenced throughout FRONTEND_GUIDELINES, CLAUDE.md, and in IMPLEMENTATION_PLAN Step 7.3 (where `CurrencyAmount.tsx` is built to call `formatCurrency()` from it). However:

1. `src/lib/format.ts` is **not listed in the BACKEND_STRUCTURE folder tree** — the `src/lib/` section ends with `billing/` and does not include `format.ts` as a top-level utility file.
2. No IMPLEMENTATION_PLAN step explicitly creates `src/lib/format.ts`. Step 7.3 builds `CurrencyAmount.tsx` and says it accepts `string | number` and formats correctly — implying `formatCurrency` already exists — but no prior step creates the file.

**What needs to be added:** `format.ts` should be added to the BACKEND_STRUCTURE folder tree. A sub-step in IMPLEMENTATION_PLAN Step 7.0 or 7.3 should explicitly create `src/lib/format.ts` with the `formatCurrency`, `formatPercent`, and `formatDate` functions specified in FRONTEND_GUIDELINES Section 9.4.

---

### Issue 13 🟡
**Documents:** BACKEND_STRUCTURE (Section 1 folder tree `src/lib/billing/quota.ts`, `src/lib/billing/webhooks.ts`), IMPLEMENTATION_PLAN

**What is missing:** The BACKEND_STRUCTURE folder tree lists two billing support modules:
- `src/lib/billing/quota.ts` — "Atomic quota check-and-decrement with row lock"
- `src/lib/billing/webhooks.ts` — "Processes Stripe events, updates org plan_tier"

Neither file has an IMPLEMENTATION_PLAN step that creates it.

`quota.ts` is the most problematic: IMPLEMENTATION_PLAN Step 11.3 (messages streaming endpoint) includes "Check quota: read subscriptions with row lock" as part of the endpoint's processing order, but no prior step creates the `quota.ts` module that would contain this logic. If implemented as described, the quota logic lives inline in the route file rather than in the standalone module the folder structure specifies.

`webhooks.ts` is secondary: Step 13.0 says "Implement `POST /api/webhooks/stripe`" (the route file), but the helper module `src/lib/billing/webhooks.ts` that the route would presumably import is never mentioned.

**What needs to be added:** Either add explicit sub-steps creating `src/lib/billing/quota.ts` and `src/lib/billing/webhooks.ts` (likely within Steps 11.3 and 13.0 respectively), or update the BACKEND_STRUCTURE folder tree comments to indicate that this logic lives in the route file rather than a separate module.

---

### Issue 14 🟡
**Documents:** BACKEND_STRUCTURE (Section 1 folder tree `src/lib/ai/prompts/financial-qa.ts`), IMPLEMENTATION_PLAN

**What is missing:** BACKEND_STRUCTURE folder tree lists `src/lib/ai/prompts/financial-qa.ts` described as "Q&A prompt builder, constructs data payload." No IMPLEMENTATION_PLAN step creates this file. Step 11.1 creates `system.ts` and `streaming/handler.ts`. Step 5.8 creates `src/lib/ai/context/builder.ts`. The Q&A prompt construction logic is implied to live somewhere between the context builder and the streaming handler, but the specific `financial-qa.ts` file is never mentioned in any step.

**What needs to be added:** Either add a sub-step in IMPLEMENTATION_PLAN Step 11.1 or 11.3 that explicitly creates `src/lib/ai/prompts/financial-qa.ts` with a `buildFinancialQAPrompt(orgId, question)` function, or remove `financial-qa.ts` from the BACKEND_STRUCTURE folder tree and document that the Q&A prompt construction happens inline in `handler.ts`.

---

### Issue 15 🟡
**Documents:** BACKEND_STRUCTURE (Section 1 folder tree, Section 5 Job 6 intelligence module table), IMPLEMENTATION_PLAN (Steps 6.3, 6.6)

**What is missing:** BACKEND_STRUCTURE folder tree lists `src/lib/financial/intelligence/anomaly.ts` and `duplicates.ts` as separate module files. The intelligence engine module table in Section 5 also references them explicitly. However, IMPLEMENTATION_PLAN Steps 6.3 and 6.6 implement the anomaly detection and duplicate subscription logic **inline within `step.run()` closures inside `jobs/intelligence/run.ts`** — not by calling separate module functions. No step says "create `anomaly.ts`" or "create `duplicates.ts`."

By contrast, `ar-aging.ts` is correctly handled: Step 5.4 explicitly creates `buildArAgingSchedule()` in `src/lib/financial/intelligence/ar-aging.ts` before Step 6.5 calls it.

**What needs to be added:** IMPLEMENTATION_PLAN Steps 6.3 and 6.6 should be updated to extract their analysis logic into `anomaly.ts` and `duplicates.ts` respectively (matching the folder structure), rather than implementing inline. Alternatively, the folder tree and module table in BACKEND_STRUCTURE should be updated to reflect that these functions are inline helpers rather than standalone modules.

---

### Issue 16 🟡
**Documents:** BACKEND_STRUCTURE (Section 1 folder tree `src/lib/ai/context/history.ts`), IMPLEMENTATION_PLAN

**What is missing:** BACKEND_STRUCTURE folder tree lists `src/lib/ai/context/history.ts` — "Loads and window-trims conversation history." No IMPLEMENTATION_PLAN step creates this file. Step 11.3 (messages endpoint) says "load the last 20 messages" as part of the processing order, but never references `history.ts` and does not include a sub-step creating it.

**What needs to be added:** A sub-step in IMPLEMENTATION_PLAN Step 11.3 should explicitly create `src/lib/ai/context/history.ts` with a `loadConversationHistory(conversationId, limit)` function that window-trims to 20 messages and returns them in the format expected by the streaming handler.

---

### Issue 17 🟡
**Documents:** BACKEND_STRUCTURE (Section 1 folder tree `src/lib/platform/db/`), BACKEND_STRUCTURE (Section 2 RLS Core Function note), IMPLEMENTATION_PLAN (Step 3.9)

**What is missing:** BACKEND_STRUCTURE Section 2 (RLS Core Function note) says: "The SQL must be stored in `src/lib/platform/db/rls-policies.sql` and applied manually to both development and production databases." IMPLEMENTATION_PLAN Step 3.9 says: "Create `src/lib/platform/db/rls-policies.sql`." However, the BACKEND_STRUCTURE **folder tree** in Section 1 lists only three items under `src/lib/platform/db/`: `schema.ts`, `client.ts`, and `migrations/`. The `rls-policies.sql` file is absent from the folder tree.

A developer using the folder tree as their implementation guide would not know this file needs to exist in that directory.

**What needs to be added:** Add `rls-policies.sql` to the `src/lib/platform/db/` folder tree entry with a comment: `# Manual SQL: RLS policies applied via Supabase SQL Editor (see SETUP.md)`.

---

### Issue 18 🔴
**Documents:** CLAUDE.md (Intelligence Engine Rules section), BACKEND_STRUCTURE (Section 2 `findings` table `expires_at` column)

**What is conflicting:** CLAUDE.md Intelligence Engine Rules state:

> "**Findings expire.** Set `expires_at = created_at + 7 days`. Never show stale findings."

This rule is stated as universal — all findings expire 7 days after creation.

BACKEND_STRUCTURE `findings` table defines `expires_at` as:

> `TIMESTAMPTZ | NULL | — | Findings that are time-sensitive expire automatically (e.g., a cash risk projected for a specific date expires after that date passes)`

BACKEND_STRUCTURE's design is that `expires_at` is **nullable** — most findings do not have an expiry, only time-sensitive ones (like a cash flow risk that was projected for a specific date that has now passed). A duplicate subscription finding, for example, remains relevant until dismissed; setting it to expire in 7 days would cause it to silently disappear even if the user never addressed it.

These are incompatible rules. CLAUDE.md tells any AI agent to set a 7-day expiry on all findings. BACKEND_STRUCTURE's schema design uses NULL to mean "does not expire." An AI agent following CLAUDE.md would cause non-time-sensitive findings to expire and silently disappear from the feed after a week regardless of whether the user addressed them.

**What needs to be changed:** CLAUDE.md must be corrected to match BACKEND_STRUCTURE's nuanced design: time-sensitive findings (cash flow risk projections keyed to a specific date) set `expires_at` to the risk date. Non-time-sensitive findings (duplicate subscription, expense spike, margin alert) leave `expires_at` as NULL and persist until explicitly dismissed or actioned.

---

### Issue 19 🟠
**Documents:** IMPLEMENTATION_PLAN (all Phase 10 steps), APP_FLOW (Section 1 `/onboarding/sync`)

**What is missing:** The IMPLEMENTATION_PLAN has no step that creates the `/onboarding/sync` waiting page (`src/app/(dashboard)/onboarding/sync/page.tsx`). Multiple steps route the user to `/onboarding/sync` (Steps 4.3, 10.2, 12.0) and Step 10.3 creates the `/onboarding/first-brief` page that follows it, but the sync waiting page itself — including its polling logic, the dynamic text cycling ("Importing your transaction history..." → "Running first intelligence scan..."), the 90-second timeout handler, and the retry/continue flow — has no dedicated implementation step.

**What needs to be added:** A dedicated IMPLEMENTATION_PLAN step (logically between Steps 4.3 and 10.3) that creates `src/app/(dashboard)/onboarding/sync/page.tsx`, specifies the polling mechanism and endpoint, implements the timeout handling, and satisfies the Definition of Done that the user is correctly redirected to `/onboarding/first-brief` after both sync and intelligence scan complete.

*(Note: this step would also need to address Issue 4 — the architectural gap between sync completion and intelligence engine completion.)*

---

## Summary Table

| # | Severity | Documents Involved | Category |
|---|---|---|---|
| 1 | 🟠 High | PRD, APP_FLOW, BACKEND_STRUCTURE, IMPLEMENTATION_PLAN | Missing endpoint spec |
| 2 | 🟠 High | PRD, BACKEND_STRUCTURE, IMPLEMENTATION_PLAN | Missing email spec details |
| 3 | 🟠 High | APP_FLOW, BACKEND_STRUCTURE, IMPLEMENTATION_PLAN | Missing endpoint (archive page) |
| 4 | 🔴 Critical | APP_FLOW, BACKEND_STRUCTURE, IMPLEMENTATION_PLAN | Async job timing gap |
| 5 | 🟡 Medium | APP_FLOW, BACKEND_STRUCTURE | Missing response field |
| 6 | 🟡 Medium | FRONTEND_GUIDELINES | Ambiguous AI text formatting |
| 7 | 🔴 Critical | BACKEND_STRUCTURE | Inngest event name conflict |
| 8 | 🟠 High | APP_FLOW, BACKEND_STRUCTURE, IMPLEMENTATION_PLAN | Missing route in folder tree + no spec |
| 9 | 🟡 Medium | BACKEND_STRUCTURE | Stale V1 comment in code block |
| 10 | 🟡 Medium | BACKEND_STRUCTURE | Folder tree comment incomplete |
| 11 | 🔴 Critical | BACKEND_STRUCTURE, IMPLEMENTATION_PLAN | V1/V2 architecture conflict (post-sync job) |
| 12 | 🟡 Medium | BACKEND_STRUCTURE, IMPLEMENTATION_PLAN | Missing file in folder tree + no creation step |
| 13 | 🟡 Medium | BACKEND_STRUCTURE, IMPLEMENTATION_PLAN | No creation steps for billing modules |
| 14 | 🟡 Medium | BACKEND_STRUCTURE, IMPLEMENTATION_PLAN | No creation step for AI prompt file |
| 15 | 🟡 Medium | BACKEND_STRUCTURE, IMPLEMENTATION_PLAN | No creation steps for intelligence modules |
| 16 | 🟡 Medium | BACKEND_STRUCTURE, IMPLEMENTATION_PLAN | No creation step for history.ts |
| 17 | 🟡 Medium | BACKEND_STRUCTURE, IMPLEMENTATION_PLAN | Missing file in folder tree |
| 18 | 🔴 Critical | CLAUDE.md, BACKEND_STRUCTURE | Contradictory finding expiry rules |
| 19 | 🟠 High | IMPLEMENTATION_PLAN, APP_FLOW | Missing implementation step for core screen |

---

*End of audit. 19 issues documented. No fixes applied. Priority fix order: Issues 7 and 11 first (they will cause runtime failures that are invisible until the Inngest dev server is running); Issue 4 second (it will cause the first-brief screen to always show healthy/empty regardless of the user's actual financial data); Issue 18 third (it will cause an AI agent following CLAUDE.md to silently expire all findings after 7 days).*
