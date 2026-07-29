import { NextResponse } from "next/server";
import { z, ZodError } from "zod";

import {
  buildCashFlowProjection,
  getTransactionHistoryDays,
  storeCashFlowProjection,
  type CashFlowProjectionResponse,
  type ProjectionPeriodDays,
} from "@/lib/financial/intelligence/cash-flow";
import { getRequestContext, RequestContextError } from "@/lib/platform/auth/session";

/** Minimum transaction history required to compute a projection (CLAUDE.md). */
const MIN_HISTORY_DAYS = 60;

/**
 * The `days` query param: 30, 60, or 90, defaulting to 30. Parsed from the raw
 * string with a Zod enum so an out-of-range value throws a `ZodError` the
 * handler translates into a 400, rather than silently coercing to a default.
 */
const DaysSchema = z.enum(["30", "60", "90"]).default("30");

/**
 * GET /api/cashflow/projection?days=30|60|90
 *
 * Requires session. Returns 401 if unauthenticated, 403 if the user has no org
 * membership, 400 if `days` is not one of 30/60/90, 422 if the org has fewer
 * than 60 days of transaction history, 500 on unexpected error.
 *
 * On success returns the org's forward-looking cash-flow projection under the
 * standard `{ data: T }` envelope: the daily projected balances, the minimum
 * projected balance, the first date the balance is projected to go negative (or
 * null), and the confidence level — which is always present (CLAUDE.md: a
 * projection is never returned without one). The projection is also persisted to
 * `cash_flow_projections` (one row per org per period per day).
 *
 * The org filter is always sourced from `getRequestContext()` — never from user
 * input (CLAUDE.md, Multi-tenancy Rules).
 */
export async function GET(request: Request): Promise<NextResponse> {
  const request_id = crypto.randomUUID();

  try {
    const { orgId } = await getRequestContext(request);

    // Guard: below the 60-day floor there is not enough history to project.
    // Return the structured 422 so the frontend can render the progress state.
    const daysAvailable = await getTransactionHistoryDays(orgId);
    if (daysAvailable < MIN_HISTORY_DAYS) {
      return NextResponse.json(
        {
          error: {
            code: "INSUFFICIENT_DATA",
            message: "At least 60 days of transaction data is required for cash flow projection.",
            details: { daysAvailable, daysRequired: MIN_HISTORY_DAYS },
            request_id,
          },
        },
        { status: 422 },
      );
    }

    const rawDays = new URL(request.url).searchParams.get("days") ?? undefined;
    const periodDays = Number(DaysSchema.parse(rawDays)) as ProjectionPeriodDays;

    const projection = await buildCashFlowProjection(orgId, periodDays);
    await storeCashFlowProjection(orgId, projection);

    const data: CashFlowProjectionResponse = {
      projectedData: projection.projectedDays,
      minimumProjectedBalance: projection.minimumProjectedBalance,
      riskDate: projection.riskDate,
      confidenceLevel: projection.confidenceLevel,
      generatedAt: projection.generatedAt,
    };

    return NextResponse.json({ data }, { status: 200 });
  } catch (error) {
    if (error instanceof RequestContextError) {
      console.error({ event: "cashflow_projection_auth_failed", code: error.code, request_id });
      return NextResponse.json(
        { error: { code: error.code, message: error.message, request_id } },
        { status: error.status },
      );
    }

    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Query parameter 'days' must be one of 30, 60, or 90.",
            details: error.issues,
            request_id,
          },
        },
        { status: 400 },
      );
    }

    console.error({
      event: "cashflow_projection_failed",
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
