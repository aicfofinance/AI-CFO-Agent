# Technology Stack
## AI CFO Agent — V1

**Version:** 0.1  
**Date:** July 2026  
**Author:** Engineering  

> **Free deployment alignment:** Every service in this stack has a zero-cost tier sufficient for the trial deployment. Paid tiers are noted where relevant but are not required until revenue exists to cover them. Verify exact package versions at implementation time — this document reflects stable versions as of mid-2025; patch releases will have advanced.

---

## 1. Core Application Framework

### Next.js 15.3

**Why this product specifically:** Next.js 15 with the App Router gives us three capabilities that matter here. First, React Server Components let us fetch financial data on the server and render it without a client-side waterfall — the dashboard's pre-computed metrics arrive as HTML, not as a loading spinner followed by a fetch. Second, Route Handlers are the API layer for every external integration (QuickBooks OAuth callback, Xero callback, Plaid webhooks, Stripe webhooks, AI streaming endpoint) — all in one project without a separate Express server. Third, Next.js natively supports streaming responses via the Web Streams API, which is how we send Claude's response token-by-token to the chat UI. The `useChat` hook in the Vercel AI SDK is built specifically for Next.js streaming routes.

**Free deployment fit:** Runs on Vercel Hobby at $0. The 10-second serverless function timeout on Hobby is a real constraint for AI calls — addressed by streaming (the connection stays open while tokens arrive) rather than waiting for a complete response.

**Considered and rejected:** Remix 2.x — solid framework with good streaming support, but the Next.js + Vercel deployment story is tighter, the App Router's Server Components pattern reduces client-side data fetching complexity, and the AI SDK's `useChat` hook targets Next.js specifically. React + Vite (SPA) was ruled out because it requires a separate API server and loses SSR benefits for the dashboard's financial data.

---

## 2. Language

### TypeScript 5.7

**Why:** Financial data must not silently lose precision or type information between layers. TypeScript's strict mode catches the bugs that matter in this domain: a function that accepts `number` when it should accept `Decimal`, a transaction object missing a required field, a prompt construction function that receives the wrong data shape. The five-layer architecture (platform, integration, financial, AI, product) communicates exclusively through TypeScript interfaces defined in `@/types/` — if a type changes, every consumer breaks at compile time, not at runtime.

**Configuration:** `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`. These settings are painful initially and prevent an entire class of financial data bugs permanently.

---

## 3. CSS and Styling

### Tailwind CSS 4.1

**Why:** Tailwind v4 ships with a Rust-based engine (Oxide) that is significantly faster than v3 and supports native CSS cascade layers. For a financial dashboard with dense data display (metric cards, transaction tables, chart tooltips), utility classes keep component styles co-located and eliminate the specificity problems that plague component-scoped CSS. The design token system in v4 (CSS custom properties via `@theme`) maps cleanly to the financial data states we need: green for positive cash flow, red for negative values, amber for warnings.

**Specific to this product:** Tailwind's responsive utilities handle the dashboard's grid of metric cards collapsing to single-column on narrower viewports without a separate responsive CSS system. The product is mobile-responsive web (not a native app), so Tailwind's breakpoint utilities are the full responsive story.

**Considered and rejected:** CSS Modules — more verbose, requires manual dark mode handling, harder to iterate quickly on a dashboard with many small components. Styled-components — runtime CSS injection has measurable overhead on initial page paint for a metrics-heavy dashboard. Vanilla CSS — viable but slower to develop against when the design system needs 15+ data state variants.

---

## 4. Component Library

### shadcn/ui (Radix UI 1.1 primitives)

shadcn/ui is not a traditional installed library — it is a collection of accessible component implementations that are copied directly into the project's `components/ui/` directory and owned by the codebase. The underlying primitives are **Radix UI 1.1.x**.

**Why:** Financial dashboards require reliable, accessible UI primitives that the team controls. Dialog (for disconnect confirmation modals), Select (for industry and revenue band dropdowns in onboarding), Tooltip (for metric card explainers), Popover (for transaction detail drawers), and Tabs (for settings navigation) are all needed. Radix UI provides unstyled, accessible implementations of all of these. Because the components are copied into the project, there is no library version that can silently break — an upgrade is a deliberate code change.

**Specific to this product:** The `Command` component (Radix via shadcn) provides the suggested question chips on the `/ask` screen. The `Dialog` component handles the QuickBooks disconnection confirmation with proper focus trapping. The `Skeleton` component renders the dashboard loading state while financial data imports.

**Considered and rejected:** Chakra UI v3 — runtime CSS-in-JS overhead conflicts with React Server Components; the JavaScript bundle cost matters on a dashboard that loads financial data. Material UI v6 — strong library but the default aesthetic requires significant customization to look like a financial product rather than a Google product. Headless UI (Tailwind Labs) — fewer components, less maintained than Radix UI.

---

## 5. Financial Data Visualization

### Recharts 2.15

**Why this library for financial chart types:**

Recharts is React-first (renders via SVG, controlled by React state), composable (every chart is assembled from primitives: `ComposedChart`, `Bar`, `Line`, `Area`, `XAxis`, `YAxis`, `Tooltip`, `ReferenceLine`), and handles all chart types this product needs in V1:

- **Monthly revenue bar chart (dashboard):** `BarChart` with `Bar` components, one per month. The current partial month renders with a visual distinction (lighter fill or dashed border) by passing a custom `Cell` renderer.
- **6-month trend line (dashboard):** `LineChart` with a `ReferenceLine` marking the prior-year same-period revenue for comparison.
- **Expense category breakdown (dashboard):** `PieChart` with `Cell` components colored by category — or `BarChart` horizontal for the top-5 list.
- **Cash flow over time (monthly report):** `AreaChart` with a `ReferenceLine` at zero — the fill color switches from green (positive) to red (negative) using a `defs`-based `linearGradient` that changes at y=0.
- **Per-day query usage (settings/billing):** `BarChart` with thin bars, one per day.

**Why not candlestick:** Candlestick charts (OHLC) are for securities price data. This product does not display stock prices. The closest financial chart we display is cash flow over time, which is a line or area chart. Recharts handles this natively.

**Considered and rejected:** Chart.js 4.x — imperative API (canvas-based, managed via `useRef` and `useEffect`) does not compose naturally with React state, making dynamic updates (as new sync data arrives) more complex than with Recharts' declarative model. Victory Charts — solid library but larger bundle size and less community maintenance in the 2025 timeframe. Tremor Charts — built on Recharts but adds an abstraction layer that reduces control over the custom styling needed for financial data states (positive/negative color switching).

---

## 6. Authentication

### Supabase Auth (via @supabase/supabase-js 2.48)

**Why this product specifically — the multi-tenant argument:**

Supabase Auth is the correct choice here not because of its feature set, but because of its relationship to PostgreSQL Row Level Security. Every other auth library in this comparison (Auth.js, Clerk) requires the application to enforce data isolation at the query layer. Supabase Auth's architecture is different: the user's JWT, issued by Supabase Auth, contains a `sub` claim (user UUID) that PostgreSQL can read directly using `auth.uid()` inside RLS policies. This means:

```sql
-- transactions table RLS policy
CREATE POLICY "org members only"
ON transactions
FOR ALL
USING (
  org_id = (
    SELECT org_id FROM organization_members
    WHERE user_id = auth.uid()
  )
);
```

Even if an application-layer bug omits a `WHERE org_id = ?` clause, the database rejects the query. The isolation is enforced at the storage layer, not just the application layer. For a product handling another organization's financial data, this is the correct architecture.

**Magic link implementation:** Supabase Auth's `signInWithOtp({ email })` method sends a magic link with no additional configuration. The `/auth/callback` route calls `supabase.auth.exchangeCodeForSession(code)` to establish the session. No password storage, no password reset flows.

**Token refresh:** Supabase Auth handles session refresh automatically via `@supabase/ssr` 0.5.x — the server-side session utility for Next.js App Router. Session cookies are refreshed via middleware on every request.

**Considered and rejected:** Auth.js (NextAuth.js) 5.x — flexible and framework-agnostic but has no concept of database-level RLS integration; org-level data isolation must be enforced at every query, creating a surface area for bugs. Clerk — excellent developer experience, built-in organization management, but adds $25/month at scale, stores user data on Clerk's infrastructure rather than your Supabase database, and is a third-party dependency for sensitive identity data. The organization management features Clerk offers are implemented in fewer than 100 lines of Drizzle schema in this stack.

---

## 7. Database

### PostgreSQL 16 via Supabase

**Multi-tenant isolation approach — Row Level Security:**

All financial data tables carry an `org_id UUID NOT NULL REFERENCES organizations(id)` column. RLS is enabled on every such table. Policies use `auth.uid()` (the authenticated user's UUID from the Supabase JWT) to resolve org membership:

```sql
-- Reusable function stored in the database
CREATE OR REPLACE FUNCTION get_user_org_id()
RETURNS UUID AS $$
  SELECT org_id FROM organization_members WHERE user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER;

-- Applied to every sensitive table
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY transactions_org_isolation ON transactions
  USING (org_id = get_user_org_id());
```

Tables covered by RLS: `transactions`, `accounts`, `connections`, `oauth_tokens`, `query_log`, `alerts`, `reports`, `organization_members`, `consent_log`, `sync_log`.

Tables without RLS (read-only reference data): `industries` (15 categories), `subscription_tiers`.

**Indexing strategy for financial queries:**

The product's most expensive queries are financial aggregations. These indexes must exist before data volume grows:

```sql
-- Dashboard: revenue/expense by month for an org
CREATE INDEX idx_transactions_org_date ON transactions(org_id, date DESC);

-- Expense breakdown by category
CREATE INDEX idx_transactions_org_category ON transactions(org_id, category, date DESC);

-- Composite: the primary P&L query pattern
CREATE INDEX idx_transactions_org_type_date ON transactions(org_id, transaction_type, date DESC);

-- Query log: usage tracking per org per month
CREATE INDEX idx_query_log_org_month ON query_log(org_id, created_at DESC);

-- Alert evaluation: find active alerts per org
CREATE INDEX idx_alerts_org_status ON alerts(org_id, status, created_at DESC);
```

**OAuth token encryption:** QuickBooks and Xero access/refresh tokens are encrypted before storage using AES-256-GCM with the Node.js built-in `crypto` module. The encryption key is stored as an environment variable (`OAUTH_TOKEN_ENCRYPTION_KEY`), not in the database. Even if the database is compromised, the raw tokens are not readable.

```sql
-- oauth_tokens table stores encrypted values
CREATE TABLE oauth_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  provider TEXT NOT NULL, -- 'quickbooks' | 'xero'
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Free deployment:** Supabase Free tier provides 500MB storage and 50K MAU — sufficient for 50–100 trial organizations with 6 months of transaction data each. The project pauses after 7 days of inactivity; a cron job on cron-job.org (free) pings the Supabase health endpoint every 48 hours to prevent pausing.

**Considered and rejected:** PlanetScale (MySQL) — MySQL has no native Row Level Security; multi-tenant isolation requires application-layer enforcement at every query. This is a weaker model for financial data. Neon — serverless PostgreSQL with good branching features, but lacks Supabase's integrated Auth/RLS management, requires separate auth service, and has a more limited free tier. MongoDB — document database; financial aggregation queries (sum by category, group by month across millions of rows) perform significantly worse than indexed relational queries.

---

## 8. ORM / Query Layer

### Drizzle ORM 0.36 + drizzle-kit 0.27

**Why Drizzle for financial aggregation queries:**

Drizzle sits between a raw SQL driver and a heavyweight ORM. Its query builder is SQL-isomorphic — a developer who knows SQL can read Drizzle queries without learning a new abstraction. This matters for the financial calculation layer, where queries like "sum all expense transactions grouped by category for a given org and date range" should be readable and debuggable.

```typescript
// The kind of query the financial layer runs constantly
const expensesByCategory = await db
  .select({
    category: transactions.category,
    total: sql<number>`sum(${transactions.amount})`.as('total'),
    transactionCount: sql<number>`count(*)`.as('transaction_count'),
  })
  .from(transactions)
  .where(
    and(
      eq(transactions.orgId, orgId),
      eq(transactions.transactionType, 'expense'),
      between(transactions.date, startDate, endDate)
    )
  )
  .groupBy(transactions.category)
  .orderBy(desc(sql`total`));
```

This query is readable, the generated SQL is predictable and uses the indexes defined above, and there is zero ORM magic that might generate a suboptimal query plan.

**Drizzle + Supabase:** Drizzle connects via the Supabase connection pooler (Transaction mode, port 6543 in production; Session mode for migrations). The Supabase JS client is used exclusively for auth operations — `supabase.auth.signInWithOtp()`, `supabase.auth.exchangeCodeForSession()` — where the tight integration with Supabase Auth's JWT matters. Drizzle handles all data operations.

**Considered and rejected:** Prisma 5.22 — more mature tooling, excellent DX, but Prisma's generated client has meaningful overhead per query; complex aggregation queries require raw SQL escape hatches (`prisma.$queryRaw`) that produce less type-safe code than Drizzle's typed `sql` template literal. Prisma also generates a heavyweight client that doesn't run cleanly in Vercel Edge Runtime. The Supabase JS client alone (`supabase.from('transactions').select()`) — adequate for simple CRUD but the aggregation query syntax (`supabase.rpc()` or raw `.select()` chains) is less expressive and less type-safe than Drizzle for the financial calculation patterns this product needs.

---

## 9. Background Jobs and Scheduled Sync

### Inngest 3.27

**The requirement:** QuickBooks and Xero data must sync every 6 hours per connected organization, independent of user activity. After each sync, alert conditions must be evaluated. These operations are long-running (up to 90 seconds for an initial import), require retry logic with exponential backoff, and must not block HTTP requests.

**Why Inngest:** Inngest provides a background function runtime that integrates with Next.js as a single API route (`/api/inngest`). Functions are defined in TypeScript with the same tooling as the rest of the application. The job scheduler sends events to this endpoint; Inngest handles retries, dead-letter queues, and parallel fan-out automatically.

The sync architecture:
```typescript
// Defined once, runs for every org every 6 hours
export const syncOrganizationData = inngest.createFunction(
  { id: 'sync-org-data', retries: 3 },
  { cron: '0 */6 * * *' }, // not per-org — see fan-out below
  async ({ step }) => {
    // Fan out to one job per connected org
    const orgs = await step.run('get-connected-orgs', () =>
      db.select().from(connections).where(eq(connections.status, 'active'))
    );
    await step.sendEvent('sync-each-org', orgs.map(org => ({
      name: 'sync/org.requested',
      data: { orgId: org.orgId, provider: org.provider },
    })));
  }
);

export const syncSingleOrg = inngest.createFunction(
  { id: 'sync-single-org', retries: 3 },
  { event: 'sync/org.requested' },
  async ({ event, step }) => {
    await step.run('pull-transactions', () => pullTransactions(event.data));
    await step.run('evaluate-alerts', () => evaluateAlerts(event.data.orgId));
  }
);
```

**Free deployment:** Inngest's free tier includes 50K function runs per month. At 4 syncs/day per organization, 50 trial organizations consume 6K function runs/month — well within the free tier.

**Considered and rejected:** Vercel Cron Jobs alone — Vercel Hobby supports 1 cron job; production needs at minimum 3 (QuickBooks sync fan-out, Xero sync fan-out, monthly report generation). Vercel Pro allows daily cron but lacks job queue semantics (no retry logic, no dead-letter queue, no per-job observability). `node-cron` inside a long-running process — incompatible with serverless Vercel deployment; functions are stateless and short-lived. Trigger.dev v3 — equivalent capability to Inngest but smaller community and less mature as of mid-2025. QStash (Upstash) — message queue primitive that requires more manual orchestration; Inngest's step-function model is cleaner for the multi-step sync pipeline.

---

## Intelligence Engine AI Routing

The proactive intelligence engine runs nightly for every connected organisation. Unlike the Q&A layer (which is triggered by a user action), the intelligence engine makes AI API calls on a schedule — meaning costs accumulate per org per night regardless of user activity.

**Critical constraint: `AI_PROVIDER` controls both layers.** There is no separate model configuration for the intelligence engine. When `AI_PROVIDER=google`, both Q&A and the nightly intelligence runs use Gemini free tier at $0. This is the required setting for all development and trial deployment. When `AI_PROVIDER=anthropic`, both layers switch to Claude — and both incur inference costs.

**Cost model for reference:**

| Configuration | Q&A cost per user/month | Intelligence run cost per org/night | Total at 50 orgs |
|---|---|---|---|
| `AI_PROVIDER=google` | $0 (free tier) | $0 (free tier) | $0 |
| `AI_PROVIDER=anthropic` | ~$0.13/user (Claude Haiku) | ~$0.08/org (Claude Haiku, 4 analysis calls) | ~$10.50/month |

Switch to `anthropic` only when subscription revenue covers inference costs. A single Starter subscriber ($99/month) covers the AI inference for approximately 100 trial organisations.

**The model-routing utility is the only place in the codebase that imports `anthropic()` or `google()` directly:**

```typescript
// src/lib/ai/models/router.ts — the ONLY file that imports providers
import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';
import { env } from '@/lib/env';

export function getModel(complexityScore = 0.5) {
  if (env.AI_PROVIDER === 'google') {
    return google('gemini-2.0-flash');
  }
  // anthropic path: route by complexity
  return complexityScore > 0.7
    ? anthropic('claude-sonnet-4-6')
    : anthropic('claude-haiku-4-5');
}

// Detects HTTP 429 / rate-limit errors from any provider
export function detectRateLimitError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.message.includes('429') || error.message.toLowerCase().includes('rate limit');
  }
  return false;
}
```

All other files — Q&A handler, intelligence engine steps, report generator, draft generator — call `getModel()` exclusively. A global ESLint rule enforces this:

```javascript
// eslint.config.mjs
{
  rules: {
    'no-restricted-imports': ['error', {
      paths: [
        { name: '@ai-sdk/anthropic', message: 'Use getModel() from @/lib/ai/models/router instead.' },
        { name: '@ai-sdk/google', message: 'Use getModel() from @/lib/ai/models/router instead.' },
      ],
    }],
  },
}
```

This lint rule prevents the intelligence engine from accumulating untracked AI costs via hardcoded model calls that bypass the provider switch.

**Intelligence engine rate-limit behavior:** Each Inngest step in the intelligence engine that calls `getModel()` wraps the call in `try/catch`. On HTTP 429 from any provider: the step sets `intelligence_runs.status = 'skipped'` and `intelligence_runs.skipped_reason = 'rate_limit'`, then returns cleanly. It does not rethrow, does not retry, and does not fall back to a different provider. The next scheduled run will attempt again. This is critical for the Gemini free tier, which has a daily request cap. If the cap is hit at 03:00 UTC across 50 orgs, the product must degrade silently — not crash, and not secretly switch to a paid provider.

---

## Email Notification Trigger Rule

The intelligence engine triggers email notifications via Resend only when a finding has `severity = 'high'` or `severity = 'critical'`. Low and medium severity findings generate in-app notifications only. No email is sent for low or medium findings in V1.

**Cost and volume rationale:** Resend's free tier covers 3,000 emails/month. At 50 trial orgs × 1 email/day regardless of content = 1,500 emails/month, which grows linearly with org count. The trigger-only approach caps usage at roughly 150–200 emails/month permanently — most orgs will not have critical findings most days. This leaves meaningful headroom on the free tier and avoids any billing until the product has paying customers.

**Product quality rationale:** This is a product quality decision as much as a cost decision. Daily emails regardless of finding severity train users to ignore the product. An email that arrives only when there is a real problem earns attention. The correct signal that everything is fine is silence, not a daily "all clear" digest.

**Implementation: the email rule is enforced in the intelligence fan-out job, not in the email job itself.** The fan-out job evaluates finding severity after writing to the `findings` table. It dispatches an `intelligence/email.requested` event only when `highestSeverity === 'critical' || highestSeverity === 'high'`. The email job never receives an event for low or medium findings — it is never invoked in those cases.

```typescript
// jobs/intelligence/run.ts (excerpt — post-finding-storage)
const highestSeverity = getHighestSeverity(allFindings);

if (highestSeverity === 'critical') {
  await step.sendEvent('trigger-email', {
    name: 'intelligence/email.requested',
    data: { orgId, runId, delaySeconds: 0 },
  });
} else if (highestSeverity === 'high') {
  await step.sendEvent('trigger-email', {
    name: 'intelligence/email.requested',
    data: { orgId, runId, delaySeconds: 7200 }, // 2-hour delay for high severity
  });
}
// medium / low / no findings: no event dispatched. Silence is the correct signal.
```

**Email content rule:** When an email IS sent, its body contains the specific finding(s) that triggered it — with the headline, severity label, and a "View in app" link. It is not a generic summary or a digest of all findings. Every intelligence brief email includes the footer: *"You're receiving this because a high or critical finding was detected in your QuickBooks data. This is AI-generated financial analysis. Not financial advice."*

---

## Email Draft Generation (Agentic Execution)

For the agentic execution feature (Phase 9), the product generates email drafts that users copy into their own email client. V1 does **not** integrate with Gmail or Outlook.

**What this means for the stack:**
- No Gmail API (Google Workspace) integration
- No Microsoft Graph API (Outlook/Exchange) integration
- No email OAuth of any kind in V1
- The draft is plain text generated by the AI provider and stored in the `action_drafts` table
- The frontend presents the draft in a review modal with a "Copy to clipboard" button
- **The CTA is never labelled "Send" — always "Copy draft" or "Copy to clipboard"** — to maintain clarity that the product is not sending anything autonomously

**Why V1 excludes email OAuth:**

Gmail and Microsoft Graph OAuth require additional OAuth scopes, additional trust from the user (granting inbox access is a larger ask than granting read-only QB access), and introduce significant legal surface area (the product would be composing and sending financial communications on behalf of the user). The draft-and-approve model achieves 80% of the agentic value — getting the cognitive work of drafting done — at 20% of the complexity.

**Draft generation flow:**

```typescript
// The draft endpoint calls getModel() — never anthropic() or google() directly
// src/app/api/intelligence/findings/[id]/draft-action/route.ts

const model = getModel(0.5); // standard complexity — not a heavy analysis task
const result = await generateText({
  model,
  system: buildDraftSystemPrompt(actionType),
  messages: [{ role: 'user', content: buildDraftUserPrompt(finding.relatedData) }],
});

// Store in action_drafts — status starts as 'draft'
await db.insert(actionDrafts).values({
  orgId,
  userId,
  findingId: finding.id,
  actionType,
  draftContent: result.text,
  recipientEmail: finding.relatedData.clientEmail ?? null,
  subjectLine: extractSubjectLine(result.text),
  status: 'draft',
});
```

**V2 consideration:** Gmail OAuth for one-click send, if user research confirms that copy-paste friction is reducing adoption of the agentic execution feature. This is explicitly out of scope for V1 and should not be added without validating that users are abandoning the flow at the copy step.

---

## What Changed From the Original Stack

Three decisions changed between the original TECH_STACK.md and this version:

**1. Email draft generation is copy-paste only in V1 (no Gmail/Outlook OAuth)**
The original document assumed the agentic execution layer might eventually connect to the user's email client. V1 explicitly does not. The `action_drafts` table stores text; the UI shows a "Copy to clipboard" button. Gmail and Microsoft Graph OAuth are not required and not installed.

**2. The intelligence engine uses `AI_PROVIDER` — not hardcoded Claude**
The original AI Integration Layer section showed code examples calling `anthropic('claude-sonnet-4-6')` inline. This is incorrect for the intelligence engine, which must use the shared `getModel()` routing utility. The `AI_PROVIDER=google` path ensures the nightly intelligence engine runs at $0 during the trial phase. A global ESLint rule (`no-restricted-imports` on `@ai-sdk/anthropic` and `@ai-sdk/google`) enforces this across the codebase.

**3. Email notifications only trigger on high/critical findings — Resend stays within the 3,000/month free tier at any trial scale**
The original document described Resend as the email provider without specifying when notifications fire. The trigger rule (high/critical only) is now documented explicitly in this section, with the volume math showing it keeps usage well under the free tier ceiling regardless of how many trial organisations are active.

---

### Vercel AI SDK 4.2 (`ai`) + `@ai-sdk/anthropic` 1.1 + `@ai-sdk/google` 1.1

**Why the Vercel AI SDK as the abstraction layer:**

The product has a specific model-routing requirement (fast model for simple Q&A, capable model for complex analysis) and a deployment-stage requirement (Gemini free tier for trial, Claude API for production). The Vercel AI SDK normalises both.

**Every AI call in the codebase — Q&A, intelligence engine, report generation, draft generation — goes through the shared routing utility:**

```typescript
// src/lib/ai/models/router.ts — the ONLY file that calls anthropic() or google()
// See "Intelligence Engine AI Routing" section for full implementation.
// All other files call getModel() exclusively.

import { getModel } from '@/lib/ai/models/router';
import { streamText } from 'ai';

// Q&A handler — routes via the shared utility
const model = getModel(complexityScore); // complexity 0–1; high = Sonnet, low = Haiku

const result = streamText({
  model,
  system: financialContext,     // constructed from org's transaction data
  messages: conversationHistory,
});

// Streams tokens to the browser via Next.js response
return result.toDataStreamResponse();
```

The `useChat` hook on the frontend consumes this stream:

```typescript
// In the /ask page component — conversationId is pre-created on page load
const { messages, input, handleSubmit, isLoading } = useChat({
  api: `/api/conversations/${conversationId}/messages`,
  onFinish: (message) => appendDisclaimer(message),
});
```

**Streaming:** The `toDataStreamResponse()` method produces a ReadableStream compatible with Vercel's serverless function responses. The `useChat` hook renders tokens as they arrive, producing the character-by-character appearance that signals the product is actively working.

**Model switching for trial vs production:** Set `AI_PROVIDER=google` for Gemini (free tier, $0). Set `AI_PROVIDER=anthropic` for Claude. One environment variable change, zero code changes. Both the Q&A layer and the nightly intelligence engine honour this setting — there is no separate model config for each layer. See the "Intelligence Engine AI Routing" section for the full routing logic and ESLint enforcement.

### @anthropic-ai/sdk 0.32

The underlying Anthropic SDK used by `@ai-sdk/anthropic`. Required as a direct dependency for lower-level operations: token counting before sending a request (to prevent context window overflow), batch processing for monthly report generation, and direct API calls where the Vercel AI SDK abstraction is too restrictive.

**Considered and rejected:** Direct `fetch()` calls to the Anthropic API — produces more boilerplate with no benefit; the SDK's TypeScript types and streaming helpers are worth the dependency. LangChain.js — adds an abstraction layer between the application and the AI providers that makes prompt debugging harder; for a product where prompt engineering is a core competency, direct SDK access is preferable.

---

## 11. QuickBooks Integration

### intuit-oauth 4.0.4 + node-quickbooks 2.0.5

**Two libraries, two responsibilities:**

`intuit-oauth` is Intuit's official OAuth 2.0 library. It handles the PKCE flow construction, authorization URL generation, code-to-token exchange, and token refresh. This is the correct library for the auth handshake.

```typescript
import OAuthClient from 'intuit-oauth';

const oauthClient = new OAuthClient({
  clientId: process.env.QB_CLIENT_ID,
  clientSecret: process.env.QB_CLIENT_SECRET,
  environment: 'production',
  redirectUri: `${process.env.APP_URL}/api/auth/quickbooks/callback`,
});

// In the callback handler
const authResponse = await oauthClient.createToken(callbackUrl);
const { access_token, refresh_token, expires_in } = authResponse.getJson();
```

`node-quickbooks` is the community library for the QuickBooks Accounting API. It has 2.5M+ weekly npm downloads, is actively maintained, and covers the API endpoints this product needs: `getCompanyInfo`, `queryTransactions`, `getChartOfAccounts`, `queryInvoices`.

```typescript
import QuickBooks from 'node-quickbooks';

const qbo = new QuickBooks(
  clientId, accessToken, false, true, realmId, true, false, null, '2.0', '4.0'
);

// Paginated transaction query — handles rate limiting internally
qbo.queryTransactions({
  "select * from Transaction where TxnDate >= '2025-01-01' ORDER BY TxnDate",
}, callback);
```

**Rate limiting:** QuickBooks allows 500 API calls per minute per realm. The sync job implements exponential backoff (30s, 60s, 120s) via Inngest's retry semantics when it receives HTTP 429.

**Considered and rejected:** A fully custom implementation using `fetch()` — viable but requires implementing the complete OAuth PKCE flow, token refresh logic, pagination, and error handling from scratch. The `intuit-oauth` + `node-quickbooks` combination provides battle-tested implementations of all of these.

---

## 12. Xero Integration

### xero-node 9.3

**Why this library specifically:** `xero-node` is the official Xero-maintained Node.js SDK. It provides TypeScript types for every Xero API response, built-in OAuth 2.0 PKCE support, and handles Xero's specific token refresh semantics (60-day inactivity expiry, per-tenant token scoping).

```typescript
import { XeroClient } from 'xero-node';

const xero = new XeroClient({
  clientId: process.env.XERO_CLIENT_ID,
  clientSecret: process.env.XERO_CLIENT_SECRET,
  redirectUris: [`${process.env.APP_URL}/api/auth/xero/callback`],
  scopes: ['accounting.transactions.read', 'accounting.accounts.read'],
});

// Retrieve transactions for normalization into the shared schema
const transactions = await xero.accountingApi.getJournals(tenantId, null, offset);
```

**Schema normalization:** Xero's transaction model differs from QuickBooks'. The integration layer normalizes both into the product's internal `Transaction` type before storage. Xero's `Journal` entries map to the same `{id, date, amount, category, description, type}` schema as QuickBooks transactions. Unmapped Xero tracking categories are written to `Other / Uncategorized` and logged to the data quality table.

**Considered and rejected:** `xero-accounting-api` — an older community library, superseded by the official `xero-node`. Custom implementation — Xero's API has specific quirks (multi-tenancy at the API level, mandatory `Xero-Tenant-Id` headers) that the official SDK handles correctly.

---

## 13. Plaid Integration (P2)

### plaid 28.0

P2 — not built until P0/P1 is validated with paying customers.

**Why this library when it is built:** `plaid` is the official Plaid Node.js SDK with TypeScript support. For this product, it will be used for the Transactions product (historical and real-time bank transactions) and Accounts product (balance data). The per-item cost (~$0.50/month) is the reason Plaid is P2 — it introduces a variable infrastructure cost that requires paying customers to justify.

---

## 14. Billing and Payments

### stripe 16.12 + @stripe/stripe-js 4.5

**Why Stripe:** Stripe is the de facto standard for SaaS billing. The specific features this product needs — subscription management, monthly recurring billing, webhook-driven quota updates, Stripe Customer Portal for self-service billing management — are all first-class Stripe features.

**Implementation pattern:**
- Stripe Checkout for new subscriptions (redirect to Stripe-hosted checkout, return on success)
- Stripe Customer Portal for managing existing subscriptions (payment method update, cancellation)
- Stripe webhooks (`customer.subscription.updated`, `customer.subscription.deleted`) to sync subscription state back to the database
- The webhook handler updates `organizations.subscription_tier` and `organizations.query_quota` immediately on receipt

**Trial-to-paid handoff:** When an organization upgrades from trial, the Stripe webhook fires, the database updates, and the next query request finds a new quota — no manual intervention required.

**Free deployment alignment:** Stripe is not used in the trial deployment. The `stripe` package is installed but the billing routes return placeholder responses until the first paying customer. No Stripe account is needed until launch.

**Considered and rejected:** Paddle — strong alternative with VAT handling for EU, but Stripe's documentation, webhook reliability, and Next.js integration are more mature. Lemon Squeezy — growing platform but less mature webhook tooling. Custom billing — not viable; subscription lifecycle management (trials, upgrades, downgrades, failed payment recovery) is non-trivial to build correctly.

---

## 15. Caching and Rate Limiting

### @upstash/redis 1.34 + @upstash/ratelimit 2.0

**Two use cases, one service:**

**Use case 1 — AI response caching:** Identical financial questions asked within the same billing cycle (e.g., "What was my revenue last month?" asked twice on the same day) return the same data. Caching these responses in Redis with a TTL tied to the sync interval prevents redundant AI API calls. The cache key is `{orgId}:{questionHash}:{lastSyncTimestamp}` — the sync timestamp ensures cached responses invalidate when new data arrives.

**Use case 2 — Rate limiting per organization:** The `/api/ask` route is rate-limited per organization using `@upstash/ratelimit` with a sliding window algorithm. This prevents a single organization from exhausting the AI API quota (separate from the subscription query quota, which is enforced at the database layer).

```typescript
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, '60 s'), // 10 requests per 60 seconds per org
  prefix: 'ratelimit:ask',
});

// In the /api/ask route handler
const { success, remaining } = await ratelimit.limit(orgId);
if (!success) return new Response('Rate limit exceeded', { status: 429 });
```

**Free deployment:** Upstash Redis free tier: 10K commands per day, 256MB storage. At trial scale (50 orgs, each asking ~5 questions/day), the free tier comfortably covers usage.

**Considered and rejected:** Vercel KV — Upstash Redis under the hood; same product, slightly higher pricing. Redis Cloud — requires managing a Redis instance; Upstash is serverless and works with Vercel Edge Functions without connection pool management. In-memory caching (Node.js `Map`) — not shared across Vercel serverless function instances; each cold start begins with an empty cache, making it useless for rate limiting.

---

## 16. Email Delivery

### Resend 4.0

**Why:** Resend is the modern transactional email service with a React-based email template system (`react-email`). This product sends three email types: magic link sign-in, financial alert notifications, and monthly summary reports. Resend's free tier handles 3,000 emails/month — sufficient for a trial deployment with 50–100 organizations.

```typescript
import { Resend } from 'resend';
const resend = new Resend(process.env.RESEND_API_KEY);

// Monthly report delivery — full report body in the email
await resend.emails.send({
  from: 'reports@yourapp.com',
  to: adminEmail,
  subject: `Your ${monthLabel} Financial Summary`,
  html: reportHtml, // generated by @react-email/components
});
```

**Considered and rejected:** SendGrid — more expensive, more configuration overhead for a product that sends three email types. AWS SES — very cheap at scale but requires domain verification, suppression list management, and more infrastructure setup than Resend.

---

## 17. PDF and CSV Generation

### @react-pdf/renderer 4.1 (PDF) + papaparse 5.5 (CSV)

**PDF — monthly report export:**
`@react-pdf/renderer` generates PDFs from React component trees without a headless browser. The monthly financial summary report is a React component (`ReportDocument`) that renders to PDF on demand:

```typescript
import { Document, Page, Text, View } from '@react-pdf/renderer';

export const ReportDocument = ({ report, org }) => (
  <Document>
    <Page style={styles.page}>
      <Text style={styles.title}>{report.month} Financial Summary</Text>
      <Text style={styles.body}>{report.narrative}</Text>
      <Text style={styles.disclaimer}>{DISCLAIMER_TEXT}</Text>
    </Page>
  </Document>
);

// In the API route
const pdfBuffer = await renderToBuffer(<ReportDocument report={report} org={org} />);
```

**CSV — structured financial data export:**
`papaparse` handles both CSV parsing (for CSV upload from QuickBooks exports) and CSV generation (for the structured financial data export). The CSV export produces one row per metric, not the narrative text:

```typescript
import Papa from 'papaparse';
const csv = Papa.unparse(financialMetrics); // array of {period, category, value, ...}
```

**Considered and rejected for PDF:** Puppeteer / Playwright for PDF — both use headless Chromium; the binary size (~300MB) is incompatible with Vercel serverless functions (250MB limit). `pdfkit` — lower-level, requires manual text layout calculation; `@react-pdf/renderer` generates PDFs from the same component model as the rest of the UI. For CSV: custom `Array.join(',')` — `papaparse` handles edge cases (commas in organization names, special characters in transaction descriptions) that a naive implementation misses.

---

## 18. Input Validation

### Zod 3.24 + react-hook-form 7.55

**Zod** validates API route inputs (organization creation, QuickBooks callback parameters, AI query body) and defines the canonical TypeScript types for the data layer:

```typescript
export const TransactionSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  date: z.coerce.date(),
  amount: z.number().finite(), // never NaN, never Infinity
  category: TransactionCategoryEnum,
  description: z.string().max(500),
  transactionType: z.enum(['income', 'expense']),
  externalId: z.string().optional(), // QuickBooks/Xero ID
});

export type Transaction = z.infer<typeof TransactionSchema>;
```

**react-hook-form** manages the onboarding forms (organization creation, settings forms) with Zod resolvers for validation. Uncontrolled inputs keep renders minimal.

---

## 19. Environment Variable Management

### @t3-oss/env-nextjs 0.11

This product has 15+ environment variables (database URL, OAuth client IDs and secrets for two platforms, AI API keys, Stripe keys, Inngest keys, encryption key). `@t3-oss/env-nextjs` validates the environment at build time using Zod schemas:

```typescript
export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
    QB_CLIENT_ID: z.string().min(1),
    QB_CLIENT_SECRET: z.string().min(1),
    // AI provider switch — controls BOTH Q&A and nightly intelligence engine
    // 'google'    → Gemini 2.0 Flash via Google AI Studio (free tier, $0)
    // 'anthropic' → Claude Haiku 4.5 / Sonnet 4.6 via Anthropic API (paid)
    // Default for all dev and trial deployments: 'google'
    AI_PROVIDER: z.enum(['google', 'anthropic']).default('google'),
    ANTHROPIC_API_KEY: z.string().startsWith('sk-ant-').optional(),  // required when AI_PROVIDER=anthropic
    GOOGLE_AI_API_KEY: z.string().min(1).optional(),                 // required when AI_PROVIDER=google
    OAUTH_TOKEN_ENCRYPTION_KEY: z.string().length(64), // 32 bytes hex
    STRIPE_SECRET_KEY: z.string().startsWith('sk_'),
    INNGEST_SIGNING_KEY: z.string().min(1),
    RESEND_API_KEY: z.string().min(1),
    FROM_EMAIL: z.string().email(),
  },
  runtimeEnv: process.env,
});
```

A missing or malformed environment variable fails the build, not the runtime. This prevents the class of production incidents where a misconfigured deployment silently fails at 3am when the first OAuth callback arrives.

---

## 20. Hosting and Deployment

### Vercel (frontend + API routes + cron trigger)

**Free tier for trial:** Vercel Hobby — $0, custom domain, global CDN, automatic HTTPS, preview deployments on every pull request.

**Production:** Vercel Pro at $20/month when the 10-second function timeout constraint becomes limiting for complex financial analysis queries. (Streaming mitigates this for most AI calls; Pro extends the timeout to 300 seconds for non-streaming operations.)

**Deployment flow:** Push to `main` → Vercel automatically builds and deploys. Feature branches get preview URLs (`/feature-name.vercel.app`) with isolated environment variables for testing.

### Supabase (database + auth)

**Free tier for trial:** 500MB storage, 50K MAU, 2 active projects.

**Production:** Supabase Pro at $25/month, unlocks daily backups, point-in-time recovery, and removes the inactivity pause.

**Data residency:** Supabase allows region selection at project creation (US East, EU West, etc.). For a product handling financial data, select the region closest to the primary user base. EU users require EU data residency for GDPR compliance.

---

## 21. Testing

### Vitest 2.1 (unit + integration) + Playwright 1.49 (end-to-end)

**Vitest 2.1:**

```bash
pnpm test          # all unit tests
pnpm test:watch    # watch mode during development
pnpm test:coverage # coverage report
```

**What gets unit tested:**
- All financial calculation functions (`src/lib/financial/`) — the sum-by-category, cash-position, burn-rate functions must be tested against known inputs and outputs before any AI prompt calls them
- Zod schema validation
- OAuth token encryption/decryption
- Alert condition evaluation logic
- Transaction normalization (QuickBooks → internal schema, Xero → internal schema)

**Playwright 1.49:**

E2E tests for the three critical paths that cannot fail in production:
1. Magic link → onboarding → QuickBooks OAuth → sync complete → first question answered
2. AI Q&A → quota exhausted → upgrade → quota refreshed
3. Monthly report generation → PDF export

```bash
pnpm test:e2e         # runs against localhost
pnpm test:e2e:staging # runs against staging Vercel preview
```

**Why Vitest over Jest:** Vitest uses the same Vite configuration as Next.js, produces faster cold starts (native ESM, no CommonJS transform overhead), and has compatible test syntax (`describe`, `it`, `expect`) — migration from Jest-based tests is a one-line config change.

**Why Playwright over Cypress:** Playwright runs tests in parallel across Chrome, Firefox, and WebKit in a single command. Cypress requires a paid tier for parallelization. Playwright's API for intercepting network requests (for mocking QuickBooks OAuth in CI) is cleaner.

---

## 22. Code Quality and Developer Experience

### ESLint 9.6 + Prettier 3.4 + Husky 9.1 + lint-staged 15.x

**ESLint 9.6** with flat config:
- `@typescript-eslint/parser` for TypeScript-aware linting
- `eslint-plugin-react-hooks` — prevents stale closure bugs in the AI streaming hooks
- Custom rule: no direct `process.env` access (must use the validated `env` object from T3 env)

**Prettier 3.4** — code formatting. Financial codebases benefit from consistent formatting; style debates waste time that should go into prompt engineering.

**Husky 9.1** — pre-commit hooks. `lint-staged` runs ESLint and Prettier only on staged files, making commits fast. `vitest run --reporter=dot` runs the fast unit test suite (financial calculations) on pre-push.

---

## What We Are NOT Using

**Prisma** — replaced by Drizzle ORM. Prisma's generated client adds query overhead that compounds across the aggregation-heavy financial calculation layer. Prisma's `prisma.$queryRaw` escape hatch produces unsafe TypeScript types for complex aggregations. Drizzle's zero-overhead query builder is the correct choice when query performance and type safety are both required.

**Auth.js (NextAuth.js)** — replaced by Supabase Auth. Auth.js has no integration with PostgreSQL Row Level Security; it treats the database as a session store, not a security boundary. Multi-tenant isolation in Auth.js must be enforced at every query in application code. Supabase Auth's JWT-to-RLS integration enforces isolation at the database layer, which is the stronger security model for financial data.

**Clerk** — replaced by Supabase Auth. Clerk has excellent DX but stores user identity on Clerk's infrastructure. For a product handling financial data, reducing third-party data dependencies is a deliberate choice. Supabase Auth's magic link implementation is sufficient.

**LangChain.js / LlamaIndex** — not used. These libraries abstract prompt management in ways that make debugging harder. For this product, prompt engineering is a first-class concern — the prompts are versioned TypeScript string templates, not hidden inside a framework. The Vercel AI SDK provides the streaming and provider-switching layer without abstracting away prompt content.

**tRPC** — not used. Next.js App Router's Route Handlers produce fully type-safe API endpoints when combined with Zod validation and TypeScript. tRPC adds a layer of abstraction and a client-side adapter that is valuable in pure SPA architectures but redundant in a Server Component-first Next.js application.

**React Query / TanStack Query** — not used. The Vercel AI SDK's `useChat` hook handles all streaming state management for the AI layer. Next.js Server Components handle data fetching for the dashboard. React's built-in `useState` and `useOptimistic` handle the UI state that remains. Adding React Query would introduce a parallel cache that must be kept synchronized with Next.js's own cache.

**Redux / Zustand** — not used. The product's client-side state is limited: the current chat thread, loading indicators, and notification panel open/closed state. React's built-in hooks handle all of this. Global state management libraries address scale problems this product does not yet have.

**Docker / containerization** — not used. Vercel's serverless infrastructure handles deployment without container management. The background job layer (Inngest) is also serverless. Containerization is the right choice for a different infrastructure model (Kubernetes, ECS); it would add operational overhead with no benefit here.

**Jest** — replaced by Vitest. Jest requires CommonJS/Babel transform configuration to work with Next.js's ESM-first module system. Vitest runs natively in the same ESM environment as the application and is 3–5× faster on cold starts.

**Cypress** — replaced by Playwright. Cypress requires a paid plan for CI parallelization and does not support multiple browser engines in the same test run. Playwright provides cross-browser testing and better API mocking in a single free tool.

**Puppeteer / Playwright for PDF generation** — both replaced by `@react-pdf/renderer`. Headless Chromium binaries exceed Vercel's 250MB function payload limit. PDF generation must happen without a browser process.

**Self-hosted Redis** — replaced by Upstash. A Redis server requires infrastructure management, connection pooling, and availability monitoring. Upstash provides serverless Redis with HTTP-based access that works inside Vercel Edge Functions without a persistent connection.

**Vercel Cron Jobs alone** — insufficient for production. Vercel Hobby supports 1 cron job; the product requires at minimum 3 distinct scheduled processes. More importantly, cron jobs lack the retry logic, dead-letter queues, and per-job observability that a production data sync pipeline requires. Inngest provides job queue semantics on top of cron scheduling.

**Neon** — PostgreSQL but without Supabase's integrated Auth/RLS management. The multi-tenant RLS architecture is the reason Supabase is in this stack; Neon would require a separate auth service and manual RLS setup without the Supabase Auth JWT integration.

**Monorepo tooling (Turborepo / Nx)** — not used at V1. The five-layer architecture is a code organization pattern within a single Next.js application, not a multi-package monorepo. Turborepo adds tooling overhead that is appropriate when there are truly separate deployable units. At V1, all five layers live in one project with clear directory boundaries.

---

## Package Manager and Runtime

**Runtime:** Node.js 22 LTS  
Node 22 is the current LTS release. It ships native `fetch`, `ReadableStream`, and Web Crypto APIs without polyfills — the three browser APIs this product uses for AI streaming, HTTP responses, and OAuth token encryption. Verify the latest LTS point release at implementation time.

**Package Manager:** pnpm 9.15  
`pnpm` uses a content-addressable store that deduplicates packages across projects, making `node_modules` significantly smaller than `npm`. For a project with 40+ production dependencies (two OAuth platforms, AI SDKs, database drivers, charting library), install time and CI cache efficiency matter. pnpm also enforces stricter dependency resolution — a package cannot silently access a transitive dependency that isn't in its own `package.json`, which surfaces integration mistakes earlier.

```
node --version  → v22.x.x
pnpm --version  → 9.15.x
```

---

## Dependency Summary

| Category | Package | Version |
|---|---|---|
| Framework | `next` | 15.3.x |
| Language | `typescript` | 5.7.x |
| UI Runtime | `react`, `react-dom` | 19.1.x |
| Styling | `tailwindcss` | 4.1.x |
| Components | `@radix-ui/react-*` | 1.1.x |
| Charting | `recharts` | 2.15.x |
| Database client | `@supabase/supabase-js` | 2.48.x |
| SSR session | `@supabase/ssr` | 0.5.x |
| ORM | `drizzle-orm` | 0.36.x |
| ORM migrations | `drizzle-kit` | 0.27.x |
| Background jobs | `inngest` | 3.27.x |
| AI SDK | `ai` | 4.2.x |
| AI — Anthropic | `@ai-sdk/anthropic` | 1.1.x |
| AI — Google | `@ai-sdk/google` | 1.1.x |
| Anthropic SDK | `@anthropic-ai/sdk` | 0.32.x |
| QuickBooks OAuth | `intuit-oauth` | 4.0.4 |
| QuickBooks API | `node-quickbooks` | 2.0.5 |
| Xero | `xero-node` | 9.3.x |
| Plaid (P2) | `plaid` | 28.0.x |
| Stripe server | `stripe` | 16.12.x |
| Stripe client | `@stripe/stripe-js` | 4.5.x |
| Cache / rate limit | `@upstash/redis` | 1.34.x |
| Rate limiting | `@upstash/ratelimit` | 2.0.x |
| Email | `resend` | 4.0.x |
| PDF generation | `@react-pdf/renderer` | 4.1.x |
| CSV | `papaparse` | 5.5.x |
| Validation | `zod` | 3.24.x |
| Forms | `react-hook-form` | 7.55.x |
| Env validation | `@t3-oss/env-nextjs` | 0.11.x |
| Unit testing | `vitest` | 2.1.x |
| Component testing | `@testing-library/react` | 16.3.x |
| E2E testing | `playwright` | 1.49.x |
| Linting | `eslint` | 9.6.x |
| Formatting | `prettier` | 3.4.x |
| Git hooks | `husky` | 9.1.x |
| Staged lint | `lint-staged` | 15.x |
| Script runner | `tsx` | 4.x | (dev dependency — runs TypeScript scripts in `scripts/` directly via `pnpm tsx`) |

> All versions reflect stable releases as of mid-2025. Verify current stable versions at implementation time. Pin exact versions in `package.json` using `pnpm add package@x.y.z` — never floating ranges for production dependencies.
