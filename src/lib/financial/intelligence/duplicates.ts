import { generateText } from "ai";
import { and, eq, isNotNull, sql } from "drizzle-orm";

import { detectRateLimitError, getModel } from "@/lib/ai/models/router";
import { db } from "@/lib/platform/db/client";
import { accounts, intelligenceRuns, transactions } from "@/lib/platform/db/schema";

import type { IntelligenceStepResult } from "./anomaly";
import { insertFindingDeduped } from "./findings-writer";

/**
 * Duplicate subscription scan (Step 6.6).
 *
 * Driven by the isolated `duplicate-subscription-scan` `step.run()` in
 * `jobs/intelligence/run.ts` — never combined with any other analysis type
 * (CLAUDE.md, Intelligence Engine Rules). Extends the recurring-expense idea from
 * Step 5.5: rather than a single vendor charging on a monthly cycle, this looks for
 * the SAME vendor being billed across TWO DIFFERENT expense accounts within the
 * same recent billing window with near-identical amounts — the signature of an
 * accidental double subscription.
 *
 * Detection is deterministic. The candidate charges are pulled in SQL (org-scoped,
 * joined to `accounts` for the account name), and the cross-account pairing is done
 * in a pure JS function ({@link findDuplicateSubscriptionPairs}) so it is unit
 * testable without a database. `parseFloat` is used ONLY for the within-10%
 * amount comparison — no monetary value is computed or stored (CLAUDE.md, Financial
 * Data Rules); the amounts stored in `related_data` are the original DECIMAL
 * strings.
 *
 * The AI (via `getModel(0.5)` — never a direct provider import) only phrases each
 * finding. Rate-limit guard: the two `generateText` calls plus the insert run
 * inside one try/catch. On HTTP 429 — detected via `detectRateLimitError()` — the
 * run is marked `status = 'skipped'`, `skipped_reason = 'rate_limit'` and the step
 * returns cleanly. It never rethrows a 429 and never fails over to a different
 * provider. Any non-429 error is rethrown.
 */

/** Amounts within this fraction of their mean are treated as the same charge. */
const AMOUNT_TOLERANCE = 0.1; // 10%
/**
 * How far back to look for a duplicate billing. A monthly subscription billed on
 * two accounts will produce a charge on each within one ~30-day cycle; a 35-day
 * window captures the 25–35 day cycle band from the Step 5.5 recurring-expense
 * detection without reaching back into a prior cycle.
 */
const RECENT_WINDOW_DAYS = 35;

/** The outcome of writing a single finding (internal to the step). */
type FindingCreationResult = { status: "created" } | { status: "skipped"; reason: "rate_limit" };

/** A candidate expense charge (one transaction) in the recent window. */
type DuplicateChargeRow = {
  id: string;
  description: string;
  amount: string;
  accountId: string;
  accountName: string;
};

/**
 * A detected duplicate subscription: the same vendor billed on two different
 * expense accounts with amounts within tolerance. Both amounts stay DECIMAL
 * strings. This is exactly the `related_data` bag stored on the finding.
 */
export type DuplicateSubscriptionPair = {
  vendorName: string;
  transaction1Id: string;
  transaction1Amount: string;
  account1Name: string;
  transaction2Id: string;
  transaction2Amount: string;
  account2Name: string;
};

/**
 * Whether two DECIMAL-string amounts are within {@link AMOUNT_TOLERANCE} of their
 * mean. `parseFloat` is used for the comparison ONLY — no value is computed or
 * stored. A non-positive mean cannot establish relative closeness, so it returns
 * `false`.
 */
export function amountsWithinTolerance(
  a: string,
  b: string,
  tolerance = AMOUNT_TOLERANCE,
): boolean {
  const x = parseFloat(a);
  const y = parseFloat(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return false;
  }
  const mean = (x + y) / 2;
  if (mean <= 0) {
    return false;
  }
  return Math.abs(x - y) / mean <= tolerance;
}

/**
 * Pure cross-account duplicate detector. Groups the candidate charges by vendor
 * (transaction description), and for each vendor returns the first pair of charges
 * that sit on DIFFERENT accounts with amounts within tolerance. At most one pair
 * per vendor is reported — a single finding per duplicated subscription is enough
 * to prompt the user to act.
 *
 * Deterministic and I/O-free, so it is unit tested in isolation.
 */
export function findDuplicateSubscriptionPairs(
  rows: DuplicateChargeRow[],
): DuplicateSubscriptionPair[] {
  const byVendor = new Map<string, DuplicateChargeRow[]>();
  for (const row of rows) {
    const group = byVendor.get(row.description);
    if (group) {
      group.push(row);
    } else {
      byVendor.set(row.description, [row]);
    }
  }

  const pairs: DuplicateSubscriptionPair[] = [];

  for (const [vendorName, charges] of byVendor) {
    let matched = false;
    for (let i = 0; i < charges.length && !matched; i += 1) {
      for (let j = i + 1; j < charges.length && !matched; j += 1) {
        const a = charges[i];
        const b = charges[j];
        if (a === undefined || b === undefined) {
          continue;
        }
        // Same account is not a duplicate subscription — that is an ordinary
        // recurring charge, handled by Step 5.5 recurring-expense detection.
        if (a.accountId === b.accountId) {
          continue;
        }
        if (!amountsWithinTolerance(a.amount, b.amount)) {
          continue;
        }
        pairs.push({
          vendorName,
          transaction1Id: a.id,
          transaction1Amount: a.amount,
          account1Name: a.accountName,
          transaction2Id: b.id,
          transaction2Amount: b.amount,
          account2Name: b.accountName,
        });
        matched = true;
      }
    }
  }

  return pairs;
}

/**
 * Pull the recent expense charges (last {@link RECENT_WINDOW_DAYS} days) that
 * carry both a description and an account, joined to `accounts` for the account
 * name. Org-scoped. Rows with a null description or account are filtered out (the
 * join already excludes null accounts; the isNotNull filter excludes null
 * descriptions) so the returned shape is fully non-null.
 *
 * @param orgId Current org id. The query is org-scoped.
 */
async function fetchRecentExpenseCharges(orgId: string): Promise<DuplicateChargeRow[]> {
  const rows = await db
    .select({
      id: transactions.id,
      description: transactions.description,
      amount: transactions.amount,
      accountId: transactions.accountId,
      accountName: accounts.name,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(
      and(
        eq(transactions.orgId, orgId),
        eq(transactions.transactionType, "expense"),
        isNotNull(transactions.description),
        sql`${transactions.transactionDate} >= CURRENT_DATE - ${sql.raw(String(RECENT_WINDOW_DAYS))}`,
      ),
    )
    .orderBy(transactions.description);

  const result: DuplicateChargeRow[] = [];
  for (const row of rows) {
    // Defensive narrowing: the query already excludes null description/account,
    // but the column types are nullable so we narrow explicitly.
    if (row.description === null || row.accountId === null) {
      continue;
    }
    result.push({
      id: row.id,
      description: row.description,
      amount: row.amount,
      accountId: row.accountId,
      accountName: row.accountName,
    });
  }
  return result;
}

/**
 * Phrase (via two `getModel(0.5)` calls — headline + detail) and store a single
 * `duplicate_subscription` finding. Severity is always `medium` (Step 6.6);
 * `expires_at` is always NULL — a duplicate subscription persists until the user
 * dismisses or actions it (CLAUDE.md selective expiry). `related_data` carries the
 * pair detail consumed by the Phase 9 agentic layer to pre-populate a cancellation
 * draft. On HTTP 429 the run is marked skipped and no finding is written; any other
 * error is rethrown.
 *
 * @param orgId Current org id.
 * @param intelligenceRunId The `intelligence_runs.id` this finding belongs to.
 * @param pair The detected duplicate pair.
 */
export async function generateDuplicateSubscriptionFinding(
  orgId: string,
  intelligenceRunId: string,
  pair: DuplicateSubscriptionPair,
): Promise<FindingCreationResult> {
  // Draft-level phrasing — default complexity routing (CLAUDE.md: no escalation to
  // a larger model without specific justification).
  const model = getModel(0.5);

  try {
    // Single call combining headline and detail to stay within free-tier rate limits.
    const { text: combined } = await generateText({
      model,
      prompt:
        `Write a single alert headline for a small-business finance dashboard. ` +
        `The vendor "${pair.vendorName}" appears to be billed on two different accounts ` +
        `("${pair.account1Name}" for $${pair.transaction1Amount} and "${pair.account2Name}" ` +
        `for $${pair.transaction2Amount}), suggesting a duplicate subscription. State that ` +
        `a possible duplicate charge was found. Keep it under 110 characters. Return only ` +
        `the headline text, with no surrounding quotes and no preamble.` +
        "\n\nThen on a new line write a 2-3 sentence explanation:\n" +
        `Write 2-3 plain-English sentences for a small-business owner about a possible ` +
        `duplicate subscription. The vendor "${pair.vendorName}" was charged on two ` +
        `different accounts — "${pair.account1Name}" for $${pair.transaction1Amount} and ` +
        `"${pair.account2Name}" for $${pair.transaction2Amount}. Explain that this may be a ` +
        `duplicate payment and suggest one concrete step to verify and cancel the extra ` +
        `subscription. Do not give formal financial advice. Return only the explanation.` +
        "\n\nRespond with exactly two labeled lines:\nHEADLINE: <alert headline, max 110 chars>\nDETAIL: <2-3 sentence explanation>",
      maxTokens: 320,
    });
    const headlineMatch = /^HEADLINE:\s*(.+)/m.exec(combined);
    const detailMatch = /^DETAIL:\s*([\s\S]+)/m.exec(combined);
    const fallbackLines = combined
      .trim()
      .split("\n")
      .filter((l) => l.trim().length > 0);
    const headline = (headlineMatch?.[1] ?? fallbackLines[0] ?? "").trim().slice(0, 120);
    const detail = (detailMatch?.[1] ?? fallbackLines.slice(1).join(" ") ?? headline).trim();

    await insertFindingDeduped({
      orgId,
      intelligenceRunId,
      findingType: "duplicate_subscription",
      severity: "medium",
      // Headline is VARCHAR(120) with a DB CHECK (length <= 120); hard-cap here so
      // an over-long model response can never violate the constraint.
      headline: headline.trim().slice(0, 120),
      detail: detail.trim(),
      status: "active",
      // duplicate_subscription persists until dismissed or actioned.
      expiresAt: null,
      relatedData: {
        type: "duplicate_subscription",
        vendorName: pair.vendorName,
        transaction1Id: pair.transaction1Id,
        transaction1Amount: pair.transaction1Amount,
        account1Name: pair.account1Name,
        transaction2Id: pair.transaction2Id,
        transaction2Amount: pair.transaction2Amount,
        account2Name: pair.account2Name,
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
 * Step 6.6 — duplicate subscription scan. This is the body of the isolated
 * `duplicate-subscription-scan` `step.run()` (never combined with any other
 * analysis type — CLAUDE.md). It pulls the recent expense charges, finds
 * cross-account duplicate pairs, and writes one `duplicate_subscription` finding
 * per pair. A 429 during phrasing marks the run skipped and returns
 * `{ status: 'skipped' }` immediately so the runner returns cleanly.
 *
 * @param orgId Current org id. Every underlying query is org-scoped.
 * @param intelligenceRunId The `intelligence_runs.id` these findings belong to.
 */
export async function runDuplicateSubscriptionScan(
  orgId: string,
  intelligenceRunId: string,
): Promise<IntelligenceStepResult> {
  const charges = await fetchRecentExpenseCharges(orgId);
  const pairs = findDuplicateSubscriptionPairs(charges);

  let findingsCreated = 0;
  for (const pair of pairs) {
    const result = await generateDuplicateSubscriptionFinding(orgId, intelligenceRunId, pair);
    if (result.status === "skipped") {
      return result;
    }
    findingsCreated += 1;
  }

  return { status: "completed", findingsCreated };
}
