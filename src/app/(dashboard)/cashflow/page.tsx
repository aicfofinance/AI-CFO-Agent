/**
 * Cash Flow page — server component.
 *
 * Fetches the cash-flow projection from GET /api/cashflow/projection?days={30|60|90}
 * and renders the CashFlowChart client component. Handles:
 *   - 401: redirect to /login
 *   - 422 (INSUFFICIENT_DATA): progress-bar "building baseline" state
 *   - Other errors: generic error state
 *   - Success: CashFlowChart with real projection data
 *
 * The DaysTabBar (client component) is wrapped in Suspense to prevent full
 * page de-opt to client-side rendering.
 */

import React, { Suspense } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";

import { env } from "@/lib/env";
import { CashFlowChart } from "@/components/dashboard/CashFlowChart";
import { DaysTabBar } from "@/components/dashboard/DaysTabBar";

// ---------------------------------------------------------------------------
// Types — inline, matching the actual shape returned by GET /api/cashflow/projection
// ---------------------------------------------------------------------------

type DailyBalance = {
  date: string;
  projectedBalance: string;
  inflows: string;
  outflows: string;
};

type CashFlowSuccessResponse = {
  data: {
    projectedData: DailyBalance[];
    minimumProjectedBalance: string;
    riskDate: string | null;
    confidenceLevel: "low" | "medium" | "high";
    generatedAt: string;
  };
};

type CashFlowErrorResponse = {
  error: {
    code: string;
    message: string;
    request_id: string;
    details?: { daysAvailable?: number; daysRequired?: number };
  };
};

type CashFlowApiResponse = CashFlowSuccessResponse | CashFlowErrorResponse;

// ---------------------------------------------------------------------------
// Page props — Next.js 15 App Router (searchParams is a Promise)
// ---------------------------------------------------------------------------

type Props = {
  searchParams: Promise<{ days?: string }>;
};

// ---------------------------------------------------------------------------
// Suspense fallback for DaysTabBar — static placeholder with no active state
// ---------------------------------------------------------------------------

function DaysTabBarFallback(): React.JSX.Element {
  return (
    <div className="flex gap-1 rounded-lg bg-[#F1F5F9] p-1" aria-hidden="true">
      {["30", "60", "90"].map((d) => (
        <div key={d} className="rounded-md px-4 py-1.5 text-sm font-medium text-[#64748B]">
          {d}d
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page — Server Component
// ---------------------------------------------------------------------------

export default async function CashflowPage({ searchParams }: Props): Promise<React.JSX.Element> {
  const { days: daysParam } = await searchParams;
  const days = daysParam === "60" ? 60 : daysParam === "90" ? 90 : 30;

  const baseUrl = env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const cookie = (await headers()).get("cookie") ?? "";

  const res = await fetch(`${baseUrl}/api/cashflow/projection?days=${days}`, {
    headers: { cookie },
    cache: "no-store",
  });

  // 401: session expired or absent — send to login
  if (res.status === 401) {
    redirect("/login");
  }

  // ---------------------------------------------------------------------------
  // Page shell (shared across all states)
  // ---------------------------------------------------------------------------

  const pageHeader = (
    <div className="mb-8 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-default)] pb-6">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Cash Flow</h1>
        <Suspense fallback={<DaysTabBarFallback />}>
          <DaysTabBar />
        </Suspense>
      </div>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F1F5F9] px-3 py-1 text-xs font-medium text-[#64748B]">
        🔒 Read-only — your books are unchanged
      </span>
    </div>
  );

  // ---------------------------------------------------------------------------
  // 422: insufficient transaction history — render progress-bar state
  // ---------------------------------------------------------------------------

  if (res.status === 422) {
    const errorBody = (await res.json()) as CashFlowErrorResponse;
    const daysAvailable = errorBody.error.details?.daysAvailable ?? 0;
    const progress = Math.round((daysAvailable / 60) * 100);

    return (
      <div>
        {pageHeader}
        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] p-8 text-center">
          <h2 className="mb-2 text-lg font-semibold text-[var(--text-primary)]">
            Building your baseline
          </h2>
          <p className="mb-6 text-sm text-[var(--text-secondary)]">
            CFO Lens needs 60 days of transaction data to generate accurate cash flow projections.
            You have {daysAvailable} {daysAvailable === 1 ? "day" : "days"} so far.
          </p>
          {/* Progress bar — dynamic width requires style prop per build instructions */}
          <div className="mx-auto mb-2 max-w-sm">
            <div className="h-2 w-full rounded-full bg-[#E2E8F0]">
              <div
                className="h-2 rounded-full bg-[#2557A7]"
                style={{ width: `${progress}%` }}
                role="progressbar"
                aria-valuenow={daysAvailable}
                aria-valuemin={0}
                aria-valuemax={60}
              />
            </div>
          </div>
          <p className="text-xs text-[var(--text-muted)]">{daysAvailable} / 60 days</p>
          {/* Ask-a-question CTAs — available while baseline is building */}
          <div className="mt-6 space-y-2 text-left">
            <p className="text-sm font-medium text-[var(--text-secondary)]">
              While you wait, you can still ask:
            </p>
            <div className="flex flex-col gap-2">
              <Link
                href="/ask?q=what+are+my+biggest+expenses+this+month"
                className="text-sm text-[var(--text-link)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-500)] focus-visible:rounded"
              >
                &#8594; What are my biggest expenses this month?
              </Link>
              <Link
                href="/ask?q=how+does+my+cash+position+compare+to+last+month"
                className="text-sm text-[var(--text-link)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-500)] focus-visible:rounded"
              >
                &#8594; How does my cash position compare to last month?
              </Link>
              <Link
                href="/ask?q=show+me+transactions+from+the+last+30+days"
                className="text-sm text-[var(--text-link)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-500)] focus-visible:rounded"
              >
                &#8594; Show me transactions from the last 30 days
              </Link>
            </div>
          </div>
        </div>
        <p className="mt-6 border-t border-[var(--border-subtle)] pt-4 text-xs text-[var(--text-muted)]">
          This is AI-assisted cash flow analysis based on your accounting data. It is not financial
          advice. Consult a qualified financial professional for decisions requiring expert
          judgment.
        </p>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Any other non-OK response — generic error state
  // ---------------------------------------------------------------------------

  if (!res.ok) {
    return (
      <div>
        {pageHeader}
        <div role="alert" className="py-12 text-center text-sm text-[var(--text-secondary)]">
          Something went wrong loading your cash flow projection. Please try again.
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Success — parse response and render chart
  // ---------------------------------------------------------------------------

  const json = (await res.json()) as CashFlowApiResponse;

  if ("error" in json) {
    return (
      <div>
        {pageHeader}
        <div role="alert" className="py-12 text-center text-sm text-[var(--text-secondary)]">
          Something went wrong loading your cash flow projection. Please try again.
        </div>
      </div>
    );
  }

  const { data: projection } = json;

  return (
    <div>
      {pageHeader}

      {/* Chart card */}
      <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)] p-6">
        <CashFlowChart
          projectedData={projection.projectedData}
          minimumProjectedBalance={projection.minimumProjectedBalance}
          riskDate={projection.riskDate}
          confidenceLevel={projection.confidenceLevel}
        />
      </div>

      {/* Disclaimer — always visible below the chart */}
      <p className="mt-6 border-t border-[var(--border-subtle)] pt-4 text-xs text-[var(--text-muted)]">
        This is AI-assisted cash flow analysis based on your accounting data. It is not financial
        advice. Consult a qualified financial professional for decisions requiring expert judgment.
      </p>
    </div>
  );
}
