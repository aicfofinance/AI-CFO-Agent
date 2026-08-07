# Product Requirements Document
## AI CFO Agent — CFO Lens

**Version:** 1.0 — Demo live  
**Date:** August 2026  
**Status:** Demo deployed at `ai-cfo-agent-e64g.vercel.app`  
**Previous version:** PRD v0.2 (July 2026) — superseded; feature priorities and deployment status updated

> **Document-wide notice:** This PRD reflects the product as it stands in its live demo deployment. Features are marked with implementation status: ✅ Implemented, 🔄 Partial, 📋 Planned. All personas, features, and competitive claims in the hypothesis sections remain unvalidated unless explicitly noted otherwise.

---

## 1. Product Overview

**CFO Lens** is a proactive AI-powered financial intelligence tool for small and mid-sized businesses. It connects to a business's accounting data (QuickBooks Online, Xero, or CSV import), analyzes it continuously, and surfaces actionable findings before the owner knows to look for them.

The product is built on three pillars:

1. **Proactive intelligence:** Finds cash shortfalls, expense spikes, collections slippage, and duplicate subscriptions before the owner asks. Incumbents like Intuit Intelligence Chat are reactive (they answer questions); CFO Lens monitors continuously and pushes findings.

2. **Data sovereignty:** The product runs entirely on top of the user's own accounting data. The source of truth stays in QuickBooks or Xero. If the user cancels, their books are unchanged. Every connection is read-only.

3. **Agentic execution (draft-and-approve):** When the product identifies a problem, it drafts the communication required to act on it. The user reviews, approves, and sends from their own email. The product never sends on their behalf.

**Current deployment state:** The demo is live with CSV import as the primary data source. QuickBooks Online and Xero OAuth are implemented in the codebase but not exposed in the demo UI. All intelligence features, the agentic execution modal, monthly reports, and the full settings suite are operational.

---

## 2. Problem

### Problem A: Reactive-only intelligence — even from QBO/Xero AI chat

Intuit Intelligence Chat (QBO) and Just Ask Xero (JAX) answer natural language questions about a business's financial data. They are fundamentally search-and-retrieve. They do not monitor trajectory or alert proactively.

The unmet need is monitoring that runs continuously on behalf of the owner — finding the $45,000 cash shortfall forming in three weeks before the owner knows to look for it.

### Problem B: Proprietary lock-in risk — the Bench lesson

In December 2024, Bench Accounting shut down. Customers discovered that their financial records were held in a proprietary system they could not export cleanly. Any product that asks an SMB owner to move their financial data off a portable, industry-standard platform now faces this objection.

CFO Lens does not hold financial data. It reads and analyzes it. The user's QBO/Xero file is never modified.

### Problem C: The gap between insight and action

Identifying a problem is not the same as solving it. An owner who learns three invoices totaling $38,000 are 45+ days overdue still needs to draft a collections email, find the right contact, and send it. CFO Lens drafts the action and presents it for one-click copy — interrupting the deferred-action behavior.

---

## 3. User Personas

### Persona A — Marcus Chen, Owner-Operator

12-person B2B services business, ~$2.2M annual revenue. Uses QuickBooks Online. Has tried Intuit Intelligence Chat. Finds it accurate but "a better search bar for my books." Primary pain: no mechanism finds problems before they cost him money.

**Success metric:** Receives "You will be $45,000 short in week 3 of October" before it happens and acts on it.

### Persona B — Priya Sharma, Operations Manager

15-person marketing agency, ~$1.8M revenue. Has QBO access. Accountable for financial oversight she is not equipped to perform proactively. Needs the system to find findings and push them to her.

### Persona C — James Okafor, CPA Firm Principal *(P2 — unvalidated)*

Accounting firm channel. Do not build for this persona until at least 3 firms have expressed willingness to pay through direct interviews or letters of intent.

### Persona D — "The Bench Refugee"

$800K–$3M revenue business. Used Bench Accounting for 2–4 years. Lost access to financial records during the December 2024 collapse. Now on QBO but missing the managed intelligence layer. Requires explicit "your data is never held by us" commitment before engaging.

---

## 4. Goals & Success Metrics

### 3-month goal
25 paying organizations. 40%+ of active organizations have engaged with at least one proactive intelligence brief.

### 6-month goal
100 paying organizations. $12,000 MRR. At least 10 organizations have used the draft-and-approve agentic execution feature.

### The three metrics that matter most

**1. Proactive alert engagement rate** — % of high/critical findings that result in user action within 48 hours. Target: 40%+. Below 25%: re-examine alert quality before adding more alert types.

**2. 30-day organization retention rate** — % of orgs that submit at least one AI query or engage with at least one finding in their first 30 days. Target: 55%+. Below 40%: stop adding features and diagnose first.

**3. Intelligence brief open and engagement rate** — % of emailed briefs where user opens and engages with at least one finding. Target: 50%+ open rate.

---

## 5. Core Features

> **AI provider (current deployment):** Anthropic Claude Haiku 4.5 for routine tasks (draft generation, standard Q&A, intelligence analysis), Claude Sonnet 5 for complex financial analysis (complexity score ≥ 0.7). Routing is controlled by `src/lib/ai/models/router.ts` — the only file permitted to import AI providers directly. Cost per intelligence run: ~$0.006. Cost per monthly report: ~$0.002.

---

## P0 — Data Sovereignty Foundation

### Feature: QuickBooks Online integration (read-only) ✅ Built
Read-only OAuth. Tokens encrypted with AES-256-GCM. The application never requests write scopes. The callback verifies only read scopes were granted — if write scopes are returned, the connection is rejected.

**Demo status:** QB OAuth code is implemented (`src/lib/integrations/quickbooks/`). Not exposed in demo UI — demo uses CSV import as primary path.

### Feature: Xero integration (read-only) ✅ Built
Same read-only guarantee as QuickBooks. Mutual exclusivity enforced: one accounting provider per org.

**Demo status:** Xero OAuth code is implemented. Not exposed in demo UI.

### Feature: CSV import ✅ Built (demo primary path)
Accepts QuickBooks Transaction Detail Report exports and standard bank statement CSVs. Parses and normalizes transactions into the internal schema. Sets all income transactions as unreconciled (enables collections slippage detection). After import, a sync job completes and triggers the intelligence engine automatically.

### Feature: "You own your data" data sovereignty
- ✅ Persistent "🔒 Read-only — your books are unchanged" badge on all authenticated screens
- ✅ Data download (Settings → Account → Download your data) — exports findings, conversations, drafts, and reports as a zip file with JSON + README
- ✅ Data sovereignty note on Settings → Connections: "Read-only access. Always."

---

## P0 — Proactive Intelligence Engine

> All five intelligence analysis types run as isolated Inngest `step.run()` calls in `jobs/intelligence/run.ts`. Each step must complete in under 8 seconds (Vercel Hobby 10s function timeout limit). Guards prevent running on orgs with fewer than 60 days of transaction history or a failed sync.

### Feature: Cash flow cliff detection ✅ Built
30-day rolling cash flow projection using: current cash position, AR schedule from aging invoices, and recurring expense pattern detection. Produces a `cash_flow_risk` finding with the projected minimum balance and risk date. `expires_at` is set to the day after the risk date — a past-due warning expires automatically. Confidence levels: Low (<90 days history), Medium (90–180 days), High (180+ days).

### Feature: Anomaly alert engine ✅ Built
Four types evaluated after each sync:
- **Expense spike:** 7-day average daily spend vs. 30-day average. Threshold: 25% above baseline. `medium` severity.
- **Collections slippage:** Unreconciled income transactions older than 45 days. `medium` severity.
- **Margin deterioration:** Current MTD gross margin vs. same period prior year. Requires 12 months history. `medium` or `high` severity.
- **Duplicate subscription scan:** Same vendor appearing on different accounts within 25–35 days, amounts within 10%. `high` severity.

### Feature: Intelligence brief (proactive push summary) ✅ Built
Email delivery rule (non-configurable):
- **Critical finding:** Email immediately
- **High finding, no critical:** Email after 2-hour delay
- **Medium/low only:** In-app only, no email
- **No findings:** Silence

Email footer: "You're receiving this because a high or critical finding was detected in your QuickBooks data. This is AI-generated financial analysis. It is not financial advice."

### Feature: Intelligence Feed — resolved findings section ✅ Built
Below the active findings list, a "Resolved · N" section shows all dismissed and actioned findings. Each resolved finding shows a status badge ("Actioned" or "Dismissed") and is rendered at reduced opacity. This ensures all findings remain visible in the feed without cluttering the active section.

---

## P0 — Reactive Q&A

### Feature: Conversational financial Q&A ✅ Built
Streaming Q&A via `/ask`. Every response ends with the standard financial disclaimer. Guardrail check runs before every AI call — prompts that resemble financial advice receive a template refusal without calling the model. Context builder pulls the org's recent transactions and active findings for the system prompt. Rate limiting via Upstash (when configured). Quota tracked per organization per calendar month.

### Feature: Conversation history persistence ✅ Built
Chat history is persisted in browser `localStorage` keyed by org session. On returning to `/ask`, the previous conversation is automatically restored. A "New conversation" button (visible after the first message) clears local state and creates a fresh conversation. Conversations are also stored in the database and accessible via `/api/conversations`.

---

## P0 — Monthly Reports

### Feature: Monthly financial reports ✅ Built
Generated automatically on the 1st of each month via Inngest cron (`jobs/reports/monthly.ts`). Can also be triggered manually from Settings → Reports → "Generate last month's report". Each report contains:
- Structured metrics: total revenue, expenses, net profit, gross margin %, MoM changes, top expense/revenue categories
- AI-generated 3–4 paragraph executive narrative (one Haiku call, ~$0.002)
- Export as plain text with financial summary

Report status lifecycle: `pending` → `generating` → `ready` | `failed`. Reports list shows status badges and View/Export links for ready reports.

---

## P1 — Agentic Execution (draft-and-approve)

> **Architectural constraint (non-negotiable):** The AI never sends, submits, or transmits anything on the user's behalf. Every agentic output is a text draft the user reviews, copies, and sends from their own email client. No OAuth to Gmail, Outlook, or any email provider in V1.

### Feature: Invoice acceleration (draft-and-approve) ✅ Built
Triggered from `collections_opportunity` findings. 5-state modal flow:
1. **Confirm** — shows finding summary, asks to confirm draft generation
2. **Generating** — progress bar, "Drafting your message..."
3. **Review** — editable draft in modal (subject + body)
4. **Copy** — read-only final draft, prominent "Copy to clipboard" button
5. **Done** — "✓ Copied to clipboard", optional "Mark as sent" toggle

Draft includes invoice data from the finding's `related_data`. Disclaimer: "This draft was generated by AI using your QuickBooks data. Review it before sending."

### Feature: Duplicate subscription detection (draft-and-approve) 🔄 Detection built, draft modal built
`duplicate_subscription` findings are generated by the intelligence engine. Agentic draft modal is available for actionable finding types.

### Feature: Vendor negotiation starter *(P2 — not yet built)*
Cost escalation detection requires 12+ months of per-vendor billing history. Not yet implemented.

---

## P1 — Settings Suite ✅ Built

### Settings navigation
Settings uses a two-column layout with a sidebar navigation: Connections | Account | Notifications | Billing. Navigating to `/settings` redirects to `/settings/connections`.

### Connections (`/settings/connections`)
Shows QuickBooks and Xero connection cards (with connect/disconnect CTAs) and a CSV import status note when CSV data is present. Data sovereignty notice: "Read-only access. Always."

### Account (`/settings/account`)
Shows display name, role, plan tier. Data & Privacy section includes the data sovereignty notice and "Download your data" button.

### Notifications (`/settings/notifications`)
Toggle-based configuration for four alert types (Cash Flow Risk, Expense Spike, Collections Opportunity, Duplicate Subscription). Email delivery toggle per type. "Opt out of all email" master toggle.

### Billing (`/settings/billing`)
Current plan badge (Trial), queries-used progress bar, "Need more?" section with active "Contact sales" mailto link → `ai.cfofinance@gmail.com`.

---

## P2 — Roadmap (do not build until P1 validated)

- **`/alerts` historical archive:** Full paginated history of all findings with filter by severity/type/date. Currently findings are visible on the Intelligence Feed (active) and in the resolved section. A dedicated archive page is planned.
- **`/reports/:id` single report view:** Individual report pages with full AI narrative and "Ask AI about this report" CTA. Currently the reports list links to the export; a dedicated read view is planned.
- **`/conversations` history list:** Browsable list of past conversations. Currently the session persists via localStorage; a full history browser is planned.
- **Fully autonomous agentic execution:** Gmail/Outlook OAuth. Not in V1.
- **Cash flow scenario modeling:** "What if I hired two people?" Not in V1.
- **Plaid live bank connection:** Not in V1.
- **Accounting firm multi-client portal:** Not in V1 — requires 3 firm LOIs first.
- **Industry benchmarking:** Requires scale. Not in V1.

---

## 6. Out of Scope for V1

Same as v0.2: tax filing, payroll processing, direct bank payments, regulated financial advisor status, mobile native app, integrations beyond QuickBooks/Xero/CSV, autonomous agentic execution, email client integration, writing back to QuickBooks/Xero.

---

## 7. Competitive Positioning

| Feature | QBO/Xero (incumbent) | Bench (defunct) | CFO Lens |
|---|---|---|---|
| **Data ownership** | User owns — open platform | Vendor owns — proprietary | User owns — runs on their QBO/Xero file, read-only |
| **Intelligence type** | Reactive Q&A | Human-dependent, monthly | Proactive — finds problems before the user asks |
| **Cash flow forecasting** | Not available natively | Human-generated, monthly | AI-generated, updated on every sync |
| **Actionability** | Insight only | Human executes over days | Draft-and-approve — AI drafts, user executes in 30 seconds |
| **Lock-in risk** | Low | Critical (caused business failures) | Zero — cancelling leaves QBO/Xero unchanged |
| **Monthly reports** | Not included | Yes (human-written) | Yes, AI-written, triggered monthly or on demand |
| **Price** | ~$30/mo | $299–$799/mo (defunct) | $99–$299/mo target |

---

## 8. Assumptions and Risks

**A1 — Incumbents have not shipped proactive cash flow alerting** *(highest competitive risk — verify immediately)*

**A2 — Active Bench refugee migration window is still open** *(timing risk — requires 5 user interviews)*

**A3 — SMB owners will act on proactive alerts** *(central unvalidated hypothesis — measure 40% within 48 hours)*

**A4 — Draft-and-approve is valuable without Gmail OAuth** *(friction question — validate with user testing)*

**A5 — Read-only OAuth is a sufficient data sovereignty differentiator** *(needs legal review and contractual backing in ToS)*

**A6 — Email only for high/critical reduces churn, not engagement** *(behavioral assumption — monitor "all quiet" user sentiment)*

---

## 9. Open Questions

1. Does Intuit Assist already address the interpretation gap proactively? *(Verify now.)*
2. Who is the actual economic buyer — owner, bookkeeper, ops manager? *(10 user interviews.)*
3. Does AI-generated financial analysis trigger financial advice regulation? *(Legal consultation before public launch.)*
4. Is the active Bench refugee migration window still open? *(5 interviews with former Bench customers.)*
5. Is draft-and-approve friction low enough that users act, or does Gmail OAuth need to accelerate?
6. What is the right minimum data window for a useful first intelligence brief? (Currently 60 days.)
7. How does the product position if Intuit ships proactive cash flow forecasting natively?

---

## 10. Regulatory Note

The disclaimer approach ("This is AI-generated analysis of your accounting data. It is not financial advice.") is applied to every AI response and is appended as the final streaming chunk. This has not been verified as legally sufficient by qualified counsel. Legal review required before public launch.

The data sovereignty promise must be backed by contractual language in the Terms of Service, not only product copy.

---

*End of PRD v1.0. This document supersedes PRD v0.2 (July 2026).*
