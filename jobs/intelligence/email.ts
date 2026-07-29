import { and, desc, eq, ne, sql } from "drizzle-orm";
import { Resend } from "resend";

import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/platform/auth/supabase";
import { db } from "@/lib/platform/db/client";
import { findings, intelligenceRuns, organizationMembers } from "@/lib/platform/db/schema";
import { inngest } from "@/lib/inngest";

/**
 * Event data shape for `intelligence/email.requested`.
 *
 * Dispatched by the intelligence runner (`jobs/intelligence/run.ts`) only when a
 * run produced at least one `high` or `critical` finding — `critical` immediately,
 * `high`-only after a 2-hour delay (a future event `ts`). The handler re-derives
 * everything it needs from `orgId` + `runId`; nothing finding-specific is carried
 * on the event, so a delayed high-severity email always reflects the run's current
 * state at delivery time.
 */
export type IntelligenceEmailEventData = { orgId: string; runId: string };

/** Product name used in every intelligence email subject line (Step 6.8 spec). */
const PRODUCT_NAME = "CFO Lens";

/**
 * The always-present footer. Never omitted, never collapsed (CLAUDE.md — every AI
 * output surface carries the disclaimer). This is the email-channel equivalent of
 * the streaming handler's final disclaimer chunk.
 */
const EMAIL_FOOTER =
  "You're receiving this because a high or critical finding was detected in your QuickBooks data. This is AI-generated financial analysis. Not financial advice.";

/** Severity sort rank — critical first, then high (lower rank sorts earlier). */
const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/**
 * The minimal finding shape the email renders. Monetary detail is already embedded
 * in `detail` (plain-English text with dollar amounts) by the finding generators —
 * the email never performs arithmetic on monetary values (CLAUDE.md).
 */
export type EmailFinding = {
  id: string;
  findingType: string;
  severity: string;
  headline: string;
  detail: string;
};

/**
 * The severity-gated dispatch decision, computed by the intelligence runner AFTER
 * findings are written. `delaySeconds` is `0` for any run containing a `critical`
 * finding (email immediately) and `7200` (2 hours) for a `high`-only run. A run
 * with no `high`/`critical` findings does not dispatch (`{ send: false }`).
 *
 * The input is the list of severities of this run's `high`/`critical` findings —
 * `medium`/`low` are filtered out in SQL before this is called, so an empty input
 * means "nothing worth emailing" regardless of whether medium findings exist.
 */
export type EmailDispatchDecision = { send: false } | { send: true; delaySeconds: number };

export function computeEmailDispatch(
  highCriticalSeverities: ReadonlyArray<string>,
): EmailDispatchDecision {
  if (highCriticalSeverities.length === 0) {
    return { send: false };
  }
  const hasCritical = highCriticalSeverities.includes("critical");
  return { send: true, delaySeconds: hasCritical ? 0 : 7200 };
}

/** Stable severity ordering (critical → high → …) for subject/body rendering. */
function sortBySeverity(items: ReadonlyArray<EmailFinding>): EmailFinding[] {
  return [...items].sort(
    (a, b) => (SEVERITY_RANK[a.severity] ?? 99) - (SEVERITY_RANK[b.severity] ?? 99),
  );
}

/** Minimal HTML-entity escaping for finding text interpolated into the email body. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Subject line per the Step 6.8 spec.
 * - Any critical present: `CFO Lens — urgent: [headline]`
 * - High-only:            `CFO Lens — action recommended: [headline]`
 * - Multiple findings:    append ` (+ N more)` where N = count − 1.
 *
 * The headline used is that of the highest-severity finding (critical before high).
 */
export function buildSubject(netNew: ReadonlyArray<EmailFinding>): string {
  const [top] = sortBySeverity(netNew);
  const headline = top?.headline ?? "New finding";
  const hasCritical = netNew.some((f) => f.severity === "critical");
  const label = hasCritical ? "urgent" : "action recommended";
  const extra = netNew.length - 1;
  const suffix = extra > 0 ? ` (+ ${extra} more)` : "";
  return `${PRODUCT_NAME} — ${label}: ${headline}${suffix}`;
}

/**
 * The HTML body: one block per finding (bold headline, severity label, plain-English
 * detail, two action links) followed by the always-present footer.
 */
export function buildEmailHtml(netNew: ReadonlyArray<EmailFinding>, appUrl: string): string {
  const blocks = sortBySeverity(netNew)
    .map((f) => {
      const briefUrl = `${appUrl}/dashboard?finding_id=${encodeURIComponent(f.id)}`;
      const askUrl = `${appUrl}/ask?finding_id=${encodeURIComponent(f.id)}`;
      return [
        `<h2>${escapeHtml(f.headline)}</h2>`,
        `<p>Severity: ${escapeHtml(f.severity)}</p>`,
        `<p>${escapeHtml(f.detail)}</p>`,
        `<p><a href="${briefUrl}">View full brief →</a>&nbsp;|&nbsp;<a href="${askUrl}">Ask the AI about this →</a></p>`,
      ].join("\n");
    })
    .join("\n<hr />\n");

  return `<div>\n${blocks}\n<hr />\n<p>${escapeHtml(EMAIL_FOOTER)}</p>\n</div>`;
}

/**
 * Step 1 (`fetch-findings`): the run's active `high`/`critical` findings.
 *
 * Org-scoped (`org_id` filter) per CLAUDE.md — `findings` is never queried without
 * it, even though `intelligence_run_id` alone would already isolate the rows. The
 * `medium`/`low` findings are excluded in SQL so they never reach the email path.
 */
export async function fetchActiveHighCriticalFindings(
  orgId: string,
  runId: string,
): Promise<EmailFinding[]> {
  return db
    .select({
      id: findings.id,
      findingType: findings.findingType,
      severity: findings.severity,
      headline: findings.headline,
      detail: findings.detail,
    })
    .from(findings)
    .where(
      and(
        eq(findings.orgId, orgId),
        eq(findings.intelligenceRunId, runId),
        eq(findings.status, "active"),
        sql`${findings.severity} IN ('high', 'critical')`,
      ),
    );
}

/**
 * Step 2 (`deduplicate`): the "net new or changed" subset — the findings that were
 * NOT already emailed in the prior cycle at the same severity (CLAUDE.md — no-resend
 * deduplication).
 *
 * V1 approach: find the most recent OTHER completed run for this org, load its
 * finding ids + severities, and drop any current finding that appears in the prior
 * run at the same severity. A finding is re-included only if it is genuinely new
 * (id absent from the prior run) or its severity changed. With no prior run, every
 * current finding is net-new.
 */
export async function deduplicateAgainstPriorRun(
  orgId: string,
  runId: string,
  current: ReadonlyArray<EmailFinding>,
): Promise<EmailFinding[]> {
  const [priorRun] = await db
    .select({ id: intelligenceRuns.id })
    .from(intelligenceRuns)
    .where(
      and(
        eq(intelligenceRuns.orgId, orgId),
        eq(intelligenceRuns.status, "completed"),
        ne(intelligenceRuns.id, runId),
      ),
    )
    .orderBy(desc(intelligenceRuns.startedAt))
    .limit(1);

  if (!priorRun) {
    return [...current];
  }

  const priorFindings = await db
    .select({ id: findings.id, severity: findings.severity })
    .from(findings)
    .where(and(eq(findings.orgId, orgId), eq(findings.intelligenceRunId, priorRun.id)));

  const priorSeverityById = new Map(priorFindings.map((f) => [f.id, f.severity]));

  // Keep a finding when it is new (no prior entry) or its severity changed.
  return current.filter((f) => priorSeverityById.get(f.id) !== f.severity);
}

/**
 * Resolve the org owner's email address. Owner first, then any member, then the
 * Supabase admin API for the address (there is no `email` column on
 * `organizations`). Returns `null` when no member or address can be found — the
 * caller logs and returns cleanly rather than throwing.
 */
async function resolveRecipientEmail(orgId: string): Promise<string | null> {
  const [owner] = await db
    .select({ userId: organizationMembers.userId })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.role, "owner")))
    .limit(1);

  let userId = owner?.userId ?? null;

  if (userId === null) {
    const [member] = await db
      .select({ userId: organizationMembers.userId })
      .from(organizationMembers)
      .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.role, "member")))
      .limit(1);
    userId = member?.userId ?? null;
  }

  if (userId === null) {
    return null;
  }

  const adminClient = createAdminClient();
  const { data, error } = await adminClient.auth.admin.getUserById(userId);
  if (error || !data.user?.email) {
    return null;
  }
  return data.user.email;
}

/**
 * Step 3 (`send-email`): build and dispatch the intelligence brief via Resend.
 *
 * Graceful no-op (returns cleanly, never throws) when the email cannot be sent in
 * this environment: no `RESEND_API_KEY` (dev), no `FROM_EMAIL`, or no resolvable
 * recipient. The Resend call itself is wrapped in try/catch (CLAUDE.md — every
 * external API call in an Inngest step) so a provider/network failure logs and
 * returns rather than triggering an Inngest retry storm.
 */
export async function sendIntelligenceEmail(
  orgId: string,
  netNew: ReadonlyArray<EmailFinding>,
): Promise<void> {
  if (netNew.length === 0) {
    return;
  }

  if (!env.RESEND_API_KEY) {
    console.warn({ event: "intelligence_email_skipped", reason: "no_api_key", orgId });
    return;
  }

  if (!env.FROM_EMAIL) {
    console.warn({ event: "intelligence_email_skipped", reason: "no_from_email", orgId });
    return;
  }

  const recipient = await resolveRecipientEmail(orgId);
  if (recipient === null) {
    console.warn({ event: "intelligence_email_skipped", reason: "no_recipient", orgId });
    return;
  }

  const appUrl = env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const subject = buildSubject(netNew);
  const html = buildEmailHtml(netNew, appUrl);

  try {
    const resend = new Resend(env.RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: env.FROM_EMAIL,
      to: recipient,
      subject,
      html,
    });

    if (error) {
      console.error({
        event: "intelligence_email_send_failed",
        orgId,
        errorMessage: error.message,
      });
      return;
    }

    console.info({ event: "intelligence_email_sent", orgId, findingCount: netNew.length });
  } catch (err) {
    console.error({
      event: "intelligence_email_send_failed",
      orgId,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * The intelligence email job. Triggered by `intelligence/email.requested`, dispatched
 * by the intelligence runner only for `high`/`critical` runs (Step 6.8).
 *
 * Three isolated steps: fetch the run's active high/critical findings, deduplicate
 * against the prior cycle's email set, and send. Each early-returns cleanly when
 * there is nothing to send — an already-emailed, unchanged finding produces no
 * second email.
 */
export const intelligenceEmail = inngest.createFunction(
  { id: "intelligence-email" },
  { event: "intelligence/email.requested" },
  async ({ event, step }): Promise<void> => {
    // event.data is `any` on the unparameterised client; assert the known shape.
    const { orgId, runId } = event.data as IntelligenceEmailEventData;

    // ── Step 1: the run's active high/critical findings ───────────────────────
    const currentFindings = await step.run("fetch-findings", () =>
      fetchActiveHighCriticalFindings(orgId, runId),
    );
    if (currentFindings.length === 0) {
      return;
    }

    // ── Step 2: drop findings already emailed unchanged in the prior cycle ─────
    const netNew = await step.run("deduplicate", () =>
      deduplicateAgainstPriorRun(orgId, runId, currentFindings),
    );
    if (netNew.length === 0) {
      return;
    }

    // ── Step 3: build and send the brief (graceful no-op without RESEND_API_KEY) ─
    await step.run("send-email", () => sendIntelligenceEmail(orgId, netNew));
  },
);
