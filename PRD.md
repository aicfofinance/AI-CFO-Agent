# Product Requirements Document
## AI CFO Agent — V2 (Updated Hypothesis)
 
**Version:** 0.2 — Replaces V1 entirely  
**Date:** July 2026  
**Status:** Pre-validation — no primary user research conducted  
**Previous version:** PRD V0.1 (July 2026) — discarded; product hypothesis superseded
 
> **Document-wide notice:** This PRD reflects an updated product hypothesis grounded in the December 2024 Bench Accounting collapse and the emergence of incumbent conversational AI in QuickBooks Online and Xero. All personas, features, and competitive claims are hypotheses. Section 8 flags the highest-risk assumptions. Nothing here should be treated as validated fact until the Validation Checklist from the Research Brief has been worked through.
 
---
 
## 1. Product Overview
 
In December 2024, Bench Accounting — a managed bookkeeping service used by tens of thousands of small businesses — abruptly shut down. Customers discovered overnight that the financial data they had trusted to Bench's proprietary platform was inaccessible, right before tax season. The collapse exposed a fault line that was always there: when a third party holds your financial data on a proprietary system, they hold leverage over your business. Meanwhile, QuickBooks Online and Xero have since deployed their own conversational AI (Intuit Intelligence Chat; Just Ask Xero), moving the market's baseline and rendering "ask your finances a question" a commodity feature. The gap that remains — and that this product exists to fill — is threefold. First, **proactive intelligence**: both incumbent AI tools are reactive, answering questions the owner knows to ask, but incapable of finding the $45,000 cash shortfall forming in three weeks before the owner knows to look for it. Second, **data sovereignty**: the product runs entirely on top of the user's own QuickBooks Online or Xero file. The user's ledger is never migrated, never replicated exclusively to a proprietary system, and is always intact, audit-ready, and fully portable. If the user cancels, their financial data is exactly where they left it. Third, **agentic execution**: when the product identifies a problem — an overdue invoice, a duplicate subscription, a vendor contract that has grown 40% in two years — it drafts the communication required to act on it. The user reviews, approves, and sends from their own email. The product does not ask the user to trust it with autonomous execution; it asks them to spend thirty seconds reviewing a draft. The product's positioning in one sentence: **your finances work for you while you run your business.**
 
---
 
## 2. Problem
 
### Problem A: Reactive-only intelligence — even from QBO/Xero AI chat
 
**What incumbents now do well:** As of 2026, Intuit Intelligence Chat (embedded in QuickBooks Online) and Just Ask Xero (JAX) answer natural language questions about a business's financial data with reasonable accuracy. "What is my accounts receivable balance?" "Who are my top five vendors by spend?" "How did my gross margin change from Q1 to Q2?" All of these are now handled adequately by the incumbent tools at no additional cost above the QBO/Xero subscription. Building a product whose primary differentiator is conversational Q&A against a QuickBooks file is building into a feature that two of the largest accounting software vendors in the world already ship for free.
 
**Where incumbents stop short:** Incumbent AI is fundamentally a search-and-retrieve layer. It responds to the question the owner asks. It does not monitor the owner's financial trajectory and alert them when a pattern becomes a problem. Intuit Intelligence Chat cannot tell a business owner "Based on your AR aging report and your historical Q4 payroll spike, you will face a $45,000 cash shortfall in week 3 of October." It cannot detect that the same SaaS subscription has been billed twice to two different expense accounts for eight months. It cannot notice that collections on net-30 invoices have slipped from an average of 34 days to 52 days over the last six months without the owner asking about it.
 
**The unmet need:** SMB owners in the $500K–$10M revenue band are not primarily limited by their inability to ask financial questions. They are limited by the fact that they don't know which questions to ask until the problem has already cost them money. The product must operate continuously on their behalf — monitoring, forecasting, and surfacing findings proactively — not wait to be prompted.
 
**P0 product response:** A proactive intelligence engine that monitors the user's QBO/Xero data on each sync cycle and surfaces specific, dollar-quantified, date-anchored findings without being asked.
 
---
 
### Problem B: Proprietary lock-in risk — the Bench lesson
 
**What happened:** Bench Accounting raised over $100M and marketed itself as a fully managed bookkeeping service. Its value proposition — human bookkeepers backed by proprietary software — required users to migrate their financial history into Bench's platform. In December 2024, Bench shut down with approximately two weeks of warning. Users discovered that their years of financial records were held in a proprietary system they could not export cleanly. For businesses mid-way through their fiscal year, in the middle of payroll processing, or approaching tax filing deadlines, the loss of access to those records was an existential operational crisis.
 
**How this permanently changed buyer psychology:** The Bench collapse is not a one-time cautionary tale — it is a permanent reference point in every buying conversation about financial software. Any product that asks an SMB owner to move their financial data off of a portable, industry-standard platform (QuickBooks Online, Xero) and into a proprietary system now faces an objection that did not exist at the same intensity before 2024. The question "What happens to my data if you shut down or get acquired?" is now asked early in the sales conversation, and an inadequate answer is a deal-stopper. [VERIFY: The active migration window for displaced Bench customers — whether it remains open 18 months post-collapse — is an Open Question in Section 9.]
 
**What "data sovereignty" means as a product promise:** This product does not hold the user's financial data. It reads the user's QuickBooks Online or Xero file via OAuth, performs analysis on synced data, and surfaces findings. The user's QBO/Xero file is never modified by this product. If the user cancels their subscription today, their financial records are 100% intact in QBO/Xero exactly as they were. The product can be removed from a business's toolstack with no data consequences. This is not a marketing claim; it must be architecturally true — the product writes zero transactions, zero journal entries, and zero records back to the user's accounting platform. The "You own your data" commitment is verified at the technical level: read-only OAuth scopes, no write permissions requested.
 
**P0 product response:** A "You own your data" onboarding screen that explicitly shows the user what permissions the product has (read-only), what it cannot do (write to their ledger), and a one-click data export at any time. A dedicated migration path for Bench refugees. The product's entire architecture is built on top of the user's ledger as the source of truth, not alongside it.
 
---
 
### Problem C: The gap between insight and action
 
**Why identifying a problem isn't enough:** An SMB owner who learns from a proactive alert that three invoices totaling $38,000 are 45+ days overdue has not yet solved a problem — they have been told about one. Acting on that finding requires: drafting a collections email that is firm but preserves the business relationship, finding the right contact, sending the email, and tracking the response. An owner running a 15-person services business typically does not have a collections department. They have themselves, often at the end of a workday. The gap between "here is the problem" and "here is the problem resolved" is large enough that many owners read the alert, feel anxious, and defer action. This deferred action is the behavior this product must interrupt.
 
**What "agentic execution" means in draft-and-approve form for MVP:** When the product identifies an actionable finding — an overdue invoice, a duplicate subscription, a vendor contract that warrants renegotiation — it does not stop at surfacing the finding. It drafts the outgoing communication the owner would need to send to act on it. The draft is shown in full, editable, before the owner approves it. The owner copies the approved text into their own email client and sends it. The product never touches the owner's email account. The product never sends anything on the owner's behalf. "Agentic" in V1 means: the product does the cognitive work of drafting the action; the human retains control of execution.
 
**Why this is achievable and safe in V1:** The scoping constraint — draft-and-approve, no autonomous execution, no OAuth to the user's email client — makes this buildable in V1 without the legal, regulatory, and trust surface area of a product that acts autonomously. The user's email identity is never impersonated. Drafts are plaintext. The product makes no claims about response tracking or delivery confirmation. The risk profile is that of a very good writing assistant, not an autonomous agent. The trust required to get a user to copy and paste a draft into their email is substantially lower than the trust required to give a product access to their inbox.
 
**P0 product response:** Agentic execution is P1 (not P0), scoped strictly to draft-and-approve with no email client integration. The product positions this as the third pillar of its value proposition from launch, even if the P0 launch does not yet include it.
 
---
 
## 3. User Personas
 
> **Research brief flag \[INFERRED\]:** All personas below are constructed from market logic and the Bench Accounting collapse narrative. No user interviews have been conducted. Every pain point, motivation, and success criterion is a hypothesis. Treat these as starting points for research.
 
---
 
### Persona A — Marcus Chen, Owner-Operator (updated)
 
**Role:** Founder and CEO of a 12-person B2B services business with approximately $2.2M in annual revenue. Has been using QuickBooks Online for four years. Has tried Intuit Intelligence Chat since it launched.
 
**Context:** Marcus knows QBO Intelligence Chat exists and has used it — mostly to answer point-in-time questions like "What was my net income in March?" He finds it accurate but fundamentally limited. He describes it as "a better search bar for my books." He does not think of it as something that looks out for him. His most recent scare: he almost missed a major payroll cycle because three large clients had slipped to 60-day payment and he hadn't noticed the pattern building.
 
**Primary pain point:** Marcus does not have a mechanism that finds problems before they cost him money. He is reactive by necessity — he responds to the alerts he notices, not the ones he doesn't know to look for. The payroll scare was the event that made him realize he needs something watching his finances continuously, not just something that answers questions when he remembers to ask.
 
**What success looks like:** Marcus receives a specific, dollar-quantified forecast — "Based on your AR and seasonal payroll, you will be $45,000 short in week 3 of October" — before the problem materializes. He acts on it in time. He does not experience a cash crisis he could have avoided. He describes the product as "the financial co-founder I never had."
 
**Buyer status:** Economic buyer — Marcus pays for the subscription. \[UNVALIDATED — not confirmed through interviews.\]
 
---
 
### Persona B — Priya Sharma, Operations Manager (updated)
 
**Role:** Operations Manager at a 15-person marketing agency with approximately $1.8M in revenue. Has QBO access. The founder expects her to surface financial problems before they escalate.
 
**Context:** Priya now has access to QBO Intelligence Chat but doesn't trust herself to ask the right questions. Her value to the founder is not in answering financial questions — it's in catching things before the founder has to ask. She needs a system that monitors continuously and pushes findings to her, because she cannot afford to miss something because she didn't know to look.
 
**Primary pain point:** Priya is accountable for financial oversight she is not equipped to perform proactively. She checks the numbers when asked but does not have the financial training to know what patterns are dangerous before they appear in the P&L. She would act on specific, pre-digested findings — she just needs the system to find them and explain them in plain language.
 
**What success looks like:** Priya receives a proactive intelligence brief that says "Three invoices totaling $38,000 are 47+ days overdue. The average days-to-collect on your net-30 invoices has slipped from 34 to 52 days over the last 6 months. This is creating a projected shortfall." She brings this to the founder before they have to ask.
 
**Buyer status:** Champion, not economic buyer. \[UNVALIDATED.\]
 
---
 
### Persona C — James Okafor, CPA Firm Principal *(P2 — unvalidated channel)*
 
**Role and context:** Same as V1 PRD. Unchanged. This persona and the B2B2B accounting firm channel remain P2 and entirely unvalidated. Do not build for Persona C until at least 3 firms have expressed willingness to pay through direct interviews or letters of intent.
 
---
 
### Persona D — "The Bench Refugee" *(new)*
 
**Role:** Owner of a service or retail business with $800K–$3M in revenue. Used Bench Accounting for 2–4 years. Lost access to their financial records during the December 2024 collapse. Has since moved to QuickBooks Online but is operating without the managed intelligence layer Bench provided.
 
**Context:** The Bench refugee experienced the worst-case scenario of managed financial services: a vendor that held their data on a proprietary system shut down with 14 days of notice during the most sensitive financial period of their year. Many had to reconstruct months of bookkeeping from raw bank statements to file taxes. They are now emotionally primed on the lock-in risk in a way that other SMB owners are not.
 
They are running basic QBO now — their books are up to date — but they have regressed from Bench's managed intelligence to doing everything manually. They miss the "someone is watching this for me" feeling but are no longer willing to trust that to a service that holds their data exclusively.
 
**Primary pain point:** They want the intelligence layer Bench promised — proactive financial monitoring, someone (or something) watching for problems — but they need it to run on their own QBO file so that the underlying data can never be held hostage again. They are actively searching for this. The lock-in concern is so strong that a product that cannot clearly and demonstrably promise data portability will not get past the first sales conversation.
 
**What success looks like:** The Bench refugee connects their QBO file, sees an explicit "read-only — we never touch your ledger" confirmation, and begins receiving proactive intelligence briefs within the first sync cycle. Within 30 days, they describe the product as "Bench without the risk." They tell other displaced Bench users about it. \[INFERRED — not validated through interviews.\]
 
**Buyer status:** Economic buyer with demonstrated willingness to pay (they paid $299–$799/month for Bench). \[UNVALIDATED — the active migration window may have narrowed 18+ months post-collapse. See Section 9.\]
 
> ⚠ \[VERIFY\]: The Bench Refugee persona is the highest-priority segment to validate through primary research. If the active migration window has closed — if these users have already settled into QBO and accepted the status quo — this persona does not generate an addressable cohort. Five interviews with former Bench customers should be the first validation action after this PRD is written.
 
---
 
## 4. Goals & Success Metrics
 
### 3-month goal (traction and intelligence validation)
 
25 paying organizations on any subscription tier. At least 40% of active organizations have received and engaged with at least one proactive intelligence brief (opened the brief, clicked through to the detail, or acknowledged an alert). This is the leading indicator that the P0 intelligence engine is delivering genuine value, not just creating notification noise.
 
### 6-month goal (growth and agentic proof of concept)
 
100 paying organizations. At least one public reference customer willing to provide a named case study. At least 10 organizations have used the draft-and-approve agentic execution feature (invoice acceleration or subscription detection). $12,000 MRR.
 
### The three metrics that matter most at this stage
 
**1. Proactive alert engagement rate (new — highest priority signal)**
Definition: The percentage of triggered proactive alerts (cash flow cliff warnings, intelligence brief findings rated high or critical) that result in a user action within 48 hours. "Action" is defined as: clicking "Ask AI about this," reviewing an agent draft, marking an alert as acknowledged with a note, or navigating to the related transactions.
Why it matters: This is the behavioral validation test for the core product hypothesis. If users are receiving proactive alerts but not acting on them, either the findings are not credible, not specific enough, or the severity is miscalibrated. A 40%+ action rate within 48 hours of a high/critical alert is the minimum signal that the proactive intelligence engine is producing actionable output, not noise. Below 25%, re-examine alert quality before adding more alert types.
Target: 40% within 48 hours for high and critical severity alerts.
 
**2. 30-day organization retention rate**
Definition: The percentage of organizations that submit at least one AI query or engage with at least one proactive alert in the 30-day window after their trial or first paid month begins.
Target: 55% minimum to continue building. Below 40%, stop adding features and diagnose the retention problem first.
 
**3. Intelligence brief open and engagement rate**
Definition: The percentage of intelligence briefs delivered (in-app and/or email) where the user opens the brief and engages with at least one finding (clicks through to detail, asks a follow-up question, or reviews an agent draft). Tracked separately from the alert engagement rate — this measures response to the packaged weekly/cycle brief, not individual alert pings.
Target: 50%+ open rate on email delivery (when emails are sent per the email rule); 30%+ engagement with at least one finding.
 
---
 
## 5. Core Features
 
> **Technical context:** The trial deployment uses Gemini 2.0 Flash (Google AI Studio free tier) as the AI language model, Supabase Free tier for the database and authentication, and Vercel Hobby for hosting. When the product reaches paying customers, the AI layer migrates to Claude Haiku 4.5 (fast queries) and Claude Sonnet 4.6 (complex analysis). Acceptance criteria are written against product behavior, not model-specific behavior.
 
---
 
## P0 — Data Sovereignty Foundation
 
---
 
### Feature: QuickBooks Online integration (read-only, sovereignty-enforced)
- **Priority:** P0
- **User story:** "As Marcus, I want to connect my QuickBooks Online account using a read-only connection so that the product can analyze my data while I have a guarantee that it can never modify my books."
- **Acceptance criteria:**
  1. The OAuth scope requested from QuickBooks is `com.intuit.quickbooks.accounting` in read-only mode. The application never requests write scopes (`com.intuit.quickbooks.accounting.write` or equivalent). This is verified at the application level and enforced at the Intuit developer console.
  2. Clicking "Connect QuickBooks" initiates an OAuth 2.0 PKCE flow that redirects the user to the QuickBooks authorization page in the same browser tab (not a new tab, which would break PKCE cookie-based state management).
  3. After successful authorization, the initial import pulls: Chart of Accounts, all transactions from the prior 13 calendar months, company name, currency, and fiscal year settings. No data is written back to QuickBooks at any point during or after this import.
  4. The connected QuickBooks account is labeled "Read-only connection" in the Settings > Connections screen with a tooltip: "This product reads your QuickBooks data but never modifies it. Your books are always under your control."
  5. The user can disconnect the product from QuickBooks at any time. On disconnection, all synced data is scheduled for deletion within 24 hours. The product sends a confirmation email with the scheduled deletion timestamp.
- **Edge cases to handle:**
  1. QuickBooks prompts the user to grant write permissions during OAuth (e.g., if the developer console is misconfigured): the callback handler validates that only read scopes were granted and rejects the connection if write scopes are present, redirecting to an error page explaining the issue.
  2. QuickBooks API returns stale or inconsistent data (e.g., a transaction that appears in the transaction list but not in the account register): import the transaction, log the inconsistency to the data_quality_log, and include a note in the sync summary.
---
 
### Feature: "You own your data" onboarding screen
- **Priority:** P0
- **User story:** "As a Bench refugee or any user who has experienced financial data lock-in, I want explicit, verifiable confirmation that this product cannot hold my data hostage before I enter my QuickBooks credentials."
- **Acceptance criteria:**
  1. Between completing organization setup and initiating the QuickBooks OAuth connection, a full-screen onboarding step is shown — it cannot be skipped — with the following content: (a) "We connect to your QuickBooks file, not replace it. Your ledger stays in QuickBooks, exactly as it is." (b) "Read-only access. We can never create, modify, or delete a transaction in your books." (c) "Cancel anytime. If you cancel, your QuickBooks file is 100% intact. We will never hold your financial history." (d) A "Download your data" button that exports all findings, reports, and conversation history as a JSON file at any point after connection.
  2. The "Download your data" export is available at all times from Settings > Account, not just during onboarding. It downloads a zip file containing: all AI-generated reports (PDF + JSON), all conversation history (JSON), and all proactive alert history (JSON). It does not contain the raw transaction data (which lives in QBO), only what the product itself produced.
  3. The onboarding screen explicitly states which OAuth scope was granted: "We have read-only access to: your Chart of Accounts, transactions, invoices, and company settings. We have no access to: sending transactions, modifying your books, or accessing your payroll data."
  4. A user who completes this screen and then asks a support question about data ownership is shown the same content inline without being redirected elsewhere.
  5. This screen is shown once at initial onboarding. It is always accessible at Settings > Account > Data & Privacy.
- **Edge cases to handle:**
  1. User is a non-owner (org member, not founder) — the screen is shown to every new user on their first login, not just the org owner, since any member of the business deserves to understand the data relationship.
  2. User is migrating from Bench — the "Bench refugee migration path" feature (below) intercepts them before this screen and adds Bench-specific context.
---
 
### Feature: Bench refugee migration path
- **Priority:** P0
- **User story:** "As a displaced Bench customer who lost access to my financial data, I want a migration path that acknowledges what happened, explains how this product is architecturally different, and gets me running without requiring me to already have clean historical data."
- **Acceptance criteria:**
  1. During onboarding organization setup, a question is shown: "Were you previously using a managed bookkeeping service like Bench?" If yes, the user is routed to a dedicated migration flow with additional explanatory screens before being asked to connect QuickBooks.
  2. The dedicated migration flow includes one screen that explicitly addresses the Bench scenario: "If you're coming from Bench, you know what data lock-in looks like. This product is structurally different: your QBO file is the source of truth. We read it. We never own it. If we shut down tomorrow, your QBO file is unchanged."
  3. The migration flow offers three options: (a) Connect QuickBooks Online (preferred path — imports up to 13 months of history); (b) Connect Xero; (c) Upload CSV — for users who have raw transaction exports from Bench or another service but have not yet set up a QBO/Xero account. The CSV path accepts bank statement exports and QuickBooks Transaction Detail Report exports.
  4. For users who select the CSV path: the product processes the uploaded CSV, normalizes transactions into its internal schema, and clearly marks the data source as "CSV import — not connected to a live accounting platform." All proactive intelligence features that require an ongoing sync (cash flow cliff detection, anomaly monitoring) display a persistent banner: "Connect QuickBooks or Xero to enable real-time monitoring. Your imported data is static."
  5. A "Migration complete" confirmation screen summarizes: how many months of data were imported, the earliest transaction date in the system, and a direct link to connect a live accounting platform if the user has not already done so.
- **Edge cases to handle:**
  1. User selects "Yes, former Bench user" but does not have CSV exports — they only have bank statements in PDF format: show a clear message that PDF bank statements are not currently supported and offer a link to QuickBooks' free 30-day trial with instructions for importing bank statements into QBO before connecting to this product.
  2. User uploads a CSV with transactions predating the earliest supported date (e.g., transactions from 2019): import all rows but flag that proactive intelligence requires 90+ days of continuous data and will activate once that threshold is met.
---
 
## P0 — Proactive Intelligence Engine
 
---
 
### Feature: Cash flow cliff detection
- **Priority:** P0
- **User story:** "As Marcus, I want to receive a specific, dollar-quantified warning before I will face a cash shortfall — with enough lead time to act — rather than discovering the shortfall when it arrives."
- **Acceptance criteria:**
  1. After each successful sync, the cash flow cliff detection model evaluates: (a) current accounts receivable aging by customer and invoice; (b) recurring expense schedules (identified from transaction history — payroll cycles, rent, subscription patterns); (c) historical seasonality (month-over-month revenue variance for the same month in prior years, if data is available). It produces a 30-day rolling cash flow projection with a confidence range.
  2. When the model projects a cash position below a threshold — either below zero or below a user-configurable minimum buffer (default: 10% of average monthly operating expenses) — it triggers a "cash flow cliff" finding with: the projected shortfall dollar amount, the projected date of the shortfall (specific week, not just "next month"), the primary contributing factors (e.g., "AR aging: $38,000 past due across 3 invoices; Q4 payroll spike: $22,000 above monthly average"), and a confidence level (high / medium / low based on data completeness).
  3. Cash flow cliff findings are classified as **critical severity** when the projected shortfall exceeds 20% of monthly operating expenses, or **high severity** when it exceeds 10%. Medium and low severity findings exist for positive balance warnings (balance declining toward threshold but not yet critical). The email rule from the Intelligence Brief feature applies: critical and high severity trigger email delivery; medium and low are in-app only.
  4. The cash flow cliff detection model requires a minimum of 90 days of continuous transaction data to produce a projection. Below 90 days, the feature is disabled with a clear explanation: "Cash flow forecasting activates once you have 90 days of connected data. You currently have [N] days. It will activate on [projected date]."
  5. All projections are labeled with their data as-of date and include the disclaimer: "This is an AI-generated projection based on your QuickBooks data. It is not a guarantee of future cash position. Consult a qualified financial professional for decisions that require expert judgment."
- **Edge cases to handle:**
  1. Organization has strong seasonal revenue (e.g., a tax preparation firm with 80% of revenue in Q1): the model must account for seasonality by comparing the current month to the same month in prior years, not just the trailing 30-day average. If seasonal data is not yet available (first year in the system), the model flags the projection as low confidence and states the reason.
  2. Large one-time expected expense (e.g., equipment purchase the owner entered as a future transaction in QBO): the model includes future-dated transactions from QBO in the projection window if they are present, labeled as "scheduled expenses."
---
 
### Feature: Anomaly alert engine
- **Priority:** P0
- **User story:** "As Marcus, I want to be notified when something has gone subtly wrong in my finances — the kind of slow-moving problem I wouldn't notice until it was expensive — without having to check my books daily."
- **Acceptance criteria:**
  1. The following four anomaly patterns are evaluated after each successful sync:
     - **Expense spike:** A single expense category's 7-day spend exceeds 150% of its 30-day rolling average. Severity: high if the spike is >200%, medium if 150–200%.
     - **Collections slippage:** Average days-to-collect on issued invoices has increased by more than 25% over a rolling 60-day window (e.g., slipping from 34 days average to 45 days average). Severity: high if slippage > 40%, medium if 25–40%.
     - **Margin deterioration:** Gross margin for the current month-to-date is tracking more than 15% below the same-period-prior-year gross margin, based on available data. Requires 12 months of history. Severity: high if deterioration >25%, medium if 15–25%.
     - **Duplicate vendor billing:** The same vendor name appears on more than one recurring charge within a 25–35 day window, in amounts within 10% of each other, to two different expense accounts. Severity: high (potential accidental duplicate billing).
  2. Each triggered anomaly produces a finding with: plain-English description (e.g., "Your SaaS software spend for the last 7 days is $4,200 — 180% above your 30-day average of $2,300"), the specific transactions contributing to the anomaly (up to 5 listed), and — where applicable — a pre-generated agent draft action (see Agentic Execution features).
  3. Anomaly findings persist in the Alerts screen and remain actionable until acknowledged by the user.
  4. An anomaly that remains in the same triggered state for more than 7 consecutive sync cycles without user acknowledgment is escalated by one severity level (medium → high) and re-surfaced in the next intelligence brief.
  5. Each anomaly type can be individually enabled or disabled from Settings > Notifications. User-configurable thresholds apply to all four types.
- **Edge cases to handle:**
  1. Collections slippage anomaly fires during the first 30 days of a new customer relationship, where there is no meaningful "average" to compare against: skip the comparison for customers with fewer than 2 completed invoice cycles and indicate "insufficient history for this customer" in the finding detail.
  2. Duplicate vendor billing anomaly fires on a legitimate split payment (e.g., a vendor deliberately invoiced across two cost centers): user can mark a specific pair of transactions as "intentional split — not a duplicate" which suppresses future firing for that vendor-account combination.
---
 
### Feature: Intelligence brief (proactive push summary)
- **Priority:** P0
- **User story:** "As Marcus, I want to receive a concise summary of what the AI found this cycle — without having to log in and check — so that I stay informed about my business's financial health without the product becoming another source of notification noise."
- **Acceptance criteria:**
  1. After each sync cycle in which findings are generated, the system evaluates the aggregate severity of all new findings and applies the following **email delivery rule**, which is non-negotiable and not user-configurable:
     - **At least one CRITICAL finding:** Email is sent immediately (within 30 minutes of sync completion). Subject: "[Product Name] — urgent: [brief one-line description of critical finding]."
     - **At least one HIGH finding, no critical:** Email is sent within 2 hours. Subject: "[Product Name] — action recommended: [brief one-line description of highest-severity finding]."
     - **Only MEDIUM findings, no high or critical:** No email is sent. In-app notification only (bell icon badge). The user sees findings when they next log in.
     - **Only LOW findings:** No email is sent. No in-app push notification. Findings are visible on the dashboard and in the Alerts screen but generate no active notification.
     - **No findings this cycle:** No contact of any kind. Silence is the correct signal that things are fine.
  2. When an email IS sent, the email body contains: the specific finding(s) that triggered the email (described in plain English with dollar amounts), the severity label, a "View full brief" link to the in-app detail, and a "Ask the AI about this" link that opens the Q&A interface with the finding pre-loaded as context.
  3. The intelligence brief email never includes generic performance summaries, revenue totals, or routine metrics unless they are anomalous. It is not a weekly newsletter. Every email contains a finding that requires attention.
  4. The email delivery rule overrides all user notification preferences except one: a user may opt out of email entirely (in-app only), in which case all findings are delivered in-app regardless of severity.
  5. Each intelligence brief email includes a footer: "You're receiving this because a high or critical finding was detected in your QuickBooks data. This is AI-generated financial analysis. It is not financial advice."
- **Edge cases to handle:**
  1. Three critical findings arrive in the same sync cycle: send one email covering all three, not three separate emails. The subject line references the most urgent: "[Product Name] — urgent: cash shortfall projected October 21 (+ 2 more findings)."
  2. A critical finding was already emailed in the previous cycle and remains unacknowledged: the finding is re-surfaced in the next email only if its severity has changed (e.g., shortfall window has narrowed) or new data has materially changed the projection. Do not re-send the exact same finding twice in consecutive cycles; this trains users to ignore repeated alerts.
---
 
## P0 — Reactive Q&A (table stakes, not headline)
 
---
 
### Feature: Conversational financial Q&A
- **Priority:** P0
- **User story:** "As Marcus, I want to ask questions about my finances in plain English and receive accurate answers based on my actual QuickBooks data — as a baseline capability, understanding this feature alone does not differentiate this product from incumbent tools."
- **Acceptance criteria:**
  1. A user can type any question about their organization's financial data into a chat interface and receive a plain-English response within 5 seconds for questions answerable from pre-computed metrics, or within 15 seconds for questions requiring a full data query.
  2. Every AI-generated response is grounded exclusively in the organization's synced transaction data. If the available data is insufficient to answer, the response explicitly states what data is missing.
  3. Every AI-generated response displays the standard disclaimer: "This is AI-generated analysis of your accounting data. It is not financial advice. Consult a qualified financial professional for decisions that require expert judgment."
  4. The AI correctly handles all question types from the V1 PRD (revenue by period, expense breakdown, cash position, profitability, comparisons) plus: "What should I be worried about right now?" (must surface the highest-severity active finding from the proactive intelligence engine, not a generic response), and "What have you found recently?" (must surface the most recent intelligence brief findings, not require the user to navigate to the Alerts screen).
  5. Usage is metered per organization per calendar month as defined in the subscriptions table. Failed queries do not count against quota.
- **Edge cases to handle:**
  1. User asks "What would Intuit Intelligence Chat say about this?" or references incumbent tools: the AI answers the underlying financial question accurately without commenting on competitor products or making comparative claims.
  2. User asks the same question the proactive intelligence engine already surfaced in an alert: the AI's response references the existing alert by name and severity rather than presenting the finding as newly discovered.
---
 
### Feature: Conversational follow-up within a session
- **Priority:** P0
- **User story:** "As Marcus, I want to ask follow-up questions within a conversation session so that I can drill into a finding without having to repeat context."
- **Acceptance criteria:**
  1. Within a single conversation session, the AI maintains full context of the prior turns. A follow-up question about "those three invoices" correctly references the invoices discussed earlier in the same session without the user repeating the amounts or customer names.
  2. The conversation history within a session persists for 12 months and is accessible from the Conversations screen.
  3. A "Pick up where I left off" entry point on the /ask screen shows the most recent conversation with its last message date, allowing the user to resume without navigating to the full history.
- **Edge cases:** Same as V1 PRD.
---
 
## P1 — Agentic Execution (draft-and-approve only)
 
> **Architectural constraint applying to all P1 agentic features:** The AI never sends, submits, or transmits anything on the user's behalf. Every agentic output is a text draft the user reviews, optionally edits, copies, and sends from their own email client. No OAuth to Gmail, Outlook, or any email provider is established in V1. The product makes no claim about delivery, response tracking, or email threading. "Initiate" throughout this section means "draft and present for user approval."
 
---
 
### Feature: Invoice acceleration (draft-and-approve)
- **Priority:** P1
- **User story:** "As Marcus, when the product identifies an overdue invoice, I want it to draft a professional collections-nudge email I can send in thirty seconds, rather than asking me to compose the message myself from scratch."
- **Acceptance criteria:**
  1. When the anomaly engine or cash flow cliff detection identifies one or more invoices as overdue (net-30+ past due, or exceeding the invoice's stated terms by more than 10 days), a "Draft a nudge" CTA appears alongside the finding in the Alerts screen and in the intelligence brief detail view.
  2. Clicking "Draft a nudge" opens a modal showing: (a) a pre-written collections email draft (approx. 80–120 words, professional tone, preserves the business relationship) that includes the invoice number, amount, and original due date pulled from QBO data; (b) an "Edit draft" text area where the user can modify the text; (c) a "Copy to clipboard" button that copies the final draft; (d) a "Mark as sent" toggle the user can activate after sending to track status in-app.
  3. The draft is generated in under 5 seconds. It addresses the recipient's company name (from the QBO customer record) and is signed with the organization name (from the org settings). No personally identifiable recipient contact information (email address) is included in the draft or displayed to the product — the user adds the recipient address in their own email client.
  4. After the user marks a draft as "sent," the associated invoice appears as "nudge sent" in the Alerts screen. If the invoice remains overdue in QBO for 14 more days after being marked sent, a new alert fires ("Second nudge recommended") with an updated draft.
  5. The draft-generation feature never sends the email on the user's behalf. The copy-to-clipboard action is the final step. No delivery confirmation, open tracking, or click tracking is performed.
- **Edge cases to handle:**
  1. Multiple overdue invoices from the same customer: the draft consolidates all invoices into a single message ("You have three outstanding invoices totaling $X...") rather than generating three separate drafts that would create a spam-like impression.
  2. Customer relationship is flagged by the user as "do not contact" (via a tag in QBO or a setting in the product): suppress the "Draft a nudge" CTA for invoices from that customer and show "Outreach suppressed" in the alert detail.
---
 
### Feature: Duplicate subscription detection (draft-and-approve)
- **Priority:** P1
- **User story:** "As Marcus, when the product detects what looks like a billing error or duplicate subscription, I want it to draft a cancellation or inquiry message I can send — because identifying the duplicate is easy, but drafting a professional inquiry is friction I consistently defer."
- **Acceptance criteria:**
  1. When the duplicate vendor billing anomaly fires (defined in the Anomaly Alert Engine feature), a "Draft an inquiry" CTA appears alongside the finding.
  2. The draft is a professional inquiry email to the vendor asking them to confirm whether the two charges are intentional or a billing error. It includes: the two transaction amounts, dates, and account descriptions; a request for a response within 5 business days. The draft does not include any demand for refund or threat of chargeback — it is an inquiry, not a dispute.
  3. A separate "Draft a cancellation" CTA is available for cases where the user confirms the duplicate is a legitimate redundant subscription (e.g., two seats of the same tool). The cancellation draft is addressed generically ("To whom it may concern at [vendor name]") and asks to cancel one of the two subscriptions.
  4. Same delivery mechanics as Invoice Acceleration: copy to clipboard, user sends manually, user marks as sent in-app.
  5. If the vendor name appears on an established "approved recurring vendors" list the user can maintain in Settings, the duplicate detection is suppressed for that vendor.
- **Edge cases to handle:**
  1. Detected "duplicate" is a legitimate quantity-based charge (two units of the same service at the same price): user can dismiss the finding and mark it as "intentional — multiple units" to suppress future firing for that vendor-amount combination.
---
 
### Feature: Vendor negotiation starter (draft-and-approve)
- **Priority:** P1
- **User story:** "As Marcus, when the product identifies a vendor contract whose cost has grown materially compared to 12 months ago, I want it to draft a renegotiation opener I can send — because I know I should renegotiate but never remember to and never know how to start."
- **Acceptance criteria:**
  1. When a vendor's recurring charge has increased by more than 20% compared to the same vendor's charge 12 months ago (verified across at least 3 matching billing cycles), the anomaly engine creates a "cost escalation" finding with the specific percentage increase and total annual overage versus the prior-year rate.
  2. A "Draft a renegotiation opener" CTA appears alongside the finding. The draft is a 100–150 word professional message acknowledging the business relationship, referencing the cost increase, and asking to schedule a call to discuss pricing for the next term. It does not include aggressive negotiating language.
  3. The draft includes the vendor name, the current annual spend, and the year-over-year increase amount pulled from transaction data. It is addressed generically ("To the [vendor name] account team") — the user adds the specific contact.
  4. The draft-generation feature is only triggered for vendors with a minimum of 12 months of transaction history in the system.
  5. Same delivery mechanics as other draft features.
- **Edge cases to handle:**
  1. Cost increase is due to the user adding a new seat or service tier (e.g., upgrading from 5 seats to 10 seats at the same per-seat price): the draft generation should not fire if the quantity has visibly changed. The product uses the per-unit charge from QBO's line items where available; if line items are not available, it marks the finding as "possible quantity change — verify before initiating" and shows the draft with a caution label.
---
 
## P1 — Xero Integration
 
### Feature: Xero connection
- **Priority:** P1
- **User story:** "As a user whose organization uses Xero instead of QuickBooks, I want to connect my Xero account with the same read-only, data-sovereignty guarantee."
- **Acceptance criteria:** Same as V1 PRD Feature F8, with the addition that the read-only scope constraint from the QuickBooks feature applies: only read scopes are requested. The "You own your data" and data sovereignty messaging shown during QuickBooks onboarding is displayed identically for Xero users. QuickBooks and Xero connections remain mutually exclusive in V1.
---
 
## P2 — Roadmap (do not build until P1 is validated)
 
### Feature: Fully autonomous agentic execution
- **Priority:** P2
- **Description:** The AI sends communications on the user's behalf after a one-time authorization, without per-action approval. Requires Gmail/Outlook OAuth, email threading, delivery tracking, and significantly higher user trust. Do not build until the draft-and-approve P1 features have demonstrated that users act on and trust the AI's drafts.
### Feature: Cash flow scenario modeling
- **Priority:** P2
- **Description:** "What if I hired two people?" structured what-if analysis. Requires the cash flow cliff detection P0 feature to be validated and trusted before adding a scenario layer.
### Feature: Plaid live bank connection
- **Priority:** P2
- **Description:** Same as V1 PRD. Not required for V1.
### Feature: Accounting firm multi-client portal
- **Priority:** P2
- **Description:** Same as V1 PRD. Unvalidated channel. Do not build until 3 firms have expressed willingness to pay.
### Feature: Industry benchmarking
- **Priority:** P2
- **Description:** Requires scale of data. Not feasible until product has significant customer base.
---
 
## 6. Out of Scope for V1
 
**Tax filing and tax advice.** Same as V1 PRD. The product reads accounting data; it does not file, prepare, or advise on taxes.
 
**Payroll processing.** Same as V1 PRD. Payroll appears as an expense line item only.
 
**Direct bank payments or money movement.** Same as V1 PRD. The product is read-only on the financial data layer.
 
**Any feature requiring regulated financial advisor status.** Same as V1 PRD.
 
**Mobile native application.** Same as V1 PRD.
 
**Integrations beyond QuickBooks Online and Xero.** Same as V1 PRD. QuickBooks Desktop, Sage, FreshBooks, Wave, and all others are out of scope.
 
**Autonomous agentic execution (AI sends without per-action approval).** The AI never sends, submits, or transmits any communication on the user's behalf in V1. Every agentic output is a text draft. The user copies and sends. This is not a feature to be added later in V1 — it is explicitly P2.
 
**Email client integration (Gmail, Outlook, etc.).** No OAuth connections to email providers are established in V1. Draft communications are text the user copies from the product into their own email client. No delivery confirmation, open tracking, or inbox threading is supported in V1.
 
**Writing back to QuickBooks or Xero.** The product holds read-only OAuth scopes. It never creates, modifies, or deletes a transaction, journal entry, invoice, or any record in the user's accounting platform.
 
**Proprietary financial data storage.** The user's transaction history is synced into the product's database for analysis but the source of truth is always QBO/Xero. The product's database is a derivative cache, not the authoritative record.
 
---
 
## 7. Competitive Positioning
 
This table is a core product artifact, not a marketing summary. It defines the product's position in every sales and investor conversation and must remain accurate as the market evolves.
 
| Feature | QBO/Xero (incumbent) | Bench (defunct model) | This product |
|---|---|---|---|
| **Data ownership** | User owns — open platform | Vendor owns — proprietary ledger | User owns — runs on their QBO/Xero file, read-only |
| **Intelligence type** | Reactive — answers questions the user asks | Human-dependent — monthly back-and-forth | Proactive — finds problems and quantifies them before the user asks |
| **Cash flow forecasting** | Not available natively (as of July 2026) \[VERIFY\] | Human-generated, monthly | AI-generated, updated on every sync, dollar-quantified and date-anchored |
| **Actionability** | Insight only — user must execute manually | Human executes over days/weeks | Draft-and-approve — AI drafts the action, user executes in 30 seconds |
| **Lock-in risk** | Low — open platform, user can leave | **Critical** — Bench locked users out at shutdown | Zero — cancelling the product leaves QBO/Xero unchanged |
| **Proactive alerting** | Not available natively \[VERIFY\] | Yes, human-driven | Yes, AI-driven, severity-calibrated, email only for high/critical |
| **Intelligence brief** | Not available | Yes (human-written, delayed) | Yes, AI-written, pushed proactively, email-gated by severity rule |
| **Price** | ~$30/mo for QBO (no AI layer) | $299–$799/mo (defunct) | $99–$299/mo |
| **Bench refugee path** | N/A | N/A | Dedicated onboarding, CSV fallback, explicit lock-in guarantee |
 
> ⚠ **\[VERIFY — competitor claims\]:** The "Not available natively" claims for cash flow forecasting and proactive alerting in QBO/Xero must be verified immediately before any sales or marketing materials reference this table. Intuit and Xero are shipping AI features rapidly. If either has shipped native proactive cash flow alerts before this product launches, the competitive positioning in rows 3 and 5 requires revision.
 
---
 
## 8. Assumptions and Risks
 
**A1 — Intuit Intelligence Chat and Just Ask Xero have not shipped proactive cash flow alerting or forecasting \[VERIFY — highest competitive risk\]**
The entire proactive intelligence pillar rests on this assumption. If either incumbent has shipped a native "you will have a cash shortfall in week 3 of October"-style alert before this product launches, the P0 intelligence engine is competing with a free feature. This must be verified by testing both products today, not by reading documentation.
 
**A2 — The active Bench refugee migration window is still open \[UNVALIDATED — timing risk\]**
The Bench collapse occurred in December 2024. If the primary interview for this persona occurs 18+ months after the collapse, the cohort of actively migrating refugees may have substantially stabilized into QBO. The opportunity may have narrowed from an actively mobile cohort to a latent cohort who are settled but still emotionally primed on lock-in. Five interviews with former Bench customers are needed to characterize this.
 
**A3 — SMB owners will act on proactive alerts; they don't just read them and ignore them \[UNVALIDATED — highest behavioral risk\]**
This is the central product hypothesis. The value proposition is worthless if users receive an intelligence brief, feel mildly anxious, and then defer action indefinitely. Whether proactive, specific, dollar-quantified alerts produce action — rather than anxiety or alert fatigue — is unvalidated. The 40%-within-48-hours action rate target in Section 4 is the instrument for measuring this. If the rate is below 25% after the first 30-day cohort, the alert design, specificity, and draft-and-approve execution must be re-examined before adding more alert types.
 
**A4 — Draft-and-approve agentic execution is valuable without Gmail/Outlook OAuth \[VERIFY\]**
Requiring users to manually copy a draft into their email client adds friction. Whether that friction is low enough that users will act — or high enough that they defer — is untested. The assumption is that composing the email is the high-friction step; copying a polished draft is the low-friction step. This must be validated by user testing. If users consistently say "I would use this if it sent automatically" but don't copy drafts, the P2 autonomous execution may need to accelerate.
 
**A5 — Read-only OAuth is a sufficient differentiator on data sovereignty \[INFERRED\]**
The assumption that "we request read-only scopes" is a credible and verifiable data sovereignty commitment that satisfies the Bench-traumatized buyer. It may not be — some sophisticated buyers may reasonably ask about data retention in our database, third-party data sharing, or what happens to their synced data if we are acquired. The data sovereignty promise needs legal review and must be backed by actual contractual commitments in the Terms of Service, not just marketing language.
 
**A6 — The email delivery rule (email only for high/critical) reduces churn, not engagement \[INFERRED\]**
The rule is designed to prevent alert fatigue. The assumption is that a product that emails only when something genuinely requires attention trains users to open every email, rather than training them to ignore a daily digest. This needs behavioral validation — if users find the silence unsettling ("I haven't heard from the product in 3 weeks, is it working?"), a lightweight "all quiet this week" in-app indicator may be needed without triggering an email.
 
**A7 — 90 days of transaction data is the right minimum window for proactive intelligence \[INFERRED\]**
The 90-day minimum for cash flow cliff detection is a design assumption, not a data-validated threshold. With less history, seasonality patterns are absent, recurring expense schedules are incomplete, and AR aging baselines are unreliable. Whether 90 days produces materially better forecasts than 60 or 45 days needs validation against real data.
 
---
 
## 9. Open Questions
 
**From the Research Brief (carried forward)**
 
1. Does Intuit Assist/Intelligence Chat already adequately address the interpretation gap for non-expert SMB owners? *(Check immediately — this is now verified to exist as a reactive tool; the question is whether proactive features have launched.)*
2. Who is the actual economic buyer within an SMB — the owner, the bookkeeper, the operations manager? *(Requires 10 user interviews.)*
3. Does providing AI-generated financial analysis trigger financial advice regulation in the primary target jurisdiction? *(Requires legal consultation before launch.)*
4. What level of answer accuracy is required for users to trust the product for real financial decisions?
**New questions from the updated hypothesis**
 
5. What triggers a Bench refugee to consider a new product versus staying with basic QBO? Is the active migration window still open 18+ months post-collapse, or has the cohort stabilized? *(Five interviews with former Bench customers — this is the first validation action.)*
6. How should the product handle a user who connects QBO but has fewer than 90 days of transaction history? The proactive intelligence engine requires a baseline — what is the right minimum viable data window for a useful first brief? Is the appropriate response a waiting screen, a limited-capability mode, or partial analysis with explicit confidence bounds?
7. Should the intelligence brief be email-push, in-app notification, or both in MVP? The email-only-for-high-critical rule was specified for V1, but whether email is the right primary channel for SMB owners versus in-app or SMS requires validation. The channel affects both engineering (email deliverability, DKIM setup, Resend configuration) and product design (what the brief looks like in email vs. in-app).
8. Is the draft-and-approve friction low enough that users will act? Or does removing the "copy to clipboard" step (i.e., adding Gmail OAuth) need to happen before the feature has practical adoption? This is the central validation question for the P1 agentic features.
9. How does the product position itself if Intuit ships proactive cash flow forecasting natively? Is the response to compete on accuracy, on the draft-and-approve execution layer, on data sovereignty, or on price? Having the answer to this before launch reduces reactive scrambling if the competitive landscape shifts.
10. What is the right severity threshold for the cash flow cliff detection feature? The current specification uses 10% of monthly operating expenses as the buffer threshold. Is this threshold appropriate for a 12-person services firm? A 40-person manufacturing company? Should thresholds be industry-adjusted?
---
 
## 10. Regulatory Note
 
> This section must be reviewed with legal counsel familiar with financial services regulation in the product's primary launch jurisdiction before the product launches to the public. The disclaimer approach described in Feature: Conversational financial Q&A is necessary but has not been verified as legally sufficient by a qualified lawyer. The V1 PRD's regulatory note applies in full to this updated version.
 
**Additional considerations from the updated hypothesis:**
 
The draft-and-approve agentic execution features (invoice acceleration, duplicate subscription detection, vendor negotiation starter) introduce a new regulatory question beyond the financial advice risk: does generating draft communications on behalf of a business user, where those communications reference specific financial figures and request action from third parties, create any liability under commercial communication regulations (CAN-SPAM, GDPR communication rules, consumer protection law)? The product does not send the communication — the user does — but the product provides the text. This question should be specifically added to the legal review agenda.
 
The data sovereignty promise ("we request read-only scopes; your QBO file is never modified") must be backed by contractual language in the Terms of Service that the legal review validates. A marketing claim of data portability that is not contractually enforceable is not a meaningful differentiator for a Bench-traumatized buyer who has experienced the gap between what a service promised and what it delivered.
 
---
 
*End of PRD v0.2. This document supersedes and replaces PRD v0.1 (July 2026). The product hypothesis has been materially updated: the product no longer leads with conversational Q&A as its primary value proposition. The primary value proposition is proactive intelligence on the user's own, portable data — with conversational Q&A as the baseline layer that incumbents now also provide. All prior implementation planning (APP_FLOW, TECH_STACK, FRONTEND_GUIDELINES, BACKEND_STRUCTURE, IMPLEMENTATION_PLAN) was written against the V1 hypothesis and must be reviewed and updated to reflect the new feature priorities, particularly the proactive intelligence engine, the data sovereignty onboarding, and the draft-and-approve agentic execution features.*