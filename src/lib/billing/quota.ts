import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "@/lib/platform/db/schema";
import { subscriptions } from "@/lib/platform/db/schema";

/**
 * The Drizzle database handle this module operates on. It is the pooler-backed
 * `db` from `@/lib/platform/db/client` — passed in rather than imported so the
 * caller (the messages endpoint) owns the connection and this function stays
 * unit-testable with a mocked handle.
 */
type Database = PostgresJsDatabase<typeof schema>;

/**
 * Outcome of an atomic quota check-and-decrement.
 *
 * `queriesRemaining` is the count left AFTER this call consumes one query when
 * `allowed` is true, and `0` when the org is already at its limit. These are
 * integer counts, not monetary values, so plain arithmetic is correct here
 * (CLAUDE.md's "never do arithmetic in JS" rule governs DECIMAL money only).
 */
export type QuotaCheckResult = {
  allowed: boolean;
  queriesRemaining: number;
};

/**
 * Atomically checks and, if permitted, consumes one query from an org's billing
 * period quota.
 *
 * Concurrency is the whole point of this function: two questions submitted at
 * once must not both read `queriesUsed = 19` and both proceed. The read acquires
 * a `SELECT ... FOR UPDATE` row lock on the org's `subscriptions` row inside a
 * single `db.transaction()`, so a concurrent caller blocks until this
 * transaction commits and then observes the incremented count. The lock is
 * released when the transaction ends — whether it committed an increment or not.
 *
 * Behaviour:
 * - At or over limit (`queriesUsedThisPeriod >= queriesLimit`): returns
 *   `{ allowed: false, queriesRemaining: 0 }` and does NOT increment.
 * - Under limit: increments `queriesUsedThisPeriod` by one and returns
 *   `{ allowed: true, queriesRemaining: queriesLimit - queriesUsedThisPeriod - 1 }`.
 *
 * A missing subscription row is a data-integrity error (every org has exactly
 * one row, created atomically at org creation) and throws rather than silently
 * allowing an unmetered query.
 *
 * The org is always the caller's session org (sourced from
 * `getRequestContext()` upstream) — never user-supplied input.
 */
export async function checkAndIncrementQuota(
  orgId: string,
  db: Database,
): Promise<QuotaCheckResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        used: subscriptions.queriesUsedThisPeriod,
        limit: subscriptions.queriesLimit,
      })
      .from(subscriptions)
      .where(eq(subscriptions.orgId, orgId))
      .for("update")
      .limit(1);

    if (!row) {
      // Every org has exactly one subscription row (created atomically with the
      // org). A missing row means a broken invariant — fail loudly rather than
      // waving through an unmetered query.
      throw new Error(`No subscription row found for org ${orgId}.`);
    }

    if (row.used >= row.limit) {
      return { allowed: false, queriesRemaining: 0 };
    }

    await tx
      .update(subscriptions)
      .set({ queriesUsedThisPeriod: row.used + 1 })
      .where(eq(subscriptions.orgId, orgId));

    return { allowed: true, queriesRemaining: row.limit - row.used - 1 };
  });
}
