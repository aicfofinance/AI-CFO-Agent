import { NextResponse } from "next/server";

import { getRequestContext, RequestContextError } from "@/lib/platform/auth/session";
import { inngest } from "@/lib/inngest";

/** One day in milliseconds — used for last-day-of-prior-month calculation. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** Format a `Date` as a 'YYYY-MM-DD' string for a Postgres `date` column. */
function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * POST /api/reports/generate
 *
 * Requires session. Triggers report generation for the most recently completed
 * calendar month by dispatching a `report/generate.requested` Inngest event.
 * The per-org generator (`monthly-report-generate`) handles the actual work
 * asynchronously — this endpoint only enqueues the event and returns 201.
 *
 * Returns 401 if unauthenticated, 500 on unexpected error. The standard error
 * envelope is always used.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const request_id = crypto.randomUUID();

  try {
    const { orgId } = await getRequestContext(request);

    // Compute the prior calendar month date range in UTC.
    const now = new Date();
    const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const priorMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const priorMonthEnd = new Date(currentMonthStart.getTime() - DAY_MS);

    const periodStart = toYmd(priorMonthStart);
    const periodEnd = toYmd(priorMonthEnd);

    await inngest.send({
      name: "report/generate.requested",
      data: { orgId, periodStart, periodEnd, triggeredBy: "manual" },
    });

    return NextResponse.json(
      { data: { periodStart, periodEnd, message: "Report generation queued." } },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof RequestContextError) {
      console.error({ event: "reports_generate_auth_failed", code: error.code, request_id });
      return NextResponse.json(
        { error: { code: error.code, message: error.message, request_id } },
        { status: error.status },
      );
    }

    console.error({
      event: "reports_generate_failed",
      errorMessage: error instanceof Error ? error.message : String(error),
      request_id,
    });
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred.", request_id } },
      { status: 500 },
    );
  }
}
