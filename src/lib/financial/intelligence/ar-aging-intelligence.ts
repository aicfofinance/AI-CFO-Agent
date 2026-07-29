import { generateText } from "ai";
import { and, eq, sql } from "drizzle-orm";

import { detectRateLimitError, getModel } from "@/lib/ai/models/router";
import { db } from "@/lib/platform/db/client";
import { intelligenceRuns, transactions } from "@/lib/platform/db/schema";

import type { ArAgingBucket, ArAgingSchedule } from "./ar-aging";
import { buildArAgingSchedule } from "./ar-aging";
import type { IntelligenceStepResult } from "./anomaly";
import { insertFindingDeduped } from "./findings-writer";

/**
 * AR aging collections-opportunity analysis (Step 6.5).
 *
 * Driven by the isolated `ar-aging-analysis` `step.run()` in
 * `jobs/intelligence/run.ts` — never combined with any other analysis type
 * (CLAUDE.md, Intelligence Engine Rules). The detection is deterministic SQL over
 * the `transactions` table; the AI (via `getModel(0.5)` — never a direct provider
 * import) only phrases the finding's headline and detail.
 *
 * This module deliberately does NOT modify `ar-aging.ts` (the pure schedule
 * builder). It reuses `buildArAgingSchedule` to decide whether any overdue
 * invoices exist, then queries `transactions` directly for the per-invoice detail
 * that the `related_data` JSONB needs — invoice id, amount, client name, and days
 * outstanding — because that per-invoice bag is consumed by the agentic execution
 * layer in Phase 9 to pre-populate an invoice-acceleration draft.
 *
 * MONETARY ARITHMETIC: none happens in JavaScript. Bucket totals and the total
 * past-due figure are summed in SQL over DECIMAL and stay strings end-to-end.
 * `parseFloat` is used ONLY for threshold *comparisons* (is a bucket non-empty; is
 * the past-due total at or above the high-severity floor) — no monetary value is
 * computed or stored from it (CLAUDE.md, Financial Data Rules).
 *
 * Rate-limit guard: the two `generateText` calls plus the insert run inside one
 * try/catch. On HTTP 429 — detected via `detectRateLimitError()` — the run is
 * marked `status = 'skipped'`, `skipped_reason = 'rate_limit'` and the step returns
 * cleanly. It never rethrows a 429 (Inngest would retry an unchanged condition) and
 * never fails over to a different provider. Any non-429 error is rethrown.
 */

/**
 * Total past-due amount at or above which the finding is `high` severity rather
 * than `medium` (Step 6.5). Compared via `parseFloat` — comparison only, no
 * monetary value is derived from it.
 */
const HIGH_SEVERITY_PAST_DUE_FLOOR = 5000;

/**
 * An invoice more than this many days old is considered overdue. Standard net-30
 * terms plus the grace already baked into the aging schedule mean anything past 30
 * days is out of terms. This threshold is applied identically in
 * {@link hasOverdueInvoices} (via the non-`current` buckets) and in the per-invoice
 * SQL filter, so the "is there anything to report" check and the detail query can
 * never disagree.
 */
const OVERDUE_AGE_DAYS = 30;

/** The outcome of writing a single finding (internal to the step). */
type FindingCreationResult = { status: "created" } | { status: "skipped"; reason: "rate_limit" };

/**
 * One overdue invoice's detail for the `related_data` JSONB. `amount` is a
 * DECIMAL(15,2) string and stays a string; `daysOutstanding` is the whole-day age
 * since issue, computed in SQL. `clientName` proxies off the transaction
 * description (there is no dedicated customer table in V1).
 */
export type OverdueInvoice = {
  invoiceId: string;
  amount: string;
  clientName: string;
  daysOutstanding: number;
};

/**
 * Whether the aging schedule has any invoice past the {@link OVERDUE_AGE_DAYS}
 * grace window — i.e. any bucket other than `current` carries a non-zero total.
 * `parseFloat` is used for the non-empty comparison ONLY; the bucket totals remain
 * the original DECIMAL strings. This mirrors the per-invoice SQL filter
 * (`transaction_date < CURRENT_DATE - 30`) exactly.
 */
export function hasOverdueInvoices(schedule: ArAgingSchedule): boolean {
  const overdueBuckets: ArAgingBucket[] = ["1-30", "31-60", "61-90", "90+"];
  return overdueBuckets.some((bucket) => parseFloat(schedule.bucketTotals[bucket]) > 0);
}

/**
 * Severity for a collections-opportunity finding: `high` when the total past-due
 * amount is at or above {@link HIGH_SEVERITY_PAST_DUE_FLOOR}, otherwise `medium`.
 * `parseFloat` is a threshold comparison only — `totalPastDue` stays a DECIMAL
 * string everywhere it is persisted.
 */
export function severityForPastDue(totalPastDue: string): "medium" | "high" {
  return parseFloat(totalPastDue) >= HIGH_SEVERITY_PAST_DUE_FLOOR ? "high" : "medium";
}

/**
 * Fetch the individual overdue invoices (unreconciled income older than
 * {@link OVERDUE_AGE_DAYS} days) plus the SQL-summed total past due. The invoice
 * rows carry the per-invoice detail the `related_data` bag needs; the total is
 * summed in SQL (never by adding strings in JS) and drives severity.
 *
 * @param orgId Current org id. Both queries are org-scoped.
 */
async function fetchOverdueInvoices(
  orgId: string,
): Promise<{ invoices: OverdueInvoice[]; totalPastDue: string }> {
  const overdueFilter = and(
    eq(transactions.orgId, orgId),
    eq(transactions.transactionType, "income"),
    eq(transactions.isReconciled, false),
    sql`${transactions.transactionDate} < CURRENT_DATE - ${OVERDUE_AGE_DAYS}`,
  );

  const rows = await db
    .select({
      id: transactions.id,
      amount: transactions.amount,
      description: transactions.description,
      daysOutstanding: sql<number>`(CURRENT_DATE - ${transactions.transactionDate}::date)::int`,
    })
    .from(transactions)
    .where(overdueFilter)
    .orderBy(sql`(CURRENT_DATE - ${transactions.transactionDate}::date) DESC`);

  const [totalRow] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${transactions.amount}::numeric), 0)::numeric(15,2)::text`,
    })
    .from(transactions)
    .where(overdueFilter);

  const invoices: OverdueInvoice[] = rows.map((row) => ({
    invoiceId: row.id,
    amount: row.amount,
    // `description` proxies the client name; a null description falls back to a
    // stable placeholder so the agentic layer always has a non-null string.
    clientName: row.description ?? "Unknown customer",
    daysOutstanding: row.daysOutstanding,
  }));

  return { invoices, totalPastDue: totalRow?.total ?? "0.00" };
}

/**
 * Phrase (via two `getModel(0.5)` calls — headline + detail) and store a single
 * `collections_opportunity` finding. `expires_at` is always NULL: a collections
 * opportunity persists until the user dismisses or actions it (CLAUDE.md selective
 * expiry). `related_data` carries the per-invoice bag consumed by the Phase 9
 * agentic layer. On HTTP 429 the run is marked skipped and no finding is written;
 * any other error is rethrown.
 *
 * @param orgId Current org id.
 * @param intelligenceRunId The `intelligence_runs.id` this finding belongs to.
 */
export async function generateCollectionsOpportunityFinding(
  orgId: string,
  intelligenceRunId: string,
  input: {
    severity: "medium" | "high";
    totalPastDue: string;
    invoices: OverdueInvoice[];
  },
): Promise<FindingCreationResult> {
  const invoiceCount = input.invoices.length;
  const oldest = input.invoices.reduce(
    (max, inv) => (inv.daysOutstanding > max ? inv.daysOutstanding : max),
    0,
  );

  // Draft-level phrasing — default complexity routing (CLAUDE.md: no escalation to
  // a larger model without specific justification).
  const model = getModel(0.5);

  try {
    const { text: headline } = await generateText({
      model,
      prompt:
        `Write a single alert headline for a small-business finance dashboard. ` +
        `${invoiceCount} customer invoice(s) totalling $${input.totalPastDue} are past due, ` +
        `the oldest ${oldest} days outstanding. State there is an opportunity to collect ` +
        `outstanding receivables. Keep it under 110 characters. Return only the headline ` +
        `text, with no surrounding quotes and no preamble.`,
      maxTokens: 60,
    });

    const { text: detail } = await generateText({
      model,
      prompt:
        `Write 2-3 plain-English sentences for a small-business owner about overdue ` +
        `receivables. ${invoiceCount} invoice(s) totalling $${input.totalPastDue} are past ` +
        `due, the oldest ${oldest} days outstanding. Explain the cash-flow benefit of ` +
        `collecting them and suggest one concrete step to follow up. Do not give formal ` +
        `financial advice. Return only the explanation.`,
      maxTokens: 220,
    });

    await insertFindingDeduped({
      orgId,
      intelligenceRunId,
      findingType: "collections_opportunity",
      severity: input.severity,
      // Headline is VARCHAR(120) with a DB CHECK (length <= 120); hard-cap here so
      // an over-long model response can never violate the constraint.
      headline: headline.trim().slice(0, 120),
      detail: detail.trim(),
      status: "active",
      // collections_opportunity persists until dismissed or actioned.
      expiresAt: null,
      relatedData: {
        type: "collections_opportunity",
        totalPastDue: input.totalPastDue,
        invoices: input.invoices,
      },
    });

    return { status: "created" };
  } catch (err) {
    if (detectRateLimitError(err)) {
      await db
        .update(intelligenceRuns)
        .set({ status: "skipped", skippedReason: "rate_limit" })
        .where(eq(intelligenceRuns.id, intelligenceRunId));
      return { status: "skipped", reason: "rate_limit" };
    }
    throw err;
  }
}

/**
 * Step 6.5 — AR aging collections-opportunity analysis. This is the body of the
 * isolated `ar-aging-analysis` `step.run()` (never combined with any other
 * analysis type — CLAUDE.md). It builds the aging schedule to decide whether any
 * overdue invoice exists, and only then queries the per-invoice detail and writes
 * one `collections_opportunity` finding. A 429 during phrasing marks the run
 * skipped and returns `{ status: 'skipped' }` so the runner returns cleanly.
 *
 * @param orgId Current org id. Every underlying query is org-scoped.
 * @param intelligenceRunId The `intelligence_runs.id` this finding belongs to.
 */
export async function runArAgingAnalysis(
  orgId: string,
  intelligenceRunId: string,
): Promise<IntelligenceStepResult> {
  const schedule = await buildArAgingSchedule(orgId);
  if (!hasOverdueInvoices(schedule)) {
    return { status: "completed", findingsCreated: 0 };
  }

  const { invoices, totalPastDue } = await fetchOverdueInvoices(orgId);
  if (invoices.length === 0) {
    // Defensive: the schedule reported an overdue bucket but the detail query
    // returned nothing (data changed between queries). Nothing to report.
    return { status: "completed", findingsCreated: 0 };
  }

  const severity = severityForPastDue(totalPastDue);
  const result = await generateCollectionsOpportunityFinding(orgId, intelligenceRunId, {
    severity,
    totalPastDue,
    invoices,
  });

  if (result.status === "skipped") {
    return result;
  }

  return { status: "completed", findingsCreated: 1 };
}
