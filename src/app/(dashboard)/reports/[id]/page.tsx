import { redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";

import { env } from "@/lib/env";
import { formatCurrency } from "@/lib/format";
import type { ReportContent } from "@/lib/ai/prompts/report";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ReportDetail = {
  id: string;
  reportType: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  generatedAt: string | null;
  generationError: string | null;
  content: ReportContent | null;
  plainTextSummary: string | null;
  modelUsed: string | null;
  tokensUsed: number | null;
  createdAt: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a YYYY-MM-DD string as "July 2026" */
function periodLabel(dateStr: string): string {
  const [year, month] = dateStr.split("-");
  if (!year || !month) return dateStr;
  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

/** Format a decimal string as a percentage, e.g. 42.3 → "42.3%" */
function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// Page — Server Component
// ---------------------------------------------------------------------------

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;

  const requestHeaders = await headers();
  const cookie = requestHeaders.get("cookie") ?? "";
  const host = requestHeaders.get("host");
  const proto = requestHeaders.get("x-forwarded-proto") ?? "https";
  const baseUrl = host
    ? `${proto}://${host}`
    : (env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000");

  const res = await fetch(`${baseUrl}/api/reports/${id}`, {
    headers: { cookie },
    cache: "no-store",
  });

  if (res.status === 401) {
    redirect("/login");
  }

  if (res.status === 404) {
    return (
      <div className="flex flex-col gap-6">
        <div className="border-b border-[var(--border-default)] pb-6">
          <Link
            href="/reports"
            className="mb-4 inline-flex items-center gap-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            ← Back to Reports
          </Link>
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Report not found</h1>
        </div>
        <p className="text-sm text-[var(--text-secondary)]">
          This report does not exist or belongs to a different organisation.
        </p>
      </div>
    );
  }

  if (!res.ok) {
    return (
      <div role="alert" className="py-12 text-center text-sm text-[var(--text-secondary)]">
        Something went wrong loading this report.
      </div>
    );
  }

  const json = (await res.json()) as { data: ReportDetail } | { error: unknown };

  if ("error" in json) {
    return (
      <div role="alert" className="py-12 text-center text-sm text-[var(--text-secondary)]">
        Something went wrong loading this report.
      </div>
    );
  }

  const report = json.data;
  const label = periodLabel(report.periodStart);
  const content = report.content;

  return (
    <div className="flex flex-col gap-8">
      {/* ── Header ── */}
      <div className="border-b border-[var(--border-default)] pb-6">
        <Link
          href="/reports"
          className="mb-3 inline-flex items-center gap-1 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          ← Back to Reports
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--text-primary)]">{label}</h1>
            {report.generatedAt !== null && (
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                Generated{" "}
                {new Date(report.generatedAt).toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            )}
          </div>
          <a
            href={`/api/reports/${report.id}/export`}
            className="inline-flex items-center rounded border border-[var(--border-default)] px-3 py-1.5 text-sm text-[var(--text-secondary)] transition-colors duration-100 hover:border-[var(--primary-300)] hover:text-[var(--primary-600)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary-500)]"
          >
            Export .txt
          </a>
        </div>
      </div>

      {/* ── Report not ready ── */}
      {report.status !== "ready" && (
        <div
          className="rounded-md border border-[var(--warning-200)] bg-[var(--warning-50)] px-5 py-4 text-sm text-[var(--warning-700)]"
          role="alert"
        >
          {report.status === "generating"
            ? "This report is still being generated. Refresh in a moment."
            : report.status === "failed"
              ? `Report generation failed${report.generationError ? `: ${report.generationError}` : ". Please try again."}`
              : "Report is pending generation."}
        </div>
      )}

      {/* ── Financial summary metrics ── */}
      {content !== null && (
        <section aria-labelledby="metrics-heading">
          <h2
            id="metrics-heading"
            className="mb-4 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]"
          >
            Financial Summary
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {/* Revenue */}
            <div className="rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] p-4">
              <p className="text-xs text-[var(--text-muted)]">Revenue</p>
              <p className="mt-1 text-lg font-semibold text-[var(--gain-600)]">
                {formatCurrency(content.totalRevenue)}
              </p>
              {content.momRevenuePct !== null && (
                <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                  {fmtPct(content.momRevenuePct)} MoM
                </p>
              )}
            </div>
            {/* Expenses */}
            <div className="rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] p-4">
              <p className="text-xs text-[var(--text-muted)]">Expenses</p>
              <p className="mt-1 text-lg font-semibold text-[var(--text-primary)]">
                {formatCurrency(content.totalExpenses)}
              </p>
              {content.momExpensesPct !== null && (
                <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                  {fmtPct(content.momExpensesPct)} MoM
                </p>
              )}
            </div>
            {/* Net Profit */}
            <div className="rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] p-4">
              <p className="text-xs text-[var(--text-muted)]">Net Profit</p>
              <p
                className={`mt-1 text-lg font-semibold ${
                  parseFloat(content.netProfit) >= 0
                    ? "text-[var(--gain-600)]"
                    : "text-[var(--loss-600)]"
                }`}
              >
                {formatCurrency(content.netProfit)}
              </p>
              {content.momNetProfitPct !== null && (
                <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                  {fmtPct(content.momNetProfitPct)} MoM
                </p>
              )}
            </div>
            {/* Gross Margin */}
            <div className="rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] p-4">
              <p className="text-xs text-[var(--text-muted)]">Gross Margin</p>
              <p
                className={`mt-1 text-lg font-semibold ${
                  content.grossMarginPct !== null && content.grossMarginPct >= 0
                    ? "text-[var(--gain-600)]"
                    : "text-[var(--loss-600)]"
                }`}
              >
                {content.grossMarginPct !== null ? `${content.grossMarginPct.toFixed(1)}%` : "—"}
              </p>
            </div>
          </div>
        </section>
      )}

      {/* ── Top expense categories ── */}
      {content !== null && content.topExpenseCategories.length > 0 && (
        <section aria-labelledby="expenses-heading">
          <h2
            id="expenses-heading"
            className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]"
          >
            Top Expense Categories
          </h2>
          <div className="rounded-md border border-[var(--border-default)] bg-[var(--surface-card)]">
            {content.topExpenseCategories.map((cat, i) => (
              <div
                key={cat.category}
                className={`flex items-center justify-between px-4 py-3 ${
                  i < content.topExpenseCategories.length - 1
                    ? "border-b border-[var(--border-subtle)]"
                    : ""
                }`}
              >
                <span className="text-sm text-[var(--text-primary)]">{cat.category}</span>
                <span className="font-numeric text-sm text-[var(--text-secondary)]">
                  {formatCurrency(cat.amount)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── AI narrative ── */}
      {report.plainTextSummary !== null && report.status === "ready" && (
        <section aria-labelledby="narrative-heading">
          <h2
            id="narrative-heading"
            className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]"
          >
            AI Analysis
          </h2>
          <div className="rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] p-6">
            {/* Render each paragraph separately */}
            {report.plainTextSummary
              .split("\n\n")
              .filter((p) => p.trim().length > 0)
              .map((paragraph, i) => (
                <p
                  key={i}
                  className="mt-4 first:mt-0 text-sm leading-relaxed text-[var(--text-secondary)]"
                >
                  {paragraph.trim()}
                </p>
              ))}
          </div>
        </section>
      )}

      {/* ── Ask AI CTA ── */}
      {report.status === "ready" && (
        <div className="rounded-md border border-[var(--primary-200)] bg-[var(--primary-50)] px-5 py-4">
          <p className="text-sm font-medium text-[var(--primary-800)]">
            Want to explore this report further?
          </p>
          <p className="mt-1 text-sm text-[var(--primary-700)]">
            Ask the AI any question about {label}'s financial performance.
          </p>
          <Link
            href={`/ask`}
            className="mt-3 inline-flex items-center rounded bg-[var(--primary-500)] px-3 py-1.5 text-sm font-medium text-white transition-colors duration-100 hover:bg-[var(--primary-600)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary-500)]"
          >
            Ask a question →
          </Link>
        </div>
      )}
    </div>
  );
}
