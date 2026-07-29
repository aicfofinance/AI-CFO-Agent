import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/platform/db/client";
import { accounts, transactions } from "@/lib/platform/db/schema";

/**
 * Cash-position and accounts-receivable helpers.
 *
 * Both figures derive from DECIMAL(15,2) columns that Drizzle serialises to JS
 * strings. They stay strings across the entire call — no `parseFloat`, no JS
 * arithmetic — because IEEE-754 floats cannot represent decimal money exactly
 * (CLAUDE.md, Financial Data Rules). Every SUM runs in SQL over `::numeric`
 * casts so the arithmetic is exact, and `::text` returns the result as a string
 * so no float ever touches JavaScript.
 *
 * Both queries are org-scoped with `WHERE org_id = orgId`; the id is always
 * sourced from the caller's `getRequestContext()`, never from user input.
 */

/**
 * Current cash position: the sum of `current_balance` across all active asset
 * accounts for the org.
 *
 * `current_balance` is nullable, so the SUM ignores NULL balances naturally and
 * `COALESCE(..., 0)` yields `'0'` when the org has no matching accounts. Scoped
 * to `account_type = 'asset'` AND `is_active = true` (served by
 * `idx_accounts_org_type`).
 *
 * @param orgId Current org id from `getRequestContext()`.
 * @returns The summed balance as a DECIMAL string (e.g. `"12500.00"`).
 */
export async function getCashPosition(orgId: string): Promise<string> {
  const [row] = await db
    .select({
      cashPosition: sql<string>`COALESCE(SUM(${accounts.currentBalance}::numeric), 0)::text`,
    })
    .from(accounts)
    .where(
      and(
        eq(accounts.orgId, orgId),
        eq(accounts.accountType, "asset"),
        eq(accounts.isActive, true),
      ),
    );

  return row?.cashPosition ?? "0";
}

/**
 * Approximate outstanding accounts-receivable balance: the sum of `amount`
 * across income transactions that have not yet been reconciled.
 *
 * Unreconciled income is used as a V1 proxy for outstanding AR — an invoice
 * that has been recorded as income but not yet cleared against a bank deposit.
 * Scoped to `transaction_type = 'income'` AND `is_reconciled = false`.
 *
 * @param orgId Current org id from `getRequestContext()`.
 * @returns The summed balance as a DECIMAL string.
 */
export async function getArBalance(orgId: string): Promise<string> {
  const [row] = await db
    .select({
      arBalance: sql<string>`COALESCE(SUM(${transactions.amount}::numeric), 0)::text`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.orgId, orgId),
        eq(transactions.transactionType, "income"),
        eq(transactions.isReconciled, false),
      ),
    );

  return row?.arBalance ?? "0";
}
