# App Flow Document
## AI CFO Agent — V2 (Updated Hypothesis)

**Version:** 0.2 — Replaces V1 APP_FLOW entirely  
**Date:** July 2026  
**Scope:** Web application only. Mobile native is out of scope for V1.

**Core UX model — updated from V1:** The product has two primary modes and one execution layer:
1. **Intelligence Feed** (`/dashboard`) — the owner opens the app and sees what the AI found. Not charts to interpret. Not a blank canvas. A prioritized list of findings that require attention, with clear recommended actions.
2. **Cash Flow Timeline** (`/cashflow`) — forward-looking projection of cash position 30/60/90 days out, with specific risk dates and amounts. Not historical reporting.
3. **Agentic Execution Layer** — a modal flow triggered from any finding card that takes the user from "here is the problem" to "here is the draft of the action you need to take," with a single copy-to-clipboard step to execute.

The conversational Q&A interface (`/ask`) stays but is **secondary**. It is the tool users reach for when they want to explore a finding, not the primary way the product communicates value.

> **V1 constraint on agentic execution (non-negotiable):** The product never sends, submits, or transmits any communication on the user's behalf. Every agentic output is a text draft. The user copies it and sends it from their own email client. No Gmail, Outlook, or email provider OAuth is established in V1.

> **Auth implementation:** Magic link authentication via Supabase Auth. No passwords.

---

## Section 1: Screen Inventory

---

### UNAUTHENTICATED SCREENS

---

#### Screen: Landing page
- **Route:** `/`
- **Access:** Unauthenticated. Authenticated users redirect to `/dashboard`.
- **Purpose:** Marketing page. Leads with the data sovereignty promise and the Bench collapse as context.
- **Data displayed:** Static copy. No database calls.

**Content structure:**
- **Hero headline:** "Your books are yours. Your intelligence is 24/7."
- **Hero subhead:** "In December 2024, Bench Accounting shut down and took thousands of businesses' financial records with it. We're built differently: we run on your QuickBooks or Xero file. Your data lives there. We just make it work for you."
- **Three value propositions:** Proactive intelligence, Data sovereignty (read-only), Draft-and-approve action
- **Trust bar:** "Runs on your QuickBooks or Xero file. Read-only. No lock-in."
- **Bench refugee CTA:** "Coming from Bench? Start here →" linking to `/register?source=bench`

| Action | Success | Loading | Failure |
|---|---|---|---|
| Click "Start free trial" | Navigate to `/register` | — | — |
| Click "Coming from Bench? Start here →" | Navigate to `/register?source=bench` | — | — |
| Click "Sign in" | Navigate to `/login` | — | — |

---

#### Screen: Registration
- **Route:** `/register`
- **Access:** Unauthenticated. Authenticated users redirect to `/dashboard`.
- **Purpose:** Email capture + magic link. If `?source=bench`, copy shifts to data sovereignty language.

| Action | Success | Loading | Failure |
|---|---|---|---|
| Submit email | Navigate to `/check-email` | "Sending..." (disabled) | Invalid email: inline error. Send failure: "Something went wrong." |
| "Already have an account?" | Navigate to `/login` | — | — |

---

#### Screen: Login
- **Route:** `/login`
- **Access:** Unauthenticated. Authenticated users redirect to `/dashboard`.

| Action | Success | Loading | Failure |
|---|---|---|---|
| Submit email | Navigate to `/check-email` | "Sending..." | Rate limit: "Too many requests. Try again in [N] minutes." |

---

#### Screen: Check email
- **Route:** `/check-email`
- **Access:** Unauthenticated. Arrived from `/register` or `/login`.
- **Purpose:** Confirm magic link sent; resend and email-change options.

| Action | Success | Loading | Failure |
|---|---|---|---|
| Click magic link (email) | Browser hits `/api/auth/callback` | — | Expired (>15 min): `/login` with "Link expired" |
| "Resend link" | "Link resent" | "Sending..." | "Something went wrong" |

---

#### Screen: Auth callback
- **Route:** `/api/auth/callback`
- **Access:** Internal redirect. Not navigated to directly.
- **Purpose:** Validates token, establishes session, routes user to correct next screen.
- **Display:** Full-screen spinner: "Signing you in…"

| Condition | Redirect |
|---|---|
| New user, `?source=bench` in session | `/onboarding/migration?source=bench` |
| New user, no source | `/onboarding/migration` |
| Returning user, org + connection, data ready | `/dashboard` |
| Returning user, org + connection, syncing | `/onboarding/sync` |
| Returning user, org, no connection | `/onboarding/connect` |
| Expired or invalid token | `/login` with "This link has expired." |

---

### ONBOARDING — STANDARD PATH

---

#### Screen: Migration check (Onboarding Step 1)
- **Route:** `/onboarding/migration`
- **Access:** Authenticated, no organization record yet.
- **Purpose:** Route new users to the correct onboarding variant before collecting org details.

**Content:** "Before we set up your account — are you coming from a bookkeeping service that lost your data, or starting fresh?"

Two large clickable cards:
1. **"I'm migrating from Bench or another service"** → `/onboarding/refugee`
2. **"I'm starting fresh (or have my own QBO/Xero account)"** → `/onboarding/org`

If `?source=bench` present: Card 1 is highlighted. Banner: "Welcome. Let's make sure this never happens again."

---

#### Screen: Organization creation
- **Route:** `/onboarding/org`
- **Access:** Authenticated, no org. Arrived from migration check (standard path).
- **Purpose:** Business name, industry, revenue band. Consent acknowledgment.

**Consent checkbox (required, not pre-checked):**
> "I understand this product reads my QuickBooks or Xero data to provide analysis. It never modifies my books. This product provides AI-generated financial analysis, not financial advice."

| Action | Success | Loading | Failure |
|---|---|---|---|
| Complete + submit | Org created → `/onboarding/connect` | "Creating..." | Missing field: inline validation |

---

#### Screen: Connect accounting software
- **Route:** `/onboarding/connect`
- **Access:** Authenticated, org exists, no connection.
- **Purpose:** Connect QuickBooks or Xero. Data sovereignty statement shown before credentials requested.

**Statement above options:**
> **"Read-only access. Always."**
> We connect to your QuickBooks or Xero file but never write to it. We can't create, modify, or delete any transaction. If you cancel, your accounting file is 100% intact.

Options: Connect QuickBooks (primary), Connect Xero (secondary), Upload CSV (tertiary link).

| Action | Success | Loading | Failure |
|---|---|---|---|
| "Connect QuickBooks" | Redirect to QuickBooks OAuth page | Brief indicator | Failure → return with "OAuth failed. Try again or upload CSV." |
| "Connect Xero" | Redirect to Xero OAuth | Brief indicator | Same for Xero |
| "Upload CSV" | Open `/onboarding/csv` | — | — |

---

#### Screen: OAuth flow (QuickBooks and Xero)
- **Callback routes:** `/api/auth/quickbooks/callback`, `/api/auth/xero/callback`
- **Note:** Read-only OAuth scopes are verified before token storage. Write scopes, if returned, cause connection rejection.
- **On success:** Tokens encrypted and stored. Initial sync + intelligence scan triggered. Redirect to `/onboarding/sync`.

---

#### Screen: Data sync and intelligence scan
- **Route:** `/onboarding/sync`
- **Access:** Authenticated, connection just established.
- **Purpose:** Waiting state while data imports AND first intelligence scan runs simultaneously.

**Content (not a generic spinner):**
Dynamic text cycles every 5 seconds: "Importing your transaction history..." → "Reading your AR aging..." → "Analyzing expense patterns..." → "Running first intelligence scan..."

"This usually takes 60–90 seconds."

**Polling mechanism (two-phase):**
1. Every 3 seconds, call `GET /api/connections`. When `connections[0].syncStatus === 'success'`, advance to phase 2.
2. Every 3 seconds, call `GET /api/intelligence/feed?limit=1`. When the response returns (either findings or an empty array with `meta.lastIntelligenceRunAt !== null`), navigate to `/onboarding/first-brief`.

Both phases must complete before redirecting — not just the sync. Redirecting after sync alone means the first-brief screen would show the empty/healthy state because the intelligence engine hasn't generated findings yet.

| Condition | Behavior |
|---|---|
| Both sync + intelligence run complete | Navigate to `/onboarding/first-brief` |
| Sync completes but intelligence run not yet done | Remain on this screen, continue polling phase 2 |
| Total time exceeds 90 seconds | "Import didn't complete. [Retry] or [Continue — I'll scan with what's available]" — "Continue" navigates to `/onboarding/first-brief` immediately |
| User navigates away | Sync + intelligence run continues in background. On return, auth callback routing returns user here. |

---

#### Screen: First intelligence brief
- **Route:** `/onboarding/first-brief`
- **Access:** Authenticated, first sync complete.
- **Purpose:** The first thing the user sees after connecting is what the AI found — not a blank dashboard. This is the product's first value delivery moment.

**State — findings exist:**
> "Here's what I found in your first scan"

Up to 3 finding cards (same format as main feed). Below: "Your data lives in QuickBooks — not here. If you cancel, your books are unchanged."

CTAs: "Go to Intelligence Feed →" (primary), "View Cash Flow Projection →" (secondary, if data sufficient)

**State — no findings (healthy):**
> "Good news from your first scan"

Shows the "Your finances look healthy" state (see Section 5).
CTA: "Go to Intelligence Feed →"

**State — insufficient data (< 60 days):**
> "Your scan has started — more findings arrive as patterns emerge"

Explains what requires more history. CTA: "Go to Intelligence Feed →"

---

### ONBOARDING — BENCH REFUGEE PATH

---

#### Screen: Refugee welcome
- **Route:** `/onboarding/refugee`
- **Access:** Authenticated, arrived from migration check (refugee branch).
- **Purpose:** Acknowledge the Bench experience, explain the structural difference, present three migration paths.

**Headline:** "You've been through this before. Let's make sure it never happens again."

**Body:** "This product doesn't hold your financial data. We read your QuickBooks or Xero file — which you own — and analyze it. If we shut down tomorrow, your QBO file is unchanged. Your financial data will never be held by us."

**Three path cards:**
1. **"I have exports from my old service"** → CSV upload → `/onboarding/csv`
2. **"I already have QuickBooks or Xero"** → Connect → `/onboarding/connect`
3. **"I lost everything — I need to start over"** → Fresh start → `/onboarding/start-fresh`

---

#### Screen: CSV upload
- **Route:** `/onboarding/csv`
- **Access:** Authenticated. Available to both refugee path and standard path skip.
- **Purpose:** Accept CSV exports from Bench, bookkeeping services, or bank statements.

**File input:** `.csv` only. Format guidance text: "Look for a 'Transaction Export' or 'Activity Report' in your old service's settings."

**After successful upload:** Summary shown: "[N] transactions imported from [date range to date range]."
**Persistent banner after import:** "Your imported data is a static snapshot. Connect QuickBooks or Xero for live monitoring and proactive intelligence."

| Action | Success | Loading | Failure |
|---|---|---|---|
| Upload valid CSV | Parsed + summary → CTA to connect QB or proceed | Progress bar | Invalid format: "We couldn't read this file." File too large (>50MB): "Try a shorter date range." |
| "Connect QuickBooks instead" | Navigate to `/onboarding/connect` | — | — |
| "Proceed with imported data" | Navigate to `/onboarding/sync` (lightweight scan) | — | — |

---

#### Screen: Start fresh
- **Route:** `/onboarding/start-fresh`
- **Access:** Authenticated, refugee who has no recoverable data.
- **Purpose:** Guide user to set up a new QBO account and return to connect it.

Steps shown:
1. "Open a QuickBooks Online account" — link to QBO trial
2. "Import your bank statements into QBO" — brief instructions
3. "Come back here and connect" — CTA: "Connect my new QuickBooks account →" → `/onboarding/connect`

---

### CORE APPLICATION SCREENS

---

#### Screen: Intelligence Feed
- **Route:** `/dashboard`
- **Access:** Any authenticated org member.
- **Purpose:** The product's primary surface. The owner opens the app and sees what the AI found — a prioritized, actionable list of findings, not charts to interpret.

**Header:** "Intelligence Feed" + last-scan timestamp + data sovereignty badge: "🔒 Read-only — your books are unchanged" (clicking opens full data sovereignty explainer)

**Finding card anatomy (every card has all five elements):**
- **Severity badge:** Critical / High / Medium / Low (with distinct colors)
- **Headline:** Plain English. E.g., "Cash shortfall of $45,000 projected for week 3 of October"
- **Why it matters:** One sentence. E.g., "At current AR aging and with Q4 payroll due, your account will go negative before expected client payments arrive."
- **Recommended action:** One sentence. E.g., "Accelerate 3 overdue invoices totaling $38,000."
- **Two CTAs:** "Take action" button (triggers Agentic Execution modal) + "Tell me more →" link (navigates to `/ask?finding_id=[id]`)

**"What I checked" section (collapsible, at page bottom):**
Lists all anomaly types evaluated this cycle with checkmarks for no-issue results.

**User actions and states:**

| Action | Success | Loading | Failure |
|---|---|---|---|
| "Take action" on finding | Opens Agentic Execution modal | — | — |
| "Tell me more →" on finding | Navigate to `/ask?finding_id=[id]` | — | — |
| Click card header to expand | Card expands inline (no navigation) | — | — |
| Click last-scan timestamp | Sync status panel opens inline | — | — |
| "Sync now" | Progress in header; feed refreshes on complete | "Scanning..." in header | "Scan failed. [Retry] [Check connection]" |
| "View Cash Flow →" (in cash flow cliff cards) | Navigate to `/cashflow` | — | — |

**Loading state:** 3 skeleton cards (animated pulse). Text: "Running your intelligence scan..."

**Empty state — no findings (healthy finances):**
```
✓  Your finances look healthy this week.

Here's what I checked:
  ✓ Cash flow projection (30 days): No shortfall detected
  ✓ AR aging: All invoices within normal collection windows
  ✓ Expense patterns: No unusual spikes detected
  ✓ Recurring charges: No duplicates found
  ✓ Margin trend: Stable vs. prior period

Next scan: in [N] hours
```
CTA: "Ask a question about your finances →"

**Empty state — insufficient data (< 60 days):** See Section 5.

---

#### Screen: Cash Flow Timeline
- **Route:** `/cashflow`
- **Access:** Any authenticated org member.
- **Purpose:** Forward-looking only. Shows projected cash position 30/60/90 days with specific risk dates flagged.

**Data displayed:**
- Confidence level badge: High / Medium / Low (based on data completeness)
- Horizontal timeline showing:
  - Current cash balance (today)
  - Predicted inflows (green): AR due dates, historical payment patterns per client
  - Predicted outflows (red): recurring expenses, payroll cycles, seasonal patterns
  - Net projected cash position as a line chart
  - **Risk dates:** Red markers with tooltip: "Projected shortfall: $12,400 — Oct 21"
- View tabs: 30 days / 60 days / 90 days
- Detail panel: inflows list (client, amount, confidence %), outflows list (vendor, amount, type)
- "Accelerate these invoices" CTA when risk dates are present

**User actions and states:**

| Action | Success | Loading | Failure |
|---|---|---|---|
| Switch view tabs (30/60/90) | Timeline re-renders | Brief skeleton | — |
| Click risk date marker | Detail panel expands inline | — | — |
| "Accelerate these invoices" | Opens Agentic Execution modal, pre-populated | — | — |
| "Tell me more →" | Navigate to `/ask?context=cashflow` | — | — |

**Confidence level:** High (90+ days complete data), Medium (60–89 days), Low (30–59 days — directional only)

**Disclaimer (always visible):** "AI-generated projection from QuickBooks data as of [date]. Not a guarantee of future cash position. Not financial advice."

**Empty state — insufficient data (< 60 days):** See Section 5.

---

### AGENTIC EXECUTION FLOW (modal overlay — no route change)

Triggered by "Take action" on any finding card in the Intelligence Feed, Cash Flow Timeline, or Alerts screen. A modal overlay on the current screen.

---

**State 1 — Finding confirmation:**
Modal shows the finding summary and a single question: "Draft a collections reminder?"
Shows: Invoice number, client, amount, days overdue.
Sub-text: "The AI will draft a professional email you can review before copying."

| Action | Result |
|---|---|
| "Draft it" | Advance to State 2 |
| "Not now" | Modal closes. Finding card persists. |

---

**State 2 — Generating draft (loading):**
Animated progress bar. Text: "Drafting your message..."
Takes 2–4 seconds.

| Condition | Result |
|---|---|
| Draft generated | Advance to State 3 |
| Generation fails | "Draft generation failed. [Try again] [Cancel]" |

---

**State 3 — Review draft (editable):**
Shows:
- **To:** Client email from QBO (or warning if not on file — see edge cases)
- **Subject:** Pre-filled
- **Body:** Full professional draft, editable inline. Clicking any text activates edit mode.

| Action | Result |
|---|---|
| Edit any field | Inline editing |
| "Edit this draft" | Opens full body in expanded textarea |
| "Looks good →" | Advance to State 4 |
| "← Start over" | Return to State 1 |

---

**State 4 — Final draft with copy button:**
Read-only final version of all fields.
Prominent primary button: **"📋 Copy to clipboard"**
Sub-text below button: "Paste this into your email client and send it. This product never sends on your behalf."

| Action | Result |
|---|---|
| "Copy to clipboard" | All fields copied. Advance to State 5. |
| "← Edit" | Return to State 3 |

---

**State 5 — Confirmation:**
Green checkmark. "✓ Copied to clipboard"
"Open your email client, paste, and send."
Optional: "Mark as sent" toggle — updates finding card in feed to show "Nudge sent [date]"
"Close" dismisses modal.

**Post-send behavior:** If "Mark as sent" is toggled and the invoice remains overdue in QBO 14 days later, a new finding fires: "Second nudge recommended for [client name]."

---

**Failure state — No email on file in QBO:**
State 3 renders with a warning banner above the draft:
```
⚠  We don't have an email address for Acme Corp in QuickBooks.
   The draft is ready — add their address in the "To:" field
   when you paste into your email client.
```
The "To:" field shows placeholder: "[Add Acme Corp's email address]"
Copy-to-clipboard includes: `TO: [Add Acme Corp's email address]` as a literal reminder.
All other fields generate normally. The missing email is never a blocker to proceeding.

One-time tip shown after close: "Add Acme Corp's email in QuickBooks so future drafts pre-fill automatically."

---

#### Screen: Ask a question
- **Route:** `/ask`
- **Access:** Any authenticated org member.
- **Purpose:** Conversational Q&A. Secondary to the intelligence feed. Context-aware empty state.

**Updated empty state — context-aware:**

*If active critical or high-severity finding exists:*
```
The AI found something that may need your attention.

"[Headline of the highest-severity active finding]"

Want to talk through your options, or ask something else?
```
CTA chip: "Talk through [finding headline]" (auto-submits question about that finding)
Plus standard chips below.

*If no active findings (healthy):*
```
Your finances look healthy this week.
What would you like to explore?
```
Four suggested question chips.

*If arrived via "Tell me more →" from a specific finding:*
Context block shown above input:
```
📌  Context: [Finding headline]
Ask a follow-up or explore something else.
```
First message is auto-submitted: "Tell me more about [finding]."

**Inline agent CTAs:** When the AI identifies an actionable finding during a conversation response, it surfaces an inline "Draft [action] →" CTA within its response text. Clicking it triggers the Agentic Execution modal without leaving `/ask`.

**Quota exhaustion state:** Same as V1 — system message in thread, input read-only, upgrade CTA.

---

#### Screen: Conversation history
- **Route:** `/conversations`
- **Access:** Any authenticated org member.
- **Data displayed:** All org conversations: question preview (250 chars), timestamp, user name. Label: "Showing all queries from your organization."
- **Actions:** Search, click to open `/conversations/:id`, Export history (JSON download).
- **Empty state:** "No conversations yet. Ask a question from the Intelligence Feed or the Ask screen."

---

#### Screen: Single conversation view
- **Route:** `/conversations/:id`
- **Access:** Authenticated org members only. Returns 403 if wrong org.
- **Data displayed:** Full question, full response, disclaimer, timestamp, user who asked.
- **Actions:** "Ask a follow-up" (→ `/ask` pre-filled), "Copy answer", "← Back".

---

#### Screen: Alerts (historical findings archive)
- **Route:** `/alerts`
- **Access:** Any authenticated org member.
- **Purpose:** Full history of all findings — active and acknowledged. The Intelligence Feed shows only current active findings; this screen is the complete archive.
- **Data displayed:** All findings ever triggered: severity badge, headline, type, date, acknowledgment status.
- **Filter options:** By severity, type, date range, status (active / acknowledged).
- **Actions:** Expand finding (inline), "Take action" (Agentic Execution modal), "Acknowledge" (marks seen, moves to archive), "Configure alerts →" links to `/settings/notifications`.
- **Empty state:** "No findings yet. Your first intelligence scan runs after your first QuickBooks sync."

---

#### Screen: Reports
- **Route:** `/reports`
- **Access:** Any authenticated org member.
- **Purpose:** Monthly AI-generated financial summaries.
- **Actions:** Click report → `/reports/:id`. "Generate report for [month]" button.
- **Empty state:** "Your first monthly report generates automatically on [date]. You can also generate one now."

---

#### Screen: Single report view
- **Route:** `/reports/:id`
- **Access:** Authenticated org members only.
- **Data displayed:** Full AI narrative, disclaimer footer, data-freshness notice.
- **Actions:** "Export as CSV", "Export as PDF", "Ask the AI about this report" (→ `/ask?context=report_[id]`).

---

### SETTINGS SCREENS

---

#### Screen: Account settings
- **Route:** `/settings/account`
- **Access:** Any authenticated user.
- **Purpose:** Profile, data sovereignty controls, account deletion.
- **Data & Privacy section (new):** "We have read-only access to your QuickBooks data. We can never create or modify a transaction." + "Download your data" button (zip: all reports, conversation history, findings history as JSON+PDF).
- **Actions:** Update display name, timezone. "Download your data." Delete account (confirmation required).

---

#### Screen: Connections
- **Route:** `/settings/connections`
- **Access:** View: any member. Add/remove: org admin only.
- **Data sovereignty note (persistent):** "We have read-only access to your accounting data. We can never create or modify transactions in your books."
- **Data displayed:** Connection card (provider, status, last scan timestamp, last 5 scans with finding counts).
- **Actions:** Connect QB/Xero (OAuth), Reconnect (expired token), Sync now, Disconnect (with data deletion confirmation), Upload CSV.

---

#### Screen: Notification preferences
- **Route:** `/settings/notifications`
- **Access:** Any authenticated member.
- **Data displayed:** Four finding type rows (cash flow cliff, expense spike, collections slippage, duplicate billing). Each: toggle, threshold input, data-readiness badge.

**Email delivery rule (displayed as information, not configurable):**
> "Email is sent only when a critical or high-severity finding is detected. Medium and low findings are in-app only. If your finances are healthy, you won't hear from us."

**Only configurable email option:** "Opt out of all email" toggle.

---

#### Screen: Billing and plan
- **Route:** `/settings/billing`
- **Access:** Org owner (full access). Non-owners see read-only usage + "Contact [owner] to manage billing."
- **Data displayed:** Current tier, query quota (used/limit/reset date), per-day chart, Stripe status.
- **Actions:** "Upgrade plan" (→ Stripe Checkout), "Manage payment method" (→ Stripe Portal), "Cancel subscription".

---

### P2 SCREENS (do not build until validated)

- **`/firm/clients`** — Accounting firm client list (P2)
- **`/firm/clients/:id`** — Single client view, same as Intelligence Feed but for client org (P2)

---

## Section 2: User Flows

---

### Flow 1: Standard new user — registration to first intelligence brief

```
1.  User arrives at /
2.  Reads copy (Bench story, data sovereignty) → clicks "Start free trial"
3.  /register → enters email → magic link sent → /check-email
4.  Opens email → clicks link → /api/auth/callback
5.  New user → /onboarding/migration
6.  Selects "Starting fresh" → /onboarding/org
7.  Fills form, checks consent → submit → org created
8.  /onboarding/connect — reads read-only statement → "Connect QuickBooks"
9.  QuickBooks OAuth page → authorizes → /api/auth/quickbooks/callback
10. Tokens stored (read-only scopes verified), sync + intelligence scan triggered
11. /onboarding/sync — "Running first intelligence scan..." (60–90 seconds)
12. Scan completes → /onboarding/first-brief
13. User sees 2–3 finding cards (or healthy state)
14. "Go to Intelligence Feed →" → /dashboard
15. Full intelligence feed rendered with active findings
```

---

### Flow 2: Bench refugee — landing to first intelligence brief

```
1.  User sees "Coming from Bench?" → clicks → /register?source=bench
2.  Enters email → sign-in link → clicks link → /api/auth/callback
3.  New user, source=bench → /onboarding/migration?source=bench
4.  Card 1 (Migrating) is highlighted → selects → /onboarding/refugee
5.  "You've been through this before" screen → selects "I have exports"
6.  /onboarding/csv → uploads Bench CSV → "847 transactions imported"
7.  "Connect QuickBooks" → /onboarding/connect → OAuth
8.  /onboarding/sync — scan runs on CSV + live QBO data
9.  /onboarding/first-brief — findings with data sovereignty reassurance:
    "Your data lives in QuickBooks, not us. You can leave any time."
10. "Go to Intelligence Feed →" → /dashboard
```

---

### Flow 3: Proactive alert received → agentic execution → draft copied

```
Background:
1.  Sync completes → intelligence scan: Invoice #1047 to Acme Corp, 47 days overdue
2.  Cash flow projection updated: shortfall $12,400 projected Oct 21
3.  Finding created: HIGH severity, "collections slippage"
4.  Email sent (high severity rule applies)

User sees finding:
5.  User opens email → "View finding →" → /dashboard
6.  HIGH finding card at top: "Invoice #1047 — 47 days overdue, $12,500"
7.  User clicks "Take action"

Agentic execution:
8.  Modal State 1: "Draft a collections reminder?" — user clicks "Draft it"
9.  State 2: "Drafting your message..." (2–4 seconds)
10. State 3: Review draft — subject, body pre-filled from QBO — "Looks good →"
11. State 4: Final draft + "Copy to clipboard" (prominent)
12. User clicks "Copy" → State 5: "✓ Copied to clipboard"
13. User switches to Gmail, pastes draft, adds recipient if not on file, sends
14. User toggles "Mark as sent" → finding card shows "Nudge sent [date]"
```

---

### Flow 4: Intelligence card → "Tell me more" → contextual Q&A → action drafted

```
1.  User on /dashboard
2.  Sees finding: "Expense spike — SaaS software spend 180% above 30-day average"
3.  Clicks "Tell me more →"
4.  /ask?finding_id=[id] — context block pre-loaded:
    "📌 Context: SaaS expense spike — $4,200 last 7 days vs. $2,300 average"
5.  Auto-submitted: "Tell me more about the SaaS expense spike."
6.  AI responds: identifies two subscriptions, one appears to be duplicate
    (Notion billed to two different expense accounts)
7.  User: "Can you help me draft a cancellation for the duplicate?"
8.  AI response includes inline CTA: "Draft a cancellation request →"
9.  User clicks → Agentic Execution modal opens, pre-populated
10. Draft generated → user reviews → copies → sends from own email
```

---

### Flow 5: Cash flow cliff detected → cashflow screen → invoice acceleration

```
1.  Intelligence scan: cash projection shows -$12,400 on Oct 21
2.  HIGH finding card in feed: "Cash shortfall of $12,400 projected Oct 21"
3.  User clicks "View Cash Flow →" in the finding card
4.  /cashflow — 30-day view, Oct 21 flagged with red marker
5.  User clicks the Oct 21 marker → detail panel expands:
    "Three overdue invoices totaling $38,000 are not reflected in projected inflows."
    Invoice list: Acme $12,500 (47d), Beta $18,000 (31d), Gamma $7,500 (28d)
6.  "Accelerate these invoices" CTA at bottom of detail panel
7.  User clicks → Agentic Execution modal — pre-populated with all three invoices
8.  State 1: "Draft collections reminders for 3 overdue invoices? ($38,000 total)"
9.  User clicks "Draft it" → AI drafts THREE separate emails
10. Shown as tabs: [Acme Corp] [Beta Inc] [Gamma LLC] — user reviews each
11. "Approve all" → each copied in sequence
12. "All 3 drafts copied. Paste each into your email client."
13. User marks all three as sent → /cashflow projection updates
```

---

### Flow 6: Returning user — login to intelligence feed

```
1.  User at /login → enters email → magic link → clicks link
2.  /api/auth/callback → existing session → /dashboard
3.  Intelligence feed loads with findings from last scan
4.  If new findings since last visit: nav badge shows count
5.  User reviews findings, takes actions, or navigates to /cashflow
```

---

### Flow 7: QBO token expires mid-task (see Edge Cases for full detail)

```
1.  User is in Agentic Execution modal reviewing a draft
2.  Next background API call returns 401 from QuickBooks
3.  Modal shows banner: "Your QuickBooks connection needs re-authorization. Draft is saved."
4.  User clicks "Reconnect QuickBooks" → QuickBooks OAuth in same tab
5.  After re-auth: → /dashboard with toast "Reconnected. Your draft is ready."
6.  "Resume draft →" CTA reopens the modal at State 3 (review)
```

---

## Section 3: Navigation Map

```
─────────────────────────────────────────────────────────────────────
  UNAUTHENTICATED
─────────────────────────────────────────────────────────────────────

[/] ──"Start free trial"────────────────────────► [/register]
[/] ──"Coming from Bench?"──────────────────────► [/register?source=bench]
[/] ──"Sign in"─────────────────────────────────► [/login]
[/register] ──submit──────────────────────────► [/check-email]
[/login] ────submit──────────────────────────► [/check-email]
[/check-email] ──magic link click────────────► [/api/auth/callback]
[/api/auth/callback] ──new user────────────────► [/onboarding/migration]
[/api/auth/callback] ──returning, data ready───► [/dashboard]
[/api/auth/callback] ──returning, syncing──────► [/onboarding/sync]
[/api/auth/callback] ──returning, no connection─► [/onboarding/connect]
[/api/auth/callback] ──expired token───────────► [/login]

─────────────────────────────────────────────────────────────────────
  ONBOARDING — STANDARD PATH
─────────────────────────────────────────────────────────────────────

[/onboarding/migration] ──"Starting fresh"──────► [/onboarding/org]
[/onboarding/migration] ──"Migrating"───────────► [/onboarding/refugee]
[/onboarding/org] ──complete────────────────────► [/onboarding/connect]
[/onboarding/connect] ──"Connect QuickBooks"────► QuickBooks OAuth
                         └─── /api/auth/quickbooks/callback ──────────────► [/onboarding/sync]
[/onboarding/connect] ──"Connect Xero"──────────► Xero OAuth
                         └─── /api/auth/xero/callback ────────────────────► [/onboarding/sync]
[/onboarding/connect] ──"Upload CSV"────────────► [/onboarding/csv]
[/onboarding/sync] ──scan completes─────────────► [/onboarding/first-brief]
[/onboarding/first-brief] ──"Go to feed"──────────► [/dashboard]
[/onboarding/first-brief] ──"View cash flow"──────► [/cashflow]

─────────────────────────────────────────────────────────────────────
  ONBOARDING — BENCH REFUGEE PATH
─────────────────────────────────────────────────────────────────────

[/onboarding/migration] ──"Migrating"───────────► [/onboarding/refugee]
[/onboarding/refugee] ──"Have exports"─────────── ► [/onboarding/csv]
[/onboarding/refugee] ──"Have QBO/Xero"────────── ► [/onboarding/connect]
[/onboarding/refugee] ──"Lost everything"──────── ► [/onboarding/start-fresh]
[/onboarding/csv] ──upload complete──────────────► [/onboarding/sync]
[/onboarding/csv] ──"Connect QBO instead"──────── ► [/onboarding/connect]
[/onboarding/start-fresh] ──"Connect QBO"──────── ► [/onboarding/connect]
[/onboarding/connect] ──OAuth complete─────────── ► [/onboarding/sync]

─────────────────────────────────────────────────────────────────────
  MAIN APP (authenticated — persistent primary navigation)
─────────────────────────────────────────────────────────────────────

Primary nav: [Intelligence /dashboard] [Cash Flow /cashflow] [Ask /ask]
             [Reports /reports] [Settings icon]

[/dashboard]
  ──"Take action" on card─────────────────────────► Agentic Execution Modal (overlay)
  ──"Tell me more →" on card──────────────────────► [/ask?finding_id=[id]]
  ──"View Cash Flow →" (in cash flow cliff card)──► [/cashflow]
  ──"Sync now"────────────────────────────────────► [/dashboard] (refreshed)

[/cashflow]
  ──risk date marker──────────────────────────────► Detail panel (inline expand)
  ──"Accelerate these invoices"───────────────────► Agentic Execution Modal (overlay)
  ──"Tell me more →"──────────────────────────────► [/ask?context=cashflow]

[/ask]
  ──submit question───────────────────────────────► [/ask] (response in thread)
  ──inline agent CTA in AI response───────────────► Agentic Execution Modal (overlay)
  ──quota exhausted───────────────────────────────► [/settings/billing] (via CTA)

[/reports]
  ──click report──────────────────────────────────► [/reports/:id]

[/reports/:id]
  ──"Export as CSV / PDF"─────────────────────────► Download
  ──"Ask AI about this"───────────────────────────► [/ask?context=report_[id]]

[/alerts]
  ──"Take action"─────────────────────────────────► Agentic Execution Modal (overlay)
  ──"Configure alerts →"──────────────────────────► [/settings/notifications]

Agentic Execution Modal (overlay — no route change)
  State 1 → 2 → 3 → 4 → 5
  ──close (any state)─────────────────────────────► Returns to triggering screen

─────────────────────────────────────────────────────────────────────
  SETTINGS
─────────────────────────────────────────────────────────────────────

Settings sub-nav: [Account] [Connections] [Notifications] [Billing]

[/settings/account]
  ──"Download your data"──────────────────────────► Download zip
  ──"Delete account" → confirm────────────────────► [/] (logged out)

[/settings/connections]
  ──"Connect QuickBooks"──────────────────────────► QB OAuth → [/settings/connections]
  ──"Sync now"────────────────────────────────────► [/settings/connections] (refreshed)
  ──"Disconnect" → confirm────────────────────────► [/settings/connections] (removed)

[/settings/billing]
  ──"Upgrade plan"────────────────────────────────► Stripe Checkout → [/settings/billing]
  ──"Manage payment method"───────────────────────► Stripe Customer Portal
```

---

## Section 4: Auth States

### Access levels

| Level | Description | Who |
|---|---|---|
| **Unauthenticated** | No valid session | New visitors, logged-out users |
| **Authenticated — org member** | Valid session, belongs to an org | Any invited user |
| **Authenticated — org admin** | Valid session, org creator/owner | The founding user |
| **P2 — Firm user** | Org member whose org has `firm_clients` relationships. **Not a separate role** — firm access is a data relationship resolved by the `get_accessible_org_ids()` RLS function. | Accounting firm staff (P2) |

### Screen access matrix

| Screen | Unauth | Org member | Org admin | Notes |
|---|---|---|---|---|
| `/` | ✓ | → `/dashboard` | → `/dashboard` | |
| `/register`, `/login` | ✓ | → `/dashboard` | → `/dashboard` | |
| `/onboarding/*` | → `/login` | ✓ (if no org/connection yet) | ✓ | |
| `/dashboard` | → `/login` | ✓ | ✓ | |
| `/cashflow` | → `/login` | ✓ | ✓ | |
| `/ask` | → `/login` | ✓ | ✓ | |
| `/conversations`, `/conversations/:id` | → `/login` | ✓ (own org only) | ✓ | |
| `/alerts` | → `/login` | ✓ | ✓ | |
| `/reports`, `/reports/:id` | → `/login` | ✓ (own org only) | ✓ | |
| `/settings/account` | → `/login` | ✓ | ✓ | |
| `/settings/connections` | → `/login` | View only | Full access | Non-admins cannot add/remove connections |
| `/settings/notifications` | → `/login` | ✓ | ✓ | |
| `/settings/billing` | → `/login` | Read-only + "contact owner" | ✓ | |
| `/firm/clients`, `/firm/clients/:id` | → `/login` | — | — | P2; requires firm_clients relationship |

### Redirect rules (priority order)

1. Any authenticated route → no session → `/login?next=[route]`
2. `/register`, `/login` → valid session → `/dashboard`
3. Authenticated → no organization → `/onboarding/migration`
4. Authenticated → org exists, no connection, no CSV data → `/onboarding/connect`
5. Authenticated → org exists, connection, sync never completed → `/onboarding/sync`
6. Cross-org access attempt → HTTP 403 (does not reveal whether resource exists)

---

## Section 5: Empty States and Edge Cases

---

### Intelligence Feed — insufficient data (< 60 days)

```
🔍  Building your intelligence baseline

I need 60 days of transaction history to detect patterns, anomalies,
and forecast your cash flow. You're [N] days in.

████████████░░░░░░░░░░  [N] / 60 days

What activates at 60 days:
  • Cash flow projections (30/60/90-day)
  • Expense spike detection (requires 30-day baseline)
  • Collections slippage (requires 2+ invoice cycles)
  • Margin trend analysis (requires historical comparison)
```

What IS shown above the progress section:
- Any immediate findings that don't require a pattern baseline: overdue invoices visible from day 1, any transaction-level anomalies (duplicate same-day billing from same vendor)
- "Ask a question about your data →" CTA

The feed is never fully blank. Always show what IS available before the progress section.

---

### Cash Flow Timeline — insufficient data (< 60 days)

This screen requires 60 days of transaction data. Below that threshold, no projection is shown.

```
📅  Cash flow projection activates in [N] days

Accurate cash forecasting requires seeing your seasonal patterns, recurring
expense cycles, and payment behavior over at least 60 days.

████████████░░░░░░░░░░  [N] / 60 days

Why 60 days? I need at least two billing cycles for recurring expenses, and enough
payment history to estimate when clients actually pay vs. when they're due.

Until then:
```

CTAs:
- "Ask about your current AR balance" → `/ask?q=What+is+my+current+AR+balance`
- "Ask about overdue invoices" → `/ask?q=What+invoices+are+overdue`
- "View your current expense breakdown" → `/ask?q=What+are+my+top+expense+categories`

---

### Agentic Execution — no email on file in QBO

**Behavior:** Draft generates fully. "To:" field shows placeholder `[Add Acme Corp's email address]`. Warning banner appears above the review draft:

```
⚠  QuickBooks doesn't have an email address for Acme Corp.
   The draft is ready. When you paste it into your email client,
   add their address in the "To:" field.
```

Copy-to-clipboard includes `TO: [Add Acme Corp's email address]` as a literal reminder in the copied text so the user sees it when pasting.

One-time tip shown on the finding card after modal closes: "Tip: Add Acme Corp's email in QuickBooks so future drafts pre-fill automatically." Not repeated on the same client.

---

### Agentic Execution — user declines all suggested actions for 14 days

**Product decision:** After 14 consecutive days of active use (user logs in, views the Intelligence Feed) with no action on any finding:

**Critical and High severity findings:** No change. Never throttled. These findings always appear at full visibility regardless of user engagement history.

**Medium severity findings:** Suppressed from the main Intelligence Feed after 14 days of no engagement. Still visible in `/alerts`. A one-time prompt appears in the feed:

```
You haven't acted on some recent findings.

Medium-priority findings have been moved to your Alerts archive. Critical and
high-priority findings always appear here immediately.

[Adjust notification settings]  [Show me all findings]
```

- "Adjust notification settings" → `/settings/notifications`
- "Show me all findings" → Re-enables medium findings in the feed for 7 more days, then prompt re-appears

**Low severity findings:** Suppressed silently after 7 days of no engagement. Always visible in `/alerts`. No prompt shown.

**What the product does NOT do:** Does not email the user about their inaction. Does not throttle or delay critical/high email delivery. Does not auto-acknowledge cards.

---

### QBO connection token expired mid-session

**Scenario A — user is in Agentic Execution modal:**

The next background API call returns 401 from QuickBooks. Draft text in-progress is preserved in React state.

Modal shows a banner between the current state and the CTA buttons:
```
⚠  Your QuickBooks connection needs re-authorization.
   Your draft is saved.
```
Two CTAs: "Reconnect QuickBooks" (same-tab OAuth) and "I'll reconnect later" (closes modal, draft is lost with warning).

After successful re-authorization: → `/dashboard` with toast: "Reconnected. Your draft is ready." + "Resume draft →" CTA that reopens the modal at State 3 (review).

**Scenario B — user is on any other authenticated screen:**

Persistent amber banner across the top of every authenticated screen:
```
⚠  Your QuickBooks connection needs re-authorization.
   Data shown may be outdated. [Reconnect now →]
```
All existing findings, reports, conversations, and the cash flow projection remain visible (served from last-sync cache). New scans are paused. "Sync now" button is replaced by "Reconnect first."

**Scenario C — user is on `/cashflow`:**

The projection remains visible but labeled amber: "Data from [last sync date] — update requires reconnection."
Banner above timeline: "QuickBooks needs re-authorization to update this projection. [Reconnect →]"

---

### Intelligence Feed — first-day state (< 24 hours after onboarding)

Distinct from the "< 60 days" state. This is the first day — the user just connected and the scan completed, but pattern-based anomaly detection has no baseline yet.

**What the feed shows on day 1:**
1. Any immediately visible findings (overdue invoices, same-day duplicate vendor charges)
2. A plain cash position statement (not a full projection): "Based on your current AR, $[X] is due in the next 30 days."
3. A permanent "building baseline" card at the bottom:

```
📊  I'm building your financial baseline

You'll see more intelligence findings over the next 30–60 days as I learn
your spending patterns, payment behavior, and seasonal trends.

Here's what I'll watch for:
  • Expense spikes vs. your normal spending
  • Invoices aging past your usual collection window
  • Recurring charges that appear duplicated
  • Cash shortfalls forming before they arrive
```

This card is replaced by full pattern-based findings once the 60-day threshold is reached.

---

*End of APP_FLOW.md v0.2. This document supersedes APP_FLOW v0.1 entirely.*

*Primary structural changes from V1:*
- `/dashboard` is now the **Intelligence Feed** (prioritized AI findings, not metrics charts)
- `/cashflow` is a **new primary screen** (forward-looking cash projection)
- **Agentic Execution modal** is a new 5-state overlay flow triggered from any finding
- **Bench refugee onboarding** is a distinct variant of the standard path (`/onboarding/refugee`, `/onboarding/csv`, `/onboarding/start-fresh`)
- **`/onboarding/migration`** is a new first step that branches all new users before org creation
- `/ask` empty state is now **context-aware**, pre-loading the highest active finding
- **Auth callback routing** now accounts for the `?source=bench` session param
