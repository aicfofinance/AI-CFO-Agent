"use client";

/**
 * /alerts — Alerts Archive page (Step 14.0)
 *
 * Shows the historical archive of all intelligence findings. Includes filter
 * controls for status, severity, and finding type. Dismissed findings appear
 * here (dimmed + labelled) but do not appear on /dashboard.
 *
 * Data source: GET /api/intelligence/findings
 * Query params: status, severity, finding_type, cursor, limit
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

import { FindingCard } from "@/components/dashboard/FindingCard";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types — inline per established pattern (not yet in src/types/api.ts)
// ---------------------------------------------------------------------------

type FindingType =
  | "cash_flow_risk"
  | "anomaly"
  | "collections_opportunity"
  | "duplicate_subscription"
  | "margin_alert";

type Severity = "critical" | "high" | "medium" | "low";

type FindingArchiveItem = {
  id: string;
  findingType: FindingType;
  severity: Severity;
  headline: string;
  detail: string | null;
  recommendedAction: string | null;
  relatedData: Record<string, unknown> | null;
  status: string;
  createdAt: string;
  expiresAt: string | null;
  hasActionableType: boolean;
  dismissedAt: string | null;
  dismissReason: string | null;
};

type ArchiveResponse = {
  data: FindingArchiveItem[];
  meta: {
    total: number;
    nextCursor: string | null;
  };
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AlertsPage(): React.JSX.Element {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [severityFilter, setSeverityFilter] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [findings, setFindings] = useState<FindingArchiveItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Re-created whenever a filter changes; useEffect fires on recreation.
  const fetchFindings = useCallback(
    async (cursor?: string): Promise<void> => {
      // Fresh fetch (no cursor): reset list and enter loading state.
      if (cursor === undefined) {
        setFindings([]);
        setIsLoading(true);
        setError(null);
      }

      const params = new URLSearchParams();
      params.set("status", statusFilter);
      if (severityFilter) params.set("severity", severityFilter);
      if (typeFilter) params.set("finding_type", typeFilter);
      if (cursor !== undefined) params.set("cursor", cursor);

      try {
        const res = await fetch(`/api/intelligence/findings?${params.toString()}`);

        if (res.status === 401) {
          window.location.href = "/login";
          return;
        }

        if (!res.ok) {
          setError("Failed to load findings. Please try again.");
          return;
        }

        const json = (await res.json()) as ArchiveResponse;

        if (cursor !== undefined) {
          // Load-more: append to existing list.
          setFindings((prev) => [...prev, ...json.data]);
        } else {
          setFindings(json.data);
        }

        setNextCursor(json.meta.nextCursor);
      } catch {
        setError("Failed to load findings. Please try again.");
      } finally {
        setIsLoading(false);
      }
    },
    [statusFilter, severityFilter, typeFilter],
  );

  // Re-fetch whenever fetchFindings changes (i.e., any filter changes).
  useEffect(() => {
    void fetchFindings();
  }, [fetchFindings]);

  function handleLoadMore(): void {
    if (nextCursor !== null) {
      void fetchFindings(nextCursor);
    }
  }

  // When a card's dismiss action completes, re-fetch so the dismissed badge
  // appears (the API now returns the item with status="dismissed").
  function handleDismiss(): void {
    void fetchFindings();
  }

  return (
    <div>
      {/* ----------------------------------------------------------------- */}
      {/* Page header                                                        */}
      {/* ----------------------------------------------------------------- */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-default)] pb-6 mb-8">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Alerts Archive</h1>
        <Link
          href="/settings/notifications"
          className="rounded text-sm text-[var(--text-link)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--primary-500)]"
        >
          Configure alerts &rarr;
        </Link>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Filter bar                                                         */}
      {/* ----------------------------------------------------------------- */}
      <div
        role="group"
        aria-label="Filter findings"
        className="flex flex-wrap items-center gap-3 mb-6"
      >
        {/* Status */}
        <label htmlFor="alerts-status-filter" className="sr-only">
          Filter by status
        </label>
        <select
          id="alerts-status-filter"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--primary-500)]"
        >
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="dismissed">Dismissed</option>
          <option value="actioned">Actioned</option>
        </select>

        {/* Severity */}
        <label htmlFor="alerts-severity-filter" className="sr-only">
          Filter by severity
        </label>
        <select
          id="alerts-severity-filter"
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
          className="rounded border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--primary-500)]"
        >
          <option value="">All Severities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>

        {/* Finding type */}
        <label htmlFor="alerts-type-filter" className="sr-only">
          Filter by finding type
        </label>
        <select
          id="alerts-type-filter"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded border border-[var(--border-default)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-[var(--primary-500)]"
        >
          <option value="">All Types</option>
          <option value="cash_flow_risk">Cash Flow Risk</option>
          <option value="anomaly">Anomaly</option>
          <option value="collections_opportunity">Collections Opportunity</option>
          <option value="duplicate_subscription">Duplicate Subscription</option>
          <option value="margin_alert">Margin Alert</option>
        </select>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Error state                                                        */}
      {/* ----------------------------------------------------------------- */}
      {error !== null && (
        <div
          role="alert"
          className="mb-6 rounded border border-[var(--border-default)] bg-[var(--surface-card)] px-4 py-4 text-center text-sm text-[var(--text-secondary)]"
        >
          {error}
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Loading skeleton — only shown during fresh (filter-change) fetches */}
      {/* ----------------------------------------------------------------- */}
      {isLoading && (
        <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading findings">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-lg border border-[var(--border-default)] bg-[var(--surface-card)]"
            />
          ))}
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Empty state                                                        */}
      {/* ----------------------------------------------------------------- */}
      {!isLoading && error === null && findings.length === 0 && (
        <div className="py-16 text-center">
          <p className="text-sm text-[var(--text-secondary)]">
            No findings yet. Your first intelligence scan runs after your first QuickBooks sync.
          </p>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Findings list                                                      */}
      {/* ----------------------------------------------------------------- */}
      {!isLoading && findings.length > 0 && (
        <div className="flex flex-col gap-4">
          {findings.map((finding) => (
            <div key={finding.id}>
              {/* Dim dismissed and actioned findings visually */}
              <div
                className={cn(
                  finding.status === "dismissed" || finding.status === "actioned"
                    ? "opacity-60"
                    : "",
                )}
              >
                <FindingCard
                  id={finding.id}
                  findingType={finding.findingType}
                  severity={finding.severity}
                  headline={finding.headline}
                  detail={finding.detail}
                  recommendedAction={finding.recommendedAction}
                  relatedData={finding.relatedData}
                  hasActionableType={finding.hasActionableType}
                  createdAt={finding.createdAt}
                  onDismiss={handleDismiss}
                />
              </div>

              {/* Status label below dismissed cards */}
              {finding.status === "dismissed" && (
                <p className="ml-5 mt-1 text-xs text-[var(--text-muted)]">
                  Dismissed
                  {finding.dismissedAt !== null && (
                    <>
                      {" — "}
                      <time dateTime={finding.dismissedAt}>
                        {new Date(finding.dismissedAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </time>
                    </>
                  )}
                </p>
              )}

              {/* Status label below actioned cards */}
              {finding.status === "actioned" && (
                <p className="ml-5 mt-1 text-xs text-[var(--text-muted)]">Actioned</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Load more                                                          */}
      {/* ----------------------------------------------------------------- */}
      {!isLoading && nextCursor !== null && (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={handleLoadMore}
            className="rounded border border-[var(--border-default)] bg-[var(--surface-card)] px-4 py-2 text-sm text-[var(--text-primary)] hover:bg-[#F8FAFC] focus-visible:outline-2 focus-visible:outline-[var(--primary-500)]"
          >
            Load more
          </button>
        </div>
      )}
    </div>
  );
}
