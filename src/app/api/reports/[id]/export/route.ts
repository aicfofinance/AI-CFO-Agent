import { and, eq } from "drizzle-orm";

import { getRequestContext, RequestContextError } from "@/lib/platform/auth/session";
import { db } from "@/lib/platform/db/client";
import { reports } from "@/lib/platform/db/schema";
import { formatCurrency, formatDate } from "@/lib/format";
import type { ReportContent } from "@/lib/ai/prompts/report";

/**
 * Safely cast the JSONB `content` column to `ReportContent`. Returns null if
 * the value is not an object (e.g. the report was marked ready without content,
 * which should not happen in normal flow but is guarded defensively).
 */
function parseContent(raw: unknown): ReportContent | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  // Minimal structural check — totalRevenue being a string is the key sentinel.
  if (typeof obj["totalRevenue"] !== "string") {
    return null;
  }
  return obj as unknown as ReportContent;
}

/**
 * GET /api/reports/:id/export
 *
 * Requires session. Returns the report as a plain-text file for download.
 * Returns 404 if the report is not found in the current org, or if its status
 * is not `ready`. Returns 401 if unauthenticated. The standard error envelope
 * is used for all error responses; the success response is `text/plain`.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const request_id = crypto.randomUUID();

  try {
    const { orgId } = await getRequestContext(request);
    const { id } = await params;

    const [report] = await db
      .select()
      .from(reports)
      .where(and(eq(reports.id, id), eq(reports.orgId, orgId)))
      .limit(1);

    if (!report || report.status !== "ready") {
      return Response.json(
        {
          error: {
            code: "REPORT_NOT_READY",
            message: "Report not found or not ready.",
            request_id,
          },
        },
        { status: 404 },
      );
    }

    const content = parseContent(report.content);
    const periodLabel = formatDate(report.periodStart, { format: "month-year" });
    const generatedDate = report.generatedAt
      ? formatDate(report.generatedAt, { format: "long" })
      : "unknown";

    // Build the plain-text body. formatCurrency handles all monetary display;
    // never write $${amount} inline (CLAUDE.md, Financial Data Rules).
    const revenue = content ? formatCurrency(content.totalRevenue) : "—";
    const expenses = content ? formatCurrency(content.totalExpenses) : "—";
    const netProfit = content ? formatCurrency(content.netProfit) : "—";
    const grossMargin =
      content?.grossMarginPct !== null && content?.grossMarginPct !== undefined
        ? `${content.grossMarginPct.toFixed(1)}%`
        : "—";

    const summary = report.plainTextSummary ?? "(No narrative generated.)";

    const text = [
      "CFO Lens — Monthly Report",
      periodLabel,
      `Generated: ${generatedDate}`,
      "",
      "FINANCIAL SUMMARY",
      `Revenue:      ${revenue}`,
      `Expenses:     ${expenses}`,
      `Net Profit:   ${netProfit}`,
      `Gross Margin: ${grossMargin}`,
      "",
      summary,
      "",
      "---",
      "This is AI-generated analysis. Not financial advice.",
    ].join("\n");

    return new Response(text, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="report-${report.periodStart}.txt"`,
      },
    });
  } catch (error) {
    if (error instanceof RequestContextError) {
      console.error({ event: "report_export_auth_failed", code: error.code, request_id });
      return Response.json(
        { error: { code: error.code, message: error.message, request_id } },
        { status: error.status },
      );
    }

    console.error({
      event: "report_export_failed",
      errorMessage: error instanceof Error ? error.message : String(error),
      request_id,
    });
    return Response.json(
      { error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred.", request_id } },
      { status: 500 },
    );
  }
}
