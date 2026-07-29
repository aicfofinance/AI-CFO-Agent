import { and, eq, sql, type InferInsertModel } from "drizzle-orm";

import { db } from "@/lib/platform/db/client";
import { findings } from "@/lib/platform/db/schema";

/**
 * Shared finding-storage helper (Step 6.7).
 *
 * Every intelligence analysis step (cash flow risk, anomaly, collections
 * opportunity, duplicate subscription, margin alert) writes its findings through
 * this one function so same-day deduplication is enforced in a single place.
 *
 * Deduplication rule: a finding is skipped when a row with the same `org_id` and
 * `finding_type` already exists from the SAME CALENDAR DAY. This makes the
 * nightly run idempotent — a manual re-run or a duplicate cron dispatch on the
 * same day never produces a second copy of a condition that was already surfaced.
 * A persisting condition still produces a fresh finding on the NEXT day's run,
 * which is the intended behaviour (a finding is per-run, not perpetual).
 *
 * The date comparison uses `${findings.createdAt}::date = CURRENT_DATE`; Drizzle
 * has no built-in date-cast helper, so the cast is expressed with a `sql` tagged
 * template — the same construct already used by `storeCashFlowProjection`.
 *
 * Selective `expires_at` is the CALLER's responsibility (CLAUDE.md selective
 * expiry): `cash_flow_risk` passes the projected risk date, every other type
 * passes `null`. This function persists whatever `values` carries unchanged — it
 * does not impose any expiry policy of its own.
 *
 * @param values A full `findings` insert row (org-scoped — `orgId` is required by
 *   `InferInsertModel`, so a caller cannot forget it).
 * @returns `true` when the finding was inserted, `false` when it was skipped as a
 *   same-day duplicate.
 */
export async function insertFindingDeduped(
  values: InferInsertModel<typeof findings>,
): Promise<boolean> {
  const [existing] = await db
    .select({ id: findings.id })
    .from(findings)
    .where(
      and(
        eq(findings.orgId, values.orgId),
        eq(findings.findingType, values.findingType),
        sql`${findings.createdAt}::date = CURRENT_DATE`,
      ),
    )
    .limit(1);

  if (existing) {
    return false;
  }

  await db.insert(findings).values(values);
  return true;
}
