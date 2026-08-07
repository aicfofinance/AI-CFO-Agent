# App Flow Document
## CFO Lens — V1 Demo

**Version:** 1.0 — Reflects live deployment at `ai-cfo-agent-e64g.vercel.app`  
**Date:** August 2026  
**Scope:** Web application. Mobile native is out of scope for V1.

**Core UX model:**
1. **Intelligence Feed** (`/dashboard`) — the owner opens the app and sees what the AI found. A prioritized list of active findings requiring attention, with a resolved section below showing what has already been actioned or dismissed.
2. **Cash Flow Timeline** (`/cashflow`) — forward-looking 30/60/90-day projection of cash position with risk dates and confidence level.
3. **Ask** (`/ask`) — conversational Q&A. Context-aware empty state. Chat history persists via localStorage between sessions.
4. **Reports** (`/reports`) — monthly AI-generated financial summaries. Manual generation available.
5. **Settings** (`/settings`) — sidebar sub-navigation with Connections, Account, Notifications, Billing.

> **Agentic execution constraint (non-negotiable):** The product never sends, submits, or transmits any communication on the user's behalf. Every agentic output is a text draft. The user copies it and sends it from their own email client.

> **Auth:** Magic link authentication via Supabase Auth. No passwords.

> **AI provider:** Anthropic Claude Haiku 4.5 (complexity < 0.7) and Claude Sonnet 5 (complexity ≥ 0.7). Routing controlled exclusively by `src/lib/ai/models/router.ts`.

---

## Section 1: Screen Inventory

---

### UNAUTHENTICATED SCREENS

---

#### Screen: Landing page
- **Route:** `/`
- **Access:** Unauthenticated. Authenticated users redirect to `/dashboard`.
- **Purpose:** Marketing page. Data sovereignty promise. Three value propositions.
- **Content:** Hero headline, Bench story, trust bar "Read-only. No lock-in.", CTAs to register and sign in.

| Action | Result |
|---|---|
| "Start free trial" | `/register` |
| "Coming from Bench? Start here →" | `/register?source=bench` |
| "Sign in" | `/login` |

---

#### Screen: Registration
- **Route:** `/register`
- **Access:** Unauthenticated. Authenticated users redirect to `/dashboard`.
- **Purpose:** Email capture → magic link sent.

| Action | Success | Failure |
|---|---|---|
| Submit email | `/check-email` | Invalid email: inline error |

---

#### Screen: Login
- **Route:** `/login`
- **Access:** Unauthenticated. Authenticated redirect to `/dashboard`.

| Action | Success | Failure |
|---|---|---|
| Submit email | `/check-email` | Rate limit: "Too many requests" |

---

#### Screen: Check email
- **Route:** `/check-email`
- **Purpose:** Magic link sent confirmation. Resend option.

| Action | Result |
|---|---|
| Click magic link | → `/api/auth/callback` |
| "Resend link" | Same page, "Link resent" |

---

#### Screen: Auth callback
- **Route:** `/api/auth/callback`
- **Purpose:** Validates token, establishes session, routes user.
- **Display:** Full-screen spinner "Signing you in…"

| Condition | Redirect |
|---|---|
| New user | `/onboarding` (CSV upload) |
| Returning user, data ready | `/dashboard` |
| Returning user, no connection/data | `/onboarding` |
| Expired/invalid token | `/login` with "This link has expired." |

---

### ONBOARDING

---

#### Screen: Onboarding — CSV upload
- **Route:** `/onboarding` (or `/onboarding/csv`)
- **Access:** Authenticated, no data connected yet.
- **Purpose:** Upload a QuickBooks Transaction Detail Report CSV or bank statement export. The demo's primary data connection path.
- **Content:** File input (`.csv` only), format guidance, data sovereignty statement ("Read-only. We can never create or modify a transaction."), connect QB/Xero option.

**After successful upload:** Summary shown — "[N] transactions imported from [date range]." Persistent banner: "Your imported data is a static snapshot. Connect QuickBooks or Xero for live monitoring."

**Post-upload routing:** Sync job triggers → intelligence engine runs → `/dashboard`.

| Action | Success | Failure |
|---|---|---|
| Upload valid CSV | Transactions imported → summary → `/dashboard` | Invalid format: "We couldn't read this file." File too large: "Try a shorter date range." |
| "Connect QuickBooks instead" | `/onboarding/connect` | — |

> **Note:** QuickBooks and Xero OAuth flows are implemented in the codebase (`/api/auth/quickbooks/initiate`, `/api/auth/xero/initiate`) but the demo UI routes users through CSV upload. The connect screen (`/onboarding/connect`) is accessible for QB/Xero OAuth.

---

### CORE APPLICATION SCREENS

---

#### Screen: Intelligence Feed
- **Route:** `/dashboard`
- **Access:** Any authenticated org member.
- **Purpose:** The product's primary surface. What the AI found — prioritized, actionable findings.

**Header:** "Intelligence Feed" + "Last updated [date]" + "🔒 Read-only — your books are unchanged" badge.

**Active findings section:**
Each finding card shows:
- **Severity badge:** Critical / High / Medium / Low
- **Headline:** Plain English, e.g., "$498,900 in overdue invoices"
- **Detail:** 2–3 sentence explanation
- **Two CTAs:** "Take action" (→ Agentic Execution modal) and "Tell me more →" (→ `/ask?finding_id=[id]`)

**Resolved findings section (below active):**
Heading: "Resolved · [N]". Shows all dismissed and actioned findings with a status badge ("Actioned" or "Dismissed"). Rendered at reduced opacity. Allows users to see their full finding history without navigating elsewhere.

**Empty state — all clear:**
> "All clear — no urgent findings"
> What CFO Lens checked: Cash flow projection ✓, Expense spike detection ✓, Collections slippage ✓, Gross margin vs prior year ✓, Overdue AR aging ✓, Duplicate subscription scan ✓
> Next scan: [time]
> CTA: "Ask a question →"

**Empty state — insufficient data (< 60 days):**
Progress bar showing days available vs. 60 required. Lists what activates at 60 days.

| Action | Result |
|---|---|
| "Take action" on finding | Agentic Execution modal |
| "Tell me more →" on finding | `/ask?finding_id=[id]` |

---

#### Screen: Cash Flow Timeline
- **Route:** `/cashflow`
- **Access:** Any authenticated org member.
- **Purpose:** Forward-looking cash position projection. 30/60/90-day view tabs.

**Data displayed:**
- Confidence level badge: High / Medium / Low (based on history length)
- Line chart: projected daily balance over the period
- Risk date markers: red flags with projected shortfall amount and date
- Detail panel: projected inflows (AR schedule) and outflows (recurring expenses)
- Detail panel per day: inflow/outflow breakdown
- "Accelerate these invoices" CTA when risk dates are present

**Confidence levels:**
- High: 180+ days history
- Medium: 90–179 days
- Low: 30–89 days (directional only)

**Disclaimer (always visible):** "AI-generated projection from your accounting data as of [date]. Not a guarantee of future cash position. Not financial advice."

**Empty state — insufficient data (< 60 days):** Shows progress bar, explains what requires more history, offers Q&A shortcuts.

| Action | Result |
|---|---|
| Switch 30/60/90 tabs | Timeline re-renders |
| Click risk date marker | Detail panel expands inline |
| "Accelerate these invoices" | Agentic Execution modal |
| "Tell me more →" | `/ask?context=cashflow` |

---

### AGENTIC EXECUTION FLOW (modal overlay — no route change)

Triggered by "Take action" on any finding card. A modal overlay on the current screen. The finding type determines which draft action is offered (invoice acceleration for `collections_opportunity`, subscription cancellation for `duplicate_subscription`, etc.).

---

**State 1 — Confirm:**
Shows finding summary. "Draft a collections reminder?" Sub-text: "The AI will draft a professional email you can review before copying."

| Action | Result |
|---|---|
| "Draft it" | → State 2 |
| "Not now" | Modal closes. Finding persists. |

---

**State 2 — Generating:**
Animated progress bar. "Drafting your message..." (2–4 seconds).

| Condition | Result |
|---|---|
| Draft generated | → State 3 |
| Generation fails | "Draft generation failed. [Try again] [Cancel]" |

---

**State 3 — Review:**
Full draft displayed (subject + body). Editable inline. Disclaimer banner: "This draft was generated by AI using your QuickBooks data. Review it before sending."

| Action | Result |
|---|---|
| Edit any field | Inline editing |
| "Looks good →" | → State 4 |
| "← Start over" | → State 1 |

---

**State 4 — Copy:**
Read-only final draft. Prominent "📋 Copy to clipboard" button. Sub-text: "Paste this into your email client and send it. This product never sends on your behalf."

| Action | Result |
|---|---|
| "Copy to clipboard" | Copied. → State 5. |
| "← Edit" | → State 3 |

---

**State 5 — Done:**
"✓ Copied to clipboard". "Open your email client, paste, and send." Optional "Mark as sent" toggle — sets finding status to `actioned` which moves it to the Resolved section on the Intelligence Feed.

---

**Failure — no email on file:** Draft generates fully. "To:" field shows placeholder. Warning: "QuickBooks doesn't have an email address for [client]. Add their address when you paste."

---

#### Screen: Ask a question
- **Route:** `/ask`
- **Access:** Any authenticated org member.
- **Purpose:** Conversational Q&A. Secondary to the Intelligence Feed.

**Chat history persistence:** Conversation is saved to browser `localStorage` (key: `cfolens_ask_session`). On returning to `/ask`, the previous conversation loads automatically. No additional API call needed for restoration.

**"New conversation" button:** Appears in the page header once messages exist. Clears localStorage, creates a new conversation via `POST /api/conversations`, and resets to the empty state.

**Empty state variants:**

*If active critical or high-severity finding exists:*
"Needs your attention" section with the finding headline and "Tell me more about this" button (auto-submits the question).

*If arrived via `?finding_id=` param:*
Context block showing the finding headline. First message auto-submitted: "Tell me more about: [headline]".

*No active findings (healthy):*
"What would you like to know?" with four suggested question chips: "What are my top expenses this month?", "How does my cash flow look for the next 30 days?", "Which invoices are most overdue?", "How does my revenue compare to last month?"

**Quota exhaustion:** System message in thread, input read-only, upgrade CTA → `/settings/billing`.

**Disclaimer (appended to every AI response):** "This is AI-generated analysis of your accounting data. It is not financial advice. Consult a qualified financial professional for decisions requiring expert judgment."

---

#### Screen: Reports
- **Route:** `/reports`
- **Access:** Any authenticated org member.
- **Purpose:** Monthly AI-generated financial summaries. Generate on demand or wait for monthly cron (1st of each month, 5am UTC).

**Reports list (when reports exist):**
Card grid showing each report with:
- Month name and year (e.g., "July 2026")
- Status badge: `ready` (green), `generating` (amber), `failed` (red), `pending` (gray)
- For `ready` reports: "View" link and "Export" link (downloads `.txt` file with financial summary + AI narrative)
- Generated date

**Empty state:**
FileText icon, "No reports yet", explanation: "Monthly reports are generated automatically on the 1st of each month. Your first report will appear here after your next scheduled run."

**"Generate last month's report" button:**
Available in both empty state and reports list. POSTs to `/api/reports/generate`, shows loading state, then success message "Report generation started. Check back in ~1 minute." Does not navigate away. After ~30–60 seconds, refresh to see the report card.

**Report content (when ready):**
- Structured metrics: revenue, expenses, net profit, gross margin %, MoM changes
- Top expense and revenue categories
- AI-generated 3–4 paragraph executive narrative
- Export as plain text with formatted financial summary

> **Note:** Individual report view (`/reports/:id`) with full-screen narrative display is planned (P2). Currently reports are read via the Export link.

---

### SETTINGS SCREENS

---

#### Screen: Settings layout
- **Route:** `/settings` → redirects to `/settings/connections`
- **Layout:** Two-column. Left: sidebar navigation (Connections, Account, Notifications, Billing). Right: content area for the active sub-page.
- **Active link styling:** `bg-[var(--primary-50)] font-medium text-[var(--primary-600)]`.

---

#### Screen: Connections
- **Route:** `/settings/connections`
- **Purpose:** View and manage accounting data connections.

**Content:**
- Data sovereignty notice: "Read-only access. Always. CFO Lens connects to your accounting software but never writes to it."
- QuickBooks card: Shows connect/disconnect CTA, last synced date, last intelligence run date, sync status badge.
- Xero card: Same structure as QuickBooks. Mutually exclusive with QuickBooks.
- CSV import note (when CSV data exists): "You have a CSV import. Connect QuickBooks or Xero for live monitoring."

**Status badges:** Connected (green), Syncing (amber), Sync failed (red), Reconnect required (red).

---

#### Screen: Account
- **Route:** `/settings/account`
- **Purpose:** Account info and data privacy controls.

**Content:**
- Header: display name, role, plan tier
- Data & Privacy section: "Read-only access" notice
- "Download your data" button: exports zip file containing:
  - `conversations/conversations.json` — full conversation history with messages
  - `findings/findings.json` — all intelligence findings
  - `action_drafts/drafts.json` — all AI-generated email drafts
  - `reports/index.json` — monthly report index
  - `README.txt` — export explanation

---

#### Screen: Notification Preferences
- **Route:** `/settings/notifications`
- **Purpose:** Configure which alert types are enabled and how they are delivered.

**Content:**
- Four alert type rows: Cash Flow Risk, Expense Spike, Collections Opportunity, Duplicate Subscription
- Per row: Enabled toggle + Email toggle (email toggle only visible when enabled)
- Email delivery policy (informational): "Email is sent only for critical and high severity findings."
- "Opt out of all email" master toggle at the bottom

---

#### Screen: Billing
- **Route:** `/settings/billing`
- **Purpose:** Plan information and usage.

**Content:**
- "Current plan" card: plan tier badge (Trial), queries-used progress bar (`aria-role="progressbar"`), "N of 20 queries used this month" text
- "Need more?" card: upgrade description, active "Contact sales" link → `mailto:ai.cfofinance@gmail.com?subject=CFO%20Lens%20upgrade%20enquiry`
- Sub-text: "Opens your email client to reach our team at ai.cfofinance@gmail.com"

---

## Section 2: User Flows

---

### Flow 1: New user — CSV import to first intelligence findings

```
1.  User arrives at /
2.  Reads copy → clicks "Start free trial"
3.  /register → enters email → magic link sent → /check-email
4.  Opens email → clicks link → /api/auth/callback
5.  New user → /onboarding (CSV upload)
6.  Reads data sovereignty statement
7.  Uploads quickbooks-demo-anomalies.csv
8.  "[N] transactions imported from [date range]" summary shown
9.  Sync job triggers in background (Inngest)
10. Intelligence engine runs → findings created
11. → /dashboard
12. Intelligence Feed shows active findings:
    - HIGH: "$498,900 in overdue invoices — collect outstanding receivables"
    - MEDIUM: "Alert: Daily expenses spiked — 58% above 30-day average"
13. Resolved section: any actioned/dismissed findings from prior sessions
```

---

### Flow 2: Proactive alert → agentic execution → draft copied

```
Background:
1.  Intelligence engine: 32 invoices totaling $498,900 overdue (some 6+ months)
2.  HIGH finding: "collections_opportunity"
3.  Email sent (high severity rule)

User acts:
4.  User opens email → "View finding →" → /dashboard
5.  HIGH finding card at top with "Take action" CTA
6.  User clicks "Take action"

Agentic execution:
7.  Modal State 1: "Draft a collections reminder?" → "Draft it"
8.  State 2: "Drafting your message..." (2–4 seconds, Anthropic Haiku)
9.  State 3: Review draft — professional collections email — "Looks good →"
    Disclaimer: "This draft was generated by AI. Review before sending."
10. State 4: "📋 Copy to clipboard"
11. State 5: "✓ Copied" — user opens Gmail, pastes, adds recipient, sends
12. "Mark as sent" toggle → finding moves to Resolved section
```

---

### Flow 3: Ask AI about a finding → contextual Q&A

```
1.  User on /dashboard
2.  Sees HIGH finding: "$498,900 in overdue invoices"
3.  Clicks "Tell me more →"
4.  /ask?finding_id=[id]
5.  Context block shown: "Needs your attention — $498,900 in overdue invoices"
6.  "Tell me more about this" button auto-submits question
7.  AI responds with AR aging breakdown, recommendations, cash flow impact
8.  All responses end with standard financial disclaimer
9.  User asks follow-up: "Which client owes the most?"
10. AI responds with client-specific breakdown
11. Previous conversation restored on next visit to /ask (localStorage)
```

---

### Flow 4: Generate monthly report manually

```
1.  User on /reports
2.  Sees empty state: "No reports yet"
3.  Clicks "Generate last month's report"
4.  Button shows loading state "Generating..."
5.  POST /api/reports/generate → Inngest event queued
6.  Button shows: "Report generation started. Check back in ~1 minute."
7.  User refreshes after 60 seconds
8.  Report card appears: "July 2026" — green "Ready" badge
9.  User clicks "Export" → downloads text file with:
    - Financial summary (revenue, expenses, net profit, gross margin)
    - AI narrative: "July revenue of $30,700 represented a significant
      contraction from prior months, driven by reduced client billings..."
    - Standard financial disclaimer
```

---

### Flow 5: Check cash flow projection

```
1.  User on /dashboard
2.  Sees cash flow projection in navigation or clicks Cash Flow tab
3.  /cashflow — 30-day view by default
4.  Confidence badge: "Medium" (90–180 days history)
5.  Line chart shows projected daily balance
6.  If risk date present: red marker with "$12,400 shortfall projected Oct 21"
7.  User clicks marker → detail panel expands:
    - Contributing inflows (AR expected)
    - Contributing outflows (recurring expenses)
    - "Accelerate these invoices" CTA
8.  User clicks "Accelerate" → Agentic Execution modal
9.  Draft generated for overdue invoices
```

---

### Flow 6: Returning user — login to intelligence feed

```
1.  User at /login → enters email → magic link → clicks link
2.  /api/auth/callback → existing session → /dashboard
3.  Intelligence feed loads with findings from last scan
4.  Navigation badge on Intelligence tab shows count of unresolved findings
5.  User clicks "Ask" tab → previous conversation restored from localStorage
```

---

### Flow 7: Configure notifications

```
1.  User at /settings/notifications
2.  Sees four alert type rows (Cash Flow Risk, Expense Spike, Collections, Duplicate)
3.  Toggles "Cash Flow Risk" email off → optimistic update → PATCH /api/alert-configs/cash_flow_risk
4.  On server error: reverts to previous state automatically
5.  Toggles "Opt out of all email" → sends PATCH to all four types
```

---

## Section 3: Navigation Map

```
─────────────────────────────────────────────────────────────────
  UNAUTHENTICATED
─────────────────────────────────────────────────────────────────

[/] ──"Start free trial"────────────────────► [/register]
[/] ──"Coming from Bench?"──────────────────► [/register?source=bench]
[/] ──"Sign in"─────────────────────────────► [/login]
[/register] ──submit──────────────────────► [/check-email]
[/login] ──submit────────────────────────► [/check-email]
[/check-email] ──magic link──────────────► [/api/auth/callback]
[/api/auth/callback] ──new user────────────► [/onboarding]
[/api/auth/callback] ──returning, data────► [/dashboard]
[/api/auth/callback] ──returning, no data─► [/onboarding]
[/api/auth/callback] ──expired token──────► [/login]

─────────────────────────────────────────────────────────────────
  ONBOARDING
─────────────────────────────────────────────────────────────────

[/onboarding] ──upload CSV──────────────────► sync + intelligence → [/dashboard]
[/onboarding] ──"Connect QuickBooks"────────► QB OAuth → sync → [/dashboard]
[/onboarding] ──"Connect Xero"──────────────► Xero OAuth → sync → [/dashboard]

─────────────────────────────────────────────────────────────────
  MAIN APP (authenticated — persistent primary navigation)
─────────────────────────────────────────────────────────────────

Primary nav: [Intelligence /dashboard] [Cash Flow /cashflow]
             [Ask /ask] [Reports /reports]

[/dashboard]
  ──"Take action" on finding──────────────► Agentic Execution Modal (overlay)
  ──"Tell me more →" on finding───────────► [/ask?finding_id=[id]]
  ──"View Cash Flow →" (cash flow card)───► [/cashflow]
  Resolved section shows dismissed + actioned findings

[/cashflow]
  ──risk date marker──────────────────────► Detail panel (inline expand)
  ──"Accelerate these invoices"───────────► Agentic Execution Modal (overlay)
  ──"Tell me more →"──────────────────────► [/ask?context=cashflow]
  ──30 / 60 / 90 day tabs─────────────────► Timeline re-renders

[/ask]
  ──submit question───────────────────────► [/ask] (response in thread)
  ──"New conversation" button─────────────► [/ask] (fresh session)
  ──quota exhausted───────────────────────► [/settings/billing] (via CTA)
  localStorage persistence: restores last conversation on return

[/reports]
  ──"Generate last month's report"────────► POST /api/reports/generate → Inngest
  ──"Export" on ready report──────────────► Download .txt file

Agentic Execution Modal (overlay — no route change)
  State 1 (Confirm) → State 2 (Generating) → State 3 (Review)
  → State 4 (Copy) → State 5 (Done/Mark as sent)
  ──close (any state)─────────────────────► Returns to triggering screen

─────────────────────────────────────────────────────────────────
  SETTINGS (two-column layout with sidebar nav)
─────────────────────────────────────────────────────────────────

[/settings] ──redirects──────────────────► [/settings/connections]

Settings sidebar nav: Connections | Account | Notifications | Billing

[/settings/connections]
  ──"Connect QuickBooks"──────────────────► QB OAuth → [/settings/connections]
  ──"Connect Xero"────────────────────────► Xero OAuth → [/settings/connections]

[/settings/account]
  ──"Download your data"──────────────────► Download zip (conversations, findings,
                                             drafts, reports as JSON + README)

[/settings/notifications]
  ──toggle alert type enabled─────────────► PATCH /api/alert-configs/[type]
  ──toggle email──────────────────────────► PATCH /api/alert-configs/[type]
  ──"Opt out of all email"────────────────► PATCH all four types

[/settings/billing]
  ──"Contact sales"───────────────────────► mailto:ai.cfofinance@gmail.com
```

---

## Section 4: Auth States

### Access levels

| Level | Description |
|---|---|
| **Unauthenticated** | No valid session |
| **Authenticated — org member** | Valid session, belongs to an org |
| **Authenticated — org admin / owner** | Valid session, org creator |

### Screen access matrix

| Screen | Unauth | Org member | Notes |
|---|---|---|---|
| `/`, `/register`, `/login` | ✓ | → `/dashboard` | |
| `/onboarding/*` | → `/login` | ✓ (if no data yet) | |
| `/dashboard` | → `/login` | ✓ | |
| `/cashflow` | → `/login` | ✓ | |
| `/ask` | → `/login` | ✓ | |
| `/reports` | → `/login` | ✓ | |
| `/settings/*` | → `/login` | ✓ | |

### Redirect rules

1. Any authenticated route + no session → `/login?next=[route]`
2. `/register`, `/login` + valid session → `/dashboard`
3. Authenticated + no org → `/onboarding`
4. Authenticated + org + no connection/data → `/onboarding`
5. Cross-org resource access → HTTP 403

---

## Section 5: Empty States

### Intelligence Feed — all clear

```
All clear — no urgent findings

What CFO Lens checked this morning:
  ✓ Cash flow projection (30-day forward look)
  ✓ Expense spike detection
  ✓ Collections slippage
  ✓ Gross margin vs prior year
  ✓ Overdue AR aging
  ✓ Duplicate subscription scan

Next scan: tomorrow at 6:00 AM
[Ask a question →]
```

### Intelligence Feed — insufficient data (< 60 days)

```
🔍 Building your intelligence baseline

I need 60 days of transaction history to detect patterns, anomalies,
and forecast your cash flow. You're [N] days in.

████████░░░░░░░░░░  [N] / 60 days

What activates at 60 days:
  • Cash flow projections
  • Expense spike detection
  • Collections slippage
  • Margin trend analysis
```

### Cash Flow — insufficient data (< 60 days)

```
📅 Cash flow projection activates in [N] days

Accurate cash forecasting requires at least 60 days of data.

████████░░░░░░░░░░  [N] / 60 days

Until then: ask about your current AR balance, overdue invoices,
or current expense breakdown.
```

### Reports — no reports yet

```
[FileText icon]

No reports yet

Monthly reports are generated automatically on the 1st of each month.
Your first report will appear here after your next scheduled run.

Reports summarise your P&L, cash position, and key ratios for the month.

[Generate last month's report]
```

---

## Section 6: Technical Implementation Notes

### Inngest background jobs
All long-running work runs as Inngest functions (registered in `/api/webhooks/inngest`):
- `sync-fan-out` — 6-hour cron, fans out sync events to all active QB/Xero connections
- `sync-single-org` — per-org sync: pull → snapshots → trigger intelligence
- `intelligence-fan-out` — daily cron
- `intelligence-run` — per-org 10-step intelligence pipeline
- `intelligence-email` — sends email brief for high/critical findings
- `monthly-report-cron` — 1st of month at 5am UTC, fans out report events
- `monthly-report-generate` — per-org 4-step report pipeline
- `message-cleanup` — monthly quota reset + conversation cleanup

### AI cost per action
- Intelligence run (all 5 analysis types): ~$0.006
- Ask chat message: ~$0.001–0.003 (Haiku)
- Report generation: ~$0.002
- Draft generation: ~$0.001–0.002

### Finding lifecycle
`active` → `dismissed` (user dismisses) | `actioned` (user copies draft + marks sent)

Active findings appear in the Intelligence Feed main section.
Dismissed and actioned findings appear in the Resolved section below.

### Data export contents (Settings → Account → Download)
```
README.txt
conversations/conversations.json  — Q&A history with messages
findings/findings.json            — all intelligence findings
action_drafts/drafts.json         — AI-generated email drafts
reports/index.json                — monthly report index
```

---

*End of APP_FLOW.md v1.0. This document supersedes APP_FLOW v0.2 (July 2026).*

*Primary changes from v0.2:*
- Navigation is 4 items: Intelligence, Cash Flow, Ask, Reports (Alerts not in primary nav)
- Settings uses two-column sidebar layout; `/settings` redirects to `/settings/connections`
- Intelligence Feed includes Resolved section (actioned/dismissed findings)
- Ask page uses localStorage for chat history persistence; New Conversation button added
- Reports page is fully implemented: status cards, Generate button, Export links
- Onboarding: demo path is CSV upload (QB/Xero OAuth built but not in demo UI)
- AI provider is Anthropic (Haiku 4.5 / Sonnet 5), not Google Gemini
- Contact Sales is active mailto link (ai.cfofinance@gmail.com)
- Monthly reports are a live feature (Inngest cron + manual trigger)
