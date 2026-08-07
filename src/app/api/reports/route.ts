import { NextResponse } from "next/server";
import { desc, eq, sql } from "drizzle-orm";

import { getRequestContext, RequestContextError } from "@/lib/platform/auth/session";
import { db } from "@/lib/platform/db/client";
import { reports } from "@/lib/platform/db/schema";
import { formatDate } from "@/lib/format";

/**
 * One report row as returned in the reports list. `periodLabel` is derived
 * server-side from `periodStart`. `hasContent` tells the UI whether the
 * `content` JSONB is populated (i.e. the report has metrics data). Monetary
 * values in `content` are DECIMAL strings — they are never surfaced here
 * (use `GET /api/reports/:id` for full content).
 */
type ReportSummary = {
  id: string;
  reportType: string;
  periodStart: string;
  periodEnd: string;
  /** Human-readable label, e.g. "July 2026". Derived from `periodStart`. */
  periodLabel: string;
  status: string;
  generatedAt: string | null;
  hasContent: boolean;
  createdAt: string;
};

/** Maximum reports returned — 24 covers 2 years of monthly reports. */
const REPORT_LIST_LIMIT = 24;

/**
 * GET /api/reports
 *
 * Requires session. Returns 401 if unauthenticated. Returns the org's reports
 * list under the standard `{ data, meta }` envelope. Reports are ordered by
 * `period_start DESC` (most recent first); no cursor pagination is needed
 * because an org will have at most 24 rows at the 2-year cap.
 *
 * The org filter is always sourced from `getRequestContext()` — never from
 * user input (CLAUDE.md, Multi-tenancy Rules).
 */
export async function GET(request: Request): Promise<NextResponse> {
  const request_id = crypto.randomUUID();

  try {
    const { orgId } = await getRequestContext(request);

    const rows = await db
      .select({
        id: reports.id,
        reportType: reports.reportType,
        periodStart: reports.periodStart,
        periodEnd: reports.periodEnd,
        status: reports.status,
        generatedAt: reports.generatedAt,
        content: reports.content,
        createdAt: reports.createdAt,
      })
      .from(reports)
      .where(eq(reports.orgId, orgId))
      .orderBy(desc(reports.periodStart))
      .limit(REPORT_LIST_LIMIT);

    // Total count (may exceed the page limit for long-running orgs)
    const [countRow] = await db
      .select({ total: sql<number>`COUNT(*)::int` })
      .from(reports)
      .where(eq(reports.orgId, orgId));

    const total = countRow?.total ?? 0;

    const data: ReportSummary[] = rows.map((row) => ({
      id: row.id,
      reportType: row.reportType,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      periodLabel: formatDate(row.periodStart, { format: "month-year" }),
      status: row.status,
      generatedAt: row.generatedAt ? row.generatedAt.toISOString() : null,
      hasContent: row.content !== null,
      createdAt: row.createdAt.toISOString(),
    }));

    return NextResponse.json({ data, meta: { total } }, { status: 200 });
  } catch (error) {
    if (error instanceof RequestContextError) {
      console.error({ event: "reports_list_auth_failed", code: error.code, request_id });
      return NextResponse.json(
        { error: { code: error.code, message: error.message, request_id } },
        { status: error.status },
      );
    }

    console.error({
      event: "reports_list_failed",
      errorMessage: error instanceof Error ? error.message : String(error),
      request_id,
    });
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred.", request_id } },
      { status: 500 },
    );
  }
}
