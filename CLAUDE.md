# CLAUDE.md
## AI CFO Agent — Coding Rules and Behavioral Guidelines
See also @AGENTS.md for the 4-agent subagent roster, file ownership map, and cross-agent handoff protocols.

This file governs every task performed on this codebase. Read it fully before touching a single file.

---

# SECTION 1 — BEHAVIORAL GUIDELINES

## Rule 1: Think Before Coding

Don't assume. Don't hide confusion. Surface tradeoffs.

Before implementing anything:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

For this product specifically, ALWAYS surface assumptions before touching:
- Anything involving org_id scoping or RLS policies
- Database schema changes (a column addition may require a migration)
- OAuth token handling (QuickBooks and Xero have different refresh semantics)
- Financial calculation logic (state your formula before implementing it)

## Rule 2: Simplicity First

Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked
- No abstractions for single-use code
- No "flexibility" or "configurability" that wasn't requested
- If you write 200 lines and it could be 50, rewrite it

**PRODUCT CARVE-OUT** — this rule has one exception for this product:
Error handling for infrastructure and security scenarios is NOT optional, even when those scenarios feel "impossible" in normal flow. Specifically:
- Network/API failures (QuickBooks API, Xero API, Anthropic/Google API)
- OAuth token expiry during an active operation
- Database connection errors during financial data writes
- A missing org_id where one should always exist (treat as a security error, not a bug)

These are not speculative scenarios. They happen in production fintech applications and failing silently is a security or data integrity incident. Handle them fully.

## Rule 3: Surgical Changes

Touch only what you must. Clean up only your own mess.

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting
- Don't refactor things that aren't broken
- Match existing style, even if you'd do it differently
- If you notice unrelated dead code, mention it — don't delete it

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused
- Don't remove pre-existing dead code unless asked

**CRITICAL AMPLIFICATION for this product's architecture:**
The following are absolute no-touch-adjacent zones unless the task explicitly requires modifying them:
- RLS policies (`src/lib/platform/db/rls-policies.sql`)
- The org_id scoping logic in any query
- OAuth token encryption/decryption (`src/lib/platform/auth/encryption.ts`)
- The model-routing utility (`src/lib/ai/models/router.ts`)
- Financial calculation functions (`src/lib/financial/calculations/`)

If you're fixing a bug in an alerts endpoint and you notice the RLS policy "could be cleaner" — leave it alone. Note it in your response if you want, but do not touch it. A well-intentioned refactor in these areas can introduce a cross-tenant data leak that won't surface until a customer complains.

The test: every changed line should trace directly to the task requested.

## Rule 4: Goal-Driven Execution

Define success criteria. Loop until verified.

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Implement the sync job" → "The Inngest dev UI shows the job running and the database shows new rows in the transactions table"

For multi-step tasks, state a brief plan before writing code:
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]

For tasks in the IMPLEMENTATION_PLAN, the Definition of Done in the step IS the success criterion. Restate it before starting. If you can't verify it independently, flag that before proceeding.

Tradeoff: these rules bias toward caution over speed. For trivial single-line changes, use judgment. For anything touching auth, financial data, or multi-tenant isolation — always apply them in full.

---

# SECTION 2 — PRODUCT-SPECIFIC RULES

---

## Language & Type Safety

**TypeScript settings are non-negotiable.** The `tsconfig.json` has `strict: true`, `noUncheckedIndexedAccess: true`, and `exactOptionalPropertyTypes: true`. Never loosen these settings, never add `// @ts-ignore`, and never cast with `as any`. If TypeScript complains, fix the types — do not suppress the error.

**Every function must have explicit return types.** TypeScript can infer them, but explicit types are self-documenting and prevent return type drift. Exception: short arrow functions used inline as callbacks (`array.map(x => x.id)` does not need an explicit return type).

**Use `type` for data shapes, `interface` only for extension contracts.** All API request/response shapes, database row types, and domain objects are `type`. Use `interface` only when you intend another interface to extend it.

**Zod for all external data.** Any data entering the system from outside (API request body, query params, webhook payload, QuickBooks API response) is validated with a Zod schema before use. Zod `.parse()` throws on invalid data — use `.safeParse()` only when you intend to handle the error rather than propagate it.

**`enum` is forbidden.** Use `const` objects with `as const` and derive the union type: `type Status = (typeof STATUS)[keyof typeof STATUS]`. TypeScript enums produce confusing compiled output and do not tree-shake cleanly.

**No `any` in function signatures.** `unknown` is acceptable when the type genuinely isn't known and you handle the unknown case with a type guard. `any` disables all type checking downstream and is never acceptable in a financial data application.

**Path aliases only, no relative imports crossing layer boundaries.** Use `@/lib/...`, `@/components/...`, `@/types/...`. Never write `../../../lib/platform/db` — it breaks refactoring and obscures the module graph. Relative imports (`./foo`) are only acceptable within the same directory.

---

## File & Folder Conventions

**All files are named in `kebab-case`.** No PascalCase filenames (even for React components — the component is named in PascalCase inside the file, but the file is `finding-card.tsx`, not `FindingCard.tsx`).

**The five-layer architecture is enforced by folder.** Never cross these layers directly:
- `src/lib/platform/` — infrastructure: database client, auth, encryption, session
- `src/lib/integrations/` — external APIs: QuickBooks, Xero
- `src/lib/financial/` — domain logic: calculations, aggregations, intelligence analysis
- `src/lib/ai/` — AI layer: prompts, routing, streaming, guardrails
- `src/components/` — UI components only; no database or API calls inside components

A component that needs data calls an API route. An API route calls a `src/lib/financial/` function. A `src/lib/financial/` function calls the Drizzle client from `src/lib/platform/db/client.ts`. No layer skips another.

**Background jobs live in `jobs/`, not in `src/`.** Inngest function definitions go in `jobs/sync/`, `jobs/intelligence/`, `jobs/reports/`, or `jobs/billing/`. They are not API routes. They are registered once in `src/app/api/webhooks/inngest/route.ts`.

**Test files live next to the code they test.** `src/lib/financial/calculations/pnl.test.ts` tests `src/lib/financial/calculations/pnl.ts`. Integration tests live in `src/__tests__/`. Security tests live in `src/__tests__/security/`. Intelligence engine tests live in `src/__tests__/intelligence/`.

**Scripts are for development utilities only.** Files in `scripts/` are never imported by application code. They are run with `pnpm tsx scripts/...` and are not deployed. If you find yourself importing a script from `src/`, you have the wrong file location.

**`src/types/` holds shared domain types.** `src/types/financial.ts` exports types shared across the financial layer. `src/types/api.ts` exports API request/response types. Do not define domain types inline in API route files — they belong in `src/types/`.

---

## Multi-tenancy Rules (CRITICAL)

**Every database query on an org-scoped table must include a `WHERE org_id = [current org]` clause.** The following tables are org-scoped: `organizations`, `connections`, `sync_jobs`, `accounts`, `transactions`, `financial_snapshots`, `conversations`, `messages`, `query_log`, `alerts`, `alert_configs`, `reports`, `subscriptions`, `consent_log`, `intelligence_runs`, `findings`, `action_drafts`, `cash_flow_projections`. A query against any of these tables without an `org_id` filter is a critical security bug that exposes one customer's data to another.

**RLS is defense-in-depth, not the primary defense.** Row Level Security is applied at the database layer, but application-layer `org_id` filtering must also be present in every query. If RLS fails due to a misconfiguration, application-layer filtering prevents the breach. Both must be in place.

**`getRequestContext(request)` is the canonical source of truth for the current org.** Never read `org_id` from a request body or query param and use it directly. Always read it from the session context returned by `getRequestContext()`. A user who passes a different `org_id` in the body should get the org their session is associated with, not whatever they sent.

```typescript
// CORRECT
const { orgId, role } = await getRequestContext(request);
const findings = await db.select().from(findingsTable).where(eq(findingsTable.orgId, orgId));

// WRONG — orgId from request body is user-controlled input
const { orgId } = await request.json();
const findings = await db.select().from(findingsTable).where(eq(findingsTable.orgId, orgId));
```

**A missing `orgId` from `getRequestContext()` is a security error, not a null-check.** If `getRequestContext()` returns a null `orgId` for an authenticated request, return 500 with `{ code: 'INTERNAL_ORG_CONTEXT_MISSING' }` and log the error. Do not fall back to querying without an org filter.

**Cross-org resource access must return 403, not 404.** When a user requests a resource that exists but belongs to a different org (a finding, a report, a conversation), return HTTP 403. Returning 404 leaks the existence of the resource to the requester. Return 403 unconditionally for cross-org access — never reveal whether the resource exists.

**The QB/Xero mutual exclusivity constraint is enforced at both layers.** The database has a partial unique index (`idx_connections_one_accounting_per_org`) preventing two active accounting connections for the same org. The application layer in the Xero callback must also check and return 409. Both must be in place — never remove the application check because "the DB will catch it."

**Never pass `org_id` as a prop through the React component tree.** Components receive data (findings, reports) — not the org context that retrieved it. The org context lives in the server layer. If a client component needs the org ID for display purposes, expose it via a minimal server component or a typed context provider — never drill it as a prop four levels deep.

---

## Financial Data Rules (CRITICAL)

**Every monetary column in the database uses `decimal('column_name', { precision: 15, scale: 2 })` in Drizzle.** Never use `real()`, `doublePrecision()`, or `integer()` for monetary values. IEEE 754 floating-point cannot exactly represent most decimal fractions; accumulated rounding errors in financial calculations are a product-ending bug class.

```typescript
// CORRECT
amount: decimal('amount', { precision: 15, scale: 2 }).notNull(),

// WRONG — introduces rounding error
amount: doublePrecision('amount').notNull(),
amount: real('amount').notNull(),
```

**Monetary values cross the API boundary as strings, not numbers.** DECIMAL values from PostgreSQL serialize to JavaScript strings via `drizzle-orm`. They must remain strings in API responses. Never parse them to `number` for transmission. The client's `formatCurrency()` function accepts `string | number` and handles the conversion safely for display only.

**Never perform arithmetic on monetary values in JavaScript.** Aggregations (sums, differences, percentages) must happen in SQL via Drizzle, not in JavaScript. `parseFloat("12.50") + parseFloat("10.10")` can return `22.599999999999998`. SQL `SUM()` on `DECIMAL` columns is exact.

```typescript
// CORRECT — arithmetic in SQL
const result = await db
  .select({ total: sql<string>`SUM(${transactions.amount})` })
  .from(transactions)
  .where(eq(transactions.orgId, orgId));

// WRONG — arithmetic in JavaScript on parsed floats
const rows = await db.select({ amount: transactions.amount }).from(transactions);
const total = rows.reduce((sum, row) => sum + parseFloat(row.amount), 0);
```

**Percentage values use `decimal('column', { precision: 7, scale: 4 })`.** Stored as `0.2000` for 20%. Never store a percentage as `20` (requires knowing the scale to interpret) or as a raw float.

**The `formatCurrency()` function is the only place monetary strings become display text.** It lives in `src/lib/format.ts`. Never write `$${amount}` or `${amount.toFixed(2)}` inline. Always call `formatCurrency(value)`.

**Negative values render with a Unicode minus (−) and `loss-600` color, never parentheses.** `−$1,234.56` is correct. `($1,234.56)` is wrong. `formatCurrency()` enforces this — do not bypass it.

**Cash flow projections always include a `confidence_level`.** Fewer than 90 days of history = `'low'`. 90–180 days = `'medium'`. 180+ days = `'high'`. Never return a projection without surfacing this to the caller.

**The cash flow projection endpoint returns 422 if the org has fewer than 60 days of transaction data.** The response body must include `{ code: 'INSUFFICIENT_DATA', daysAvailable: N, daysRequired: 60 }`. Never return an empty projection array — return the structured error so the frontend can render the progress bar state.

---

## AI Integration Rules

**`getModel()` from `src/lib/ai/models/router.ts` is the only entry point to any AI provider.** No file in this codebase may import `anthropic` from `@ai-sdk/anthropic` or `google` from `@ai-sdk/google` except `src/lib/ai/models/router.ts`. This is enforced by an ESLint `no-restricted-imports` rule. If you need to call an AI model, call `getModel()`. If you think you have a reason to import the provider directly, you don't.

**Every AI call in a financial context appends the standard disclaimer as the final response chunk.** "This is AI-generated analysis of your accounting data. It is not financial advice. Consult a qualified financial professional for decisions requiring expert judgment." This text is appended in `src/lib/ai/streaming/handler.ts`. It must never be omitted or moved to an opt-in. Do not add a disclaimer to a response and then remove it "for cleaner UX."

**The content guardrail runs before every AI call.** `checkGuardrails(question)` in `src/lib/ai/guardrails/financial-advice.ts` must be called before streaming begins. If it returns `{ flagged: true }`, return the template refusal response — do not call the AI. Never bypass the guardrail to "get an answer anyway."

**Conversation history is window-trimmed before injection.** Load the last 20 messages maximum. Verify the total token count is under 8,000 before sending. If trimming is needed, trim oldest first. Never send full conversation history without counting tokens.

**AI response streaming uses `result.toDataStreamResponse()` from the Vercel AI SDK.** Never manually construct SSE payloads. Never buffer the entire response before streaming. The streaming handler in `src/lib/ai/streaming/handler.ts` is the canonical implementation — new endpoints should call it, not reimplement streaming.

**Draft generation (agentic execution) calls `getModel()` with a standard complexity score of `0.5`.** Draft generation is not a complex financial analysis task. It does not warrant the Sonnet model. Use the default complexity routing unless there is a specific justified reason to increase it.

**Every AI-generated email draft must display the draft disclaimer in the UI.** "This draft was generated by AI using your QuickBooks data. Review it before sending." This is shown either in the draft body as a prepended note or as a visible banner in the review modal. It is never hidden or collapsed. It does not need to be in the copied text, but it must be visible before the user clicks "Copy to clipboard."

---

## Component Rules

**Financial number display uses the shared components. Always.** `CurrencyAmount` for monetary values. `MetricChange` for percentage changes with direction. `SeverityBadge` for finding severity labels. `FinancialTable` for tabular financial data. Never render a dollar amount with inline formatting.

**Chart containers and data table wrappers use `border-radius: 0` (`rounded-none`).** Rounded corners on charts and tables make financial data look like marketing content. The `FinancialTable` component enforces this. If you create a new chart wrapper, it must be `rounded-none`.

**No inline `style` props on any element.** All styling uses Tailwind utility classes referencing the design token system from `FRONTEND_GUIDELINES.md`. If a required style doesn't have a Tailwind token, add it to `globals.css` as a CSS variable and reference it in `tailwind.config.ts`. Never write `style={{ color: '#2557A7' }}`.

**Use the semantic color tokens, never raw hex.** Write `text-[var(--primary-500)]` or the Tailwind alias, not `text-[#2557A7]`. Exception: inside `SEVERITY_STYLES` constant objects where the color is explicitly mapped to a severity level and documented as such — these are acceptable as inline hex because the mapping table itself IS the documentation.

**Gain/loss color is never the sole indicator.** Every positive/negative indicator must pair color with a direction symbol (▲/▼) or an icon with `aria-hidden="true"` and a sibling `sr-only` span. `MetricChange` enforces this — do not bypass it by rendering gain/loss values manually.

**Every interactive element has a visible focus ring.** The `*:focus-visible` rule in `globals.css` provides a `2px solid primary-500` outline. Never add `outline: none` to any element without a replacement focus indicator. Never use `focus:outline-none` in Tailwind without pairing it with a `focus:ring-*` class.

**Components receive data, not org context.** A component that displays findings receives `FindingCard[]` as a prop. It does not receive `orgId` and fetch findings itself. Data fetching happens in server components or API routes. Pass the result, not the context.

**`AgenticModal` state follows the five-state flow.** States are: `confirm` → `generating` → `review` → `copy` → `done`. Do not add intermediate states or skip states. The CTA in State 4 is always labelled "Copy to clipboard" or "Copy draft" — never "Send."

---

## API Rules

**Every API route handler calls `getRequestContext(request)` as its first meaningful operation.** The pattern is: validate session → get org context → validate request body → perform operation → return result. Org context must be established before any database query.

**Every API response uses the standard envelope.** Success: `{ data: T, meta?: PaginationMeta }`. Error: `{ error: { code: string, message: string, details?: unknown, request_id: string } }`. Never return a raw object, a raw error string, or a different shape. No exceptions.

```typescript
// CORRECT
return NextResponse.json({ data: { finding } }, { status: 200 });

// WRONG — raw object, no envelope
return NextResponse.json(finding, { status: 200 });
```

**Every error response includes a `request_id`.** Generate it with `crypto.randomUUID()` at the top of the handler. Log it server-side with the error. Include it in the response body. This is the correlation ID for support.

**HTTP status codes are used semantically.** 200 = success. 201 = created. 400 = invalid input (Zod validation failure). 401 = not authenticated. 403 = authenticated but not authorized (wrong org, wrong role). 404 = not found AND belongs to this org. 409 = conflict (duplicate, illegal state transition). 422 = valid input but business rule prevents processing (quota exceeded, insufficient data). 429 = rate limited. 500 = unexpected server error. Never use 200 for an error.

**All write endpoints validate the request body with a Zod schema before touching the database.** The schema is defined at the top of the route file. `.parse()` is used — not `.safeParse()` — so Zod throws a `ZodError` that the error boundary catches. The catch block returns a 400 with the Zod error message.

**Pagination uses cursor-based pagination for findings and conversations.** Never use `OFFSET`-based pagination for these tables — offset pagination degrades as the table grows and produces inconsistent results if rows are inserted during pagination. The cursor is an opaque encoded value based on `created_at + id`. Clients pass it as `?cursor=...`.

**Mutating endpoints (POST, PATCH, DELETE) on org-scoped resources verify the resource belongs to the current org before mutating.** Do not assume that if a `finding_id` exists, it belongs to the current org. Query with `WHERE id = X AND org_id = currentOrgId`. If no row is returned, respond 404 (which implicitly means "not found in your org").

---

## Database Query Rules

**Never query an org-scoped table without a `where(eq(table.orgId, orgId))` clause.** The org-scoped tables are: all 21 tables in BACKEND_STRUCTURE.md except `organizations` and `organization_members` themselves. A table scan on `findings` or `transactions` without an org filter is a cross-tenant data exposure.

**Use the Drizzle query builder, not raw SQL, for all data access.** The exception is aggregation queries where Drizzle's API does not support the required SQL construct — in that case, use `sql<string>\`...\`` tagged template literals with typed return values. Never construct SQL strings with string concatenation.

**Monetary columns in SQL aggregations are typed as `sql<string>`.** Drizzle returns DECIMAL aggregations as strings. Always type them as `string` in the `sql<>` generic, never `number`.

```typescript
// CORRECT
const [result] = await db
  .select({ totalRevenue: sql<string>`SUM(${transactions.amount})` })
  .from(transactions)
  .where(and(eq(transactions.orgId, orgId), eq(transactions.transactionType, 'income')));

// WRONG — typed as number, will be a string at runtime, TypeScript lie
const [result] = await db
  .select({ totalRevenue: sql<number>`SUM(${transactions.amount})` })
  ...
```

**Use `dbDirect` (direct connection, port 5432) only for migrations.** Use `db` (pooler, port 6543) for all application queries. Never use `dbDirect` in API routes or background jobs.

**Writes that must be atomic use a Drizzle transaction.** Creating an organization (which also creates `organization_members`, `subscriptions`, `consent_log`, and four `alert_configs` rows) must succeed or fail atomically. If any insert fails, none should commit. Use `db.transaction(async (tx) => { ... })`.

**`upsert` on sync tables uses `.onConflictDoUpdate()`, never delete-and-reinsert.** QuickBooks and Xero data is upserted using the external ID as the conflict key. Delete-and-reinsert would break any foreign key relationships and is slower than upsert.

**Index your queries.** Before writing a new query, check BACKEND_STRUCTURE.md for the relevant indexes. If your query would require a sequential scan on a large table (transactions, findings), either use an existing index or add one in the same migration as the table change. Never merge a query that performs a sequential scan on `transactions` in production.

---

## Error Handling Rules

**Every Inngest step that calls an external API wraps the call in `try/catch`.** QuickBooks API calls, Xero API calls, AI provider calls — all must have error handling. An uncaught error in an Inngest step causes the step to retry. Some retries are correct (network timeout). Others should not retry (rate limit, quota exceeded). Handle them explicitly.

**API errors from QuickBooks/Xero are classified before handling.** Check the HTTP status code: 401 → set `connections.sync_status = 'auth_expired'`, stop the sync, do not retry. 429 → pause 30 seconds, retry once, then fail. 5xx → fail the sync job, set `sync_status = 'failed'`. Never treat a 401 as a retryable error — retrying with an expired token produces more 401s.

**Database errors during financial data writes are fatal.** If a Drizzle transaction fails mid-write (partial sync), set `sync_jobs.status = 'failed'` and `sync_jobs.error_message` with the error. Do not retry partial writes automatically — data integrity requires a known-good starting state. The next scheduled sync will attempt a full incremental sync from the last successful `last_synced_at`.

**The error response format is always the standard envelope.** Even in unexpected catch blocks: `return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.', request_id } }, { status: 500 })`. Never let an unhandled error reach the client as a stack trace or a raw error message.

**Log errors with structured fields, not string concatenation.** `console.error('Sync failed for org', orgId, error)` is not structured. Use: `console.error({ event: 'sync_failed', orgId, errorMessage: error.message, errorCode: error.code })`. This makes logs queryable in production.

**Rate limit errors from AI providers set `intelligence_runs.skipped_reason = 'rate_limit'` and return cleanly.** They do not throw. They do not retry. They do not switch to a different provider. See Intelligence Engine Rules.

---

## Security Rules

**OAuth tokens are never stored in plaintext.** Before writing `access_token` or `refresh_token` to the `connections` table, call `encryptToken()` from `src/lib/platform/auth/encryption.ts`. After reading from the database, call `decryptToken()`. No OAuth token value ever appears in a database query result in plaintext.

**OAuth tokens are never logged.** If you add a log statement anywhere near token handling, check that the logged object does not contain `access_token`, `refresh_token`, `access_token_encrypted`, or `refresh_token_encrypted`. Use `{ connectionId, orgId, provider }` for log context — never the token values.

**Environment variables are accessed only through `src/lib/env.ts`.** Never write `process.env.ANTHROPIC_API_KEY` in application code. The T3 env schema in `src/lib/env.ts` validates the variable at build time and exports it as a typed object. Write `env.ANTHROPIC_API_KEY`. The ESLint rule for `no-restricted-globals` enforces this for `process.env`.

**PKCE state and code verifier are stored in short-lived httpOnly cookies.** They expire in 2 minutes. They are SameSite=Strict. They are never stored in `localStorage`, `sessionStorage`, or a database table. Never extend the TTL "for convenience" during development — expired state cookies mean expired OAuth flow, not a bug.

**The QuickBooks OAuth callback verifies that only read scopes were granted.** If the callback receives write scopes, it rejects the connection and redirects to an error page. This is not optional — the product's data sovereignty promise depends on never having write access to user accounts. This check runs on every callback, not just the first.

**User-supplied values are never interpolated into SQL strings.** Drizzle's parameterized query builder handles escaping. If you use a `sql` tagged template literal, every user-supplied value goes through a `sql.placeholder()` or Drizzle's typed operators — never string-interpolated.

**Sensitive fields are excluded from API responses.** The `connections` table row is never returned directly from an API. Strip `access_token_encrypted`, `refresh_token_encrypted`, `token_expiry` before returning connection data to the client. The client receives only: `provider`, `isActive`, `lastSyncedAt`, `syncStatus`, `providerCompanyName`.

---

## Testing Rules

**The Definition of Done in IMPLEMENTATION_PLAN.md is the test specification.** Before writing a test, read the step's Definition of Done. The test must verify exactly what the Definition of Done states — no more, no less.

**Security tests run on every PR.** `src/__tests__/security/rls-isolation.test.ts` and `src/__tests__/security/api-auth.test.ts` must pass in CI. These are not optional tests. A PR that breaks cross-org isolation without a test failure is a product-ending security bug waiting for production.

**Financial calculation functions have unit tests with exact decimal assertions.** Use string comparison for monetary values: `expect(result.totalRevenue).toBe('145200.00')`. Do not use `toBeCloseTo()` for monetary values — "close enough" is not acceptable for financial data.

**Intelligence engine tests run against seeded data, not mocked data.** The integration test in `src/__tests__/intelligence/full-run.test.ts` seeds a test org with known conditions and runs the full engine. The test must assert exact finding types, not just "some findings were generated."

**Every new API endpoint has an auth test.** The test calls the endpoint without a session (expects 401), with a valid session for the wrong org (expects 403), and with a valid session for the correct org (expects 200/201). This three-case pattern is the minimum auth test for any endpoint.

**Vitest, not Jest.** All tests use `vitest`. Never add `jest.config.*` files. Never write `jest.fn()` — write `vi.fn()`. The test script is `pnpm vitest run` for CI and `pnpm vitest` for watch mode.

---

## Intelligence Engine Rules

**The nightly intelligence run checks sync status before running.** If the most recent `sync_jobs` record for this org has `status != 'completed'`, set `intelligence_runs.status = 'skipped'`, `skipped_reason = 'sync_failed'`, and return. Never run intelligence analysis on data from a failed or in-progress sync.

**Cash flow projections must include `confidence_level`.** Fewer than 90 days of history = `'low'`. 90–180 days = `'medium'`. 180+ days = `'high'`. Always surface this in the response. Never return a projection without a confidence level.

**Findings have selective expiry.** Set `expires_at` only for time-sensitive findings where the condition has a known end date. Specifically:
- `cash_flow_risk` findings: set `expires_at` to the `riskDate` from the cash flow projection (the date the shortfall is projected to occur). A cash risk that was projected for October 21 should expire on October 22 — it is no longer actionable after that date has passed.
- `anomaly`, `collections_opportunity`, `duplicate_subscription`, `margin_alert` findings: leave `expires_at` as `NULL`. These findings persist until explicitly dismissed or actioned by the user. Setting a 7-day expiry on a duplicate subscription finding would cause it to silently disappear after a week even if the user never addressed it.
The `GET /api/intelligence/feed` endpoint filters `status = 'active'` AND (`expires_at IS NULL` OR `expires_at > NOW()`). Both conditions are always applied — never omit the expiry filter from queries on the `findings` table.

**Email only on high/critical severity.** Low and medium findings = in-app notification only. No email is dispatched for low/medium findings in V1. The Inngest step that dispatches `intelligence/email.requested` must check `highestSeverity === 'critical' || highestSeverity === 'high'` before sending the event. If neither condition is true, no event is sent.

**NEVER import `anthropic()` or `google()` directly in intelligence engine files.** Always call `src/lib/ai/models/router.ts`. No file outside `router.ts` selects a provider. This is enforced by the ESLint `no-restricted-imports` rule.

**If the AI provider returns HTTP 429:** set `intelligence_runs.status = 'skipped'`, `skipped_reason = 'rate_limit'`, and return cleanly. Never retry with a different provider. The next scheduled run will attempt again. Catch the error with `detectRateLimitError(err)` from the router module.

**Draft actions must display the disclaimer: "This draft was generated by AI using your QuickBooks data. Review it before sending."** This text is visible in the draft review UI (State 3 of the AgenticModal) before the user copies. It is displayed as a prepended note in the draft body or as a visible banner — never hidden, never collapsed.

**Each analysis type is its own `step.run()` call.** Cash flow projection, anomaly detection, margin detection, AR aging analysis, and duplicate subscription scan are separate steps. Never combine two analysis types into one step. Vercel Hobby has a 10-second function timeout per invocation. Each step must complete in under 8 seconds in isolation.

**Never run the intelligence engine on an org with fewer than 60 days of transaction data.** This is Guard 1 in `jobs/intelligence/run.ts`. If `MIN(transaction_date)` to `NOW()` is fewer than 60 days, set `status = 'skipped'`, `skipped_reason = 'insufficient_history'`, and return. The API equivalent is the 422 response from `/api/cashflow/projection` with `{ code: 'INSUFFICIENT_DATA', minimumDays: 60 }`.

---

## What to Always Do

- Call `getRequestContext(request)` at the top of every API route handler, before any query.
- Include `org_id` in every Drizzle query against an org-scoped table.
- Use `decimal('col', { precision: 15, scale: 2 })` for every monetary column in Drizzle.
- Serialize monetary values as strings in API responses; never as JavaScript `number`.
- Call `getModel()` from `src/lib/ai/models/router.ts` for every AI call.
- Append the standard financial disclaimer to every AI-generated response.
- Encrypt OAuth tokens with `encryptToken()` before writing to `connections`.
- Include `request_id` in every error response.
- Wrap every Inngest step that calls an external API in `try/catch`.
- Run `pnpm tsc --noEmit` and `pnpm lint` before considering any code task complete.
- Use `formatCurrency()` from `src/lib/format.ts` for every monetary display value.
- State your plan before writing code for any task touching auth, financial data, or multi-tenant isolation.
- Check the IMPLEMENTATION_PLAN.md Definition of Done before starting any plan step.
- Return 403 (not 404) when a resource exists but belongs to a different org.
- Test the three-case auth pattern on every new endpoint: no session (401), wrong org (403), correct org (200).

---

## What to Never Do

- NEVER query the `transactions`, `findings`, `action_drafts`, `cash_flow_projections`, or any org-scoped table without a `WHERE org_id = [current org]` clause. A missing org_id filter is a critical security bug that exposes one customer's financial data to another.
- NEVER use `real()`, `doublePrecision()`, or `integer()` for monetary columns in Drizzle. Floating-point arithmetic produces incorrect financial totals.
- NEVER perform arithmetic on monetary values in JavaScript. Sum, subtract, and aggregate in SQL on DECIMAL columns.
- NEVER import `anthropic()` from `@ai-sdk/anthropic` or `google()` from `@ai-sdk/google` in any file other than `src/lib/ai/models/router.ts`.
- NEVER return an AI response without the standard financial disclaimer as the final text.
- NEVER store an OAuth access token or refresh token in plaintext in the database, in a log, or in a response body.
- NEVER read `org_id` from a request body or query param and use it as the org context. Always use `getRequestContext()`.
- NEVER label an action button "Send" when it produces a draft for copy-paste. Always "Copy draft" or "Copy to clipboard."
- NEVER generate code that sends an external communication without an explicit user-triggered approval immediately preceding it. Sending is always manual in V1.
- NEVER run the intelligence engine on an org with fewer than 60 days of transaction data. Return a structured error: `{ code: 'INSUFFICIENT_DATA', minimumDays: 60 }`.
- NEVER query `findings`, `action_drafts`, or `cash_flow_projections` without `WHERE org_id = [current org]`. These tables have RLS but defence in depth applies — both layers must be in place.
- NEVER add `// @ts-ignore` or `as any` to suppress a TypeScript error. Fix the types.
- NEVER touch RLS policies, org_id scoping logic, OAuth token encryption, the model-routing utility, or financial calculation functions unless the task explicitly requires it.
- NEVER use `OFFSET`-based pagination for `findings` or `conversations`. Use cursor-based pagination.
- NEVER write inline `style={{ ... }}` props on JSX elements. All styling uses Tailwind utility classes.
- NEVER use `gain-500` or `loss-500` for text color. Minimum `gain-600` / `loss-600` for AA contrast compliance.
- NEVER show a cash flow projection without a `confidence_level` field in the response.
- NEVER use `jest.fn()`. This project uses Vitest. Write `vi.fn()`.
- NEVER use `process.env.VARIABLE_NAME` directly in application code. Use `env.VARIABLE_NAME` from `src/lib/env.ts`.
