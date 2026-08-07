import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { FileText } from "lucide-react";
import type { ReactElement } from "react";

import { env } from "@/lib/env";
import { GenerateReportButton } from "./GenerateReportButton";

// ---------------------------------------------------------------------------
// Types — defined inline; the reports endpoint type is not yet in src/types/api.ts
// ---------------------------------------------------------------------------

type ReportSummary = {
  id: string;
  reportType: string;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  status: string;
  generatedAt: string | null;
  hasContent: boolean;
  createdAt: string;
};

type ReportsApiResponse = {
  data: ReportSummary[];
  meta: { total: number };
};

// ---------------------------------------------------------------------------
// Status badge helper
// ---------------------------------------------------------------------------

type StatusConfig = {
  label: string;
  className: string;
};

const STATUS_CONFIG: Record<string, StatusConfig> = {
  ready: {
    label: "Ready",
    className:
      "inline-flex items-center rounded-full bg-[var(--gain-100)] px-2 py-0.5 text-xs font-medium text-[var(--gain-700)]",
  },
  generating: {
    label: "Generating…",
    className:
      "inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700",
  },
  failed: {
    label: "Failed",
    className:
      "inline-flex items-center rounded-full bg-[var(--loss-100)] px-2 py-0.5 text-xs font-medium text-[var(--loss-700)]",
  },
  pending: {
    label: "Pending",
    className:
      "inline-flex items-center rounded-full bg-[var(--gray-100)] px-2 py-0.5 text-xs font-medium text-[var(--text-muted)]",
  },
};

function StatusBadge({ status }: { status: string }): ReactElement {
  const config: StatusConfig = STATUS_CONFIG[status] ?? {
    label: status,
    className:
      "inline-flex items-center rounded-full bg-[var(--gray-100)] px-2 py-0.5 text-xs font-medium text-[var(--text-muted)]",
  };
  return <span className={config.className}>{config.label}</span>;
}

// ---------------------------------------------------------------------------
// Page — Server Component (no "use client")
// ---------------------------------------------------------------------------

export default async function ReportsPage(): Promise<ReactElement> {
  const requestHeaders = await headers();
  const cookie = requestHeaders.get("cookie") ?? "";
  const host = requestHeaders.get("host");
  const proto = requestHeaders.get("x-forwarded-proto") ?? "https";
  const baseUrl = host
    ? `${proto}://${host}`
    : (env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000");

  const res = await fetch(`${baseUrl}/api/reports`, {
    headers: { cookie },
    cache: "no-store",
  });

  // 401: session absent or expired — redirect to login
  if (res.status === 401) {
    redirect("/login");
  }

  const pageHeader = (
    <div className="border-b border-[var(--border-default)] pb-6">
      <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Reports</h1>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">
        Monthly financial summaries of your business performance.
      </p>
    </div>
  );

  // Any non-OK status other than 401 — show error state
  if (!res.ok) {
    return (
      <div className="flex flex-col gap-6">
        {pageHeader}
        <div
          role="alert"
          className="rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] px-5 py-4 text-sm text-[var(--text-secondary)]"
        >
          Unable to load reports. Refresh to try again.
        </div>
      </div>
    );
  }

  const json = (await res.json()) as ReportsApiResponse;
  const reportList = json.data ?? [];

  // Empty state — no reports generated yet
  if (reportList.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        {pageHeader}

        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-card)] px-8 py-16 text-center shadow-sm">
          <FileText size={40} className="mx-auto text-[var(--text-muted)]" aria-hidden="true" />
          <h2 className="mt-4 text-lg font-semibold text-[var(--text-primary)]">No reports yet</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-[var(--text-secondary)]">
            Monthly reports are generated automatically on the 1st of each month. Your first report
            will appear here after your next scheduled run.
          </p>
          <p className="mt-4 text-xs text-[var(--text-muted)]">
            Reports summarise your P&amp;L, cash position, and key ratios for the month.
          </p>
          <div className="mt-6">
            <GenerateReportButton />
          </div>
        </div>
      </div>
    );
  }

  // Reports list
  return (
    <div className="flex flex-col gap-6">
      {pageHeader}

      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--text-secondary)]">
          {reportList.length} {reportList.length === 1 ? "report" : "reports"} available
        </p>
        <GenerateReportButton />
      </div>

      <div className="flex flex-col gap-3">
        {reportList.map((report) => (
          <div
            key={report.id}
            className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] px-5 py-4 shadow-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-lg font-semibold text-[var(--text-primary)]">
                  {report.periodLabel}
                </p>
                {report.generatedAt && (
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                    Generated{" "}
                    {new Date(report.generatedAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                )}
              </div>
              <StatusBadge status={report.status} />
            </div>

            {report.status === "ready" && (
              <div className="mt-3 flex gap-3">
                <a
                  href={`/reports/${report.id}`}
                  className="text-sm font-medium text-[var(--primary-500)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary-500)]"
                >
                  View
                </a>
                <a
                  href={`/api/reports/${report.id}/export`}
                  className="text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary-500)]"
                >
                  Export
                </a>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
