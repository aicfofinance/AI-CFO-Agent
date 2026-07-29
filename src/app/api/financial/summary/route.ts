import { NextResponse } from "next/server";

import { getExpensesByCategory } from "@/lib/financial/aggregations/categories";
import { getMonthlyRevenueTrend } from "@/lib/financial/aggregations/trends";
import { getCashPosition } from "@/lib/financial/calculations/cash-flow";
import { calculatePnL } from "@/lib/financial/calculations/pnl";
import { getRequestContext, RequestContextError } from "@/lib/platform/auth/session";
import type { FinancialSummaryResponse } from "@/types/api";

/**
 * GET /api/financial/summary
 *
 * Requires session. Returns 401 if unauthenticated, 403 if the user has no org
 * membership, 500 if org/subscription context is missing or an unexpected error
 * occurs.
 *
 * Returns the dashboard financial summary for the caller's org: current-month
 * P&L, cash position, top five expense categories, and a seven-month revenue
 * trend. The org filter is always sourced from `getRequestContext()` — never
 * from user input (CLAUDE.md, Multi-tenancy Rules).
 *
 * All four aggregations are dispatched concurrently with `Promise.all` to keep
 * the handler under the < 500ms target. Every monetary value stays a DECIMAL
 * string end-to-end; no monetary arithmetic happens in JavaScript.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const request_id = crypto.randomUUID();

  try {
    const { orgId } = await getRequestContext(request);

    // Current month boundaries in UTC: first day of the month through today,
    // formatted as `YYYY-MM-DD` to match the DATE-typed `transaction_date`
    // column the calculation functions query against.
    const now = new Date();
    const periodStart = formatIsoDate(
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    );
    const periodEnd = formatIsoDate(now);

    const [currentMonth, cashPosition, expenseCategories, revenueTrend] = await Promise.all([
      calculatePnL(orgId, periodStart, periodEnd),
      getCashPosition(orgId),
      getExpensesByCategory(orgId, periodStart, periodEnd),
      getMonthlyRevenueTrend(orgId, 7),
    ]);

    const data: FinancialSummaryResponse = {
      currentMonth,
      cashPosition,
      topExpenseCategories: expenseCategories.slice(0, 5),
      revenueTrend,
      generatedAt: new Date().toISOString(),
    };

    return NextResponse.json({ data }, { status: 200 });
  } catch (error) {
    if (error instanceof RequestContextError) {
      console.error({ event: "financial_summary_auth_failed", code: error.code, request_id });
      return NextResponse.json(
        { error: { code: error.code, message: error.message, request_id } },
        { status: error.status },
      );
    }

    console.error({
      event: "financial_summary_failed",
      errorMessage: error instanceof Error ? error.message : String(error),
      request_id,
    });
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred.",
          request_id,
        },
      },
      { status: 500 },
    );
  }
}

/**
 * Formats a UTC date as `YYYY-MM-DD`.
 */
function formatIsoDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
