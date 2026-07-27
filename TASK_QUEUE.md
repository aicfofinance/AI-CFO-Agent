# Task Queue
## AI CFO Agent

**Last updated:** July 2026  
**Current phase:** Phase 1 — Foundation  
**Active agents:** 0  

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
| *(none)* | | | |

---

## Available (Unblocked)

| Task | Step # | Owner | Depends On |
|------|--------|-------|------------|
| *(all unblocked tasks complete — see Blocked for next actions)* | | | |
| Environment variables with build-time validation | 1.3 | backend-engineer | 1.0 |
| Complete folder structure | 1.4 | backend-engineer | 1.0 |

> **Sequencing note:** Only Step 1.0 can begin immediately. Steps 1.1–1.4 all depend on 1.0 and must wait until it appears in Completed. The orchestrator should move 1.1–1.4 to In Progress only after 1.0 is done. Because all five steps are owned by backend-engineer and are sequential, they will typically be completed in a single session — but each step's Definition of Done must be verified independently before moving to the next.

---

## Blocked

| Task | Step # | Blocked By |
|------|--------|------------|
| Supabase project and connection test | 1.5 | Step 1.3 (env schema required before Supabase setup) + external action: create Supabase account at supabase.com |
| GitHub Actions CI pipeline | 1.6 | Steps 1.2 and 1.3 (lint config and env schema must exist before CI references them) + external action: push repo to GitHub |
| *(1.7 moved to In Progress — Step 1.4 dependency satisfied)* | | |

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

---

## Orchestrator Notes

*This section is the persistent context layer between sessions. Update it whenever a session ends mid-task, a decision is made that affects agent assignments, or a dependency chain changes.*

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
