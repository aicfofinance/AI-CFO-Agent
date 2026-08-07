import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { getRequestContext, RequestContextError } from "@/lib/platform/auth/session";
import { db } from "@/lib/platform/db/client";
import { reports } from "@/lib/platform/db/schema";

/**
 * GET /api/reports/:id
 *
 * Requires session. Returns the full report row including `content` (JSONB
 * metrics) and `plainTextSummary` (AI narrative). The query filters by both
 * `id` and `orgId` so a resource belonging to another org returns 404 (the
 * org filter makes the row invisible — the caller cannot infer whether the
 * id exists in another org's scope).
 *
 * Returns 401 if unauthenticated, 404 if not found in the current org, 500
 * on unexpected error. The standard error envelope is always used.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const request_id = crypto.randomUUID();

  try {
    const { orgId } = await getRequestContext(request);
    const { id } = await params;

    const [report] = await db
      .select()
      .from(reports)
      .where(and(eq(reports.id, id), eq(reports.orgId, orgId)))
      .limit(1);

    if (!report) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Report not found.", request_id } },
        { status: 404 },
      );
    }

    return NextResponse.json(
      {
        data: {
          id: report.id,
          reportType: report.reportType,
          periodStart: report.periodStart,
          periodEnd: report.periodEnd,
          status: report.status,
          generatedAt: report.generatedAt ? report.generatedAt.toISOString() : null,
          generationError: report.generationError,
          content: report.content,
          plainTextSummary: report.plainTextSummary,
          modelUsed: report.modelUsed,
          tokensUsed: report.tokensUsed,
          createdAt: report.createdAt.toISOString(),
        },
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof RequestContextError) {
      console.error({ event: "report_get_auth_failed", code: error.code, request_id });
      return NextResponse.json(
        { error: { code: error.code, message: error.message, request_id } },
        { status: error.status },
      );
    }

    console.error({
      event: "report_get_failed",
      errorMessage: error instanceof Error ? error.message : String(error),
      request_id,
    });
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred.", request_id } },
      { status: 500 },
    );
  }
}
