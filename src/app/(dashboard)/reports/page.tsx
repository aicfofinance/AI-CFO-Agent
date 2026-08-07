import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { FileText } from "lucide-react";
import type { ReactElement } from "react";

import { env } from "@/lib/env";

// ---------------------------------------------------------------------------
// Local type — reports endpoint is a stub returning { data: null }.
// Defined inline because the response type is not yet in src/types/api.ts.
// ---------------------------------------------------------------------------

type ReportSummary = {
  id: string;
  [key: string]: unknown;
};

type ReportsApiResponse = {
  data: null | ReportSummary[];
};

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

  // Page header is shared across all non-redirect render paths
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
  const reports = json.data ?? [];

  // Empty state — rendered when the stub returns null or an empty array
  if (reports.length === 0) {
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
        </div>
      </div>
    );
  }

  // Future: render a list of ReportSummary cards here when the endpoint is
  // fully implemented. For V1 the stub always returns null so this path is
  // unreachable in production.
  return (
    <div className="flex flex-col gap-6">
      {pageHeader}
      <p className="text-sm text-[var(--text-secondary)]">
        {reports.length} {reports.length === 1 ? "report" : "reports"} available.
      </p>
    </div>
  );
}
