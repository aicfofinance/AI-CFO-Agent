import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { env } from "@/lib/env";
import { DataTimestamp } from "@/components/shared/DataTimestamp";
import { FindingCard } from "@/components/dashboard/FindingCard";
import { IntelligenceFeedHealthy } from "@/components/dashboard/IntelligenceFeedHealthy";
import { IntelligenceFeedBaseline } from "@/components/dashboard/IntelligenceFeedBaseline";

// ---------------------------------------------------------------------------
// Types — defined inline because this endpoint's response type is not yet in
// src/types/api.ts. These mirror the shape returned by GET /api/intelligence/feed
// (see src/app/api/intelligence/feed/route.ts).
// ---------------------------------------------------------------------------

type FindingFeedItem = {
  id: string;
  findingType:
    | "cash_flow_risk"
    | "anomaly"
    | "collections_opportunity"
    | "duplicate_subscription"
    | "margin_alert";
  severity: "critical" | "high" | "medium" | "low";
  headline: string;
  detail: string | null;
  recommendedAction: string | null;
  relatedData: Record<string, unknown> | null;
  hasActionableType: boolean;
  createdAt: string;
};

type FeedMeta = {
  total: number;
  bySeverity: { critical: number; high: number; medium: number; low: number };
  nextCursor: string | null;
};

type FeedSuccess = {
  data: FindingFeedItem[];
  meta: FeedMeta;
};

type FeedError = {
  error: {
    code: string;
    message: string;
    request_id: string;
  };
};

type FeedInsufficientData = {
  error: {
    code: string;
    details?: { daysAvailable?: number };
  };
};

// ---------------------------------------------------------------------------
// Page — Server Component (no "use client")
// ---------------------------------------------------------------------------

export default async function IntelligenceFeedPage(): Promise<React.JSX.Element> {
  const requestHeaders = await headers();
  const cookie = requestHeaders.get("cookie") ?? "";
  const host = requestHeaders.get("host");
  const proto = requestHeaders.get("x-forwarded-proto") ?? "https";
  const baseUrl = host
    ? `${proto}://${host}`
    : (env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000");

  // Captured before the fetch so both the 422 and the success paths share it.
  const fetchedAt = new Date().toISOString();

  // Fetch active and resolved findings in parallel.
  const [res, resolvedRes] = await Promise.all([
    fetch(`${baseUrl}/api/intelligence/feed`, { headers: { cookie }, cache: "no-store" }),
    fetch(`${baseUrl}/api/intelligence/feed?resolved=true`, {
      headers: { cookie },
      cache: "no-store",
    }),
  ]);

  // 401: session expired or not present — send to login
  if (res.status === 401) {
    redirect("/login");
  }

  // 422: fewer than 60 days of transaction history — show baseline building card
  if (res.status === 422) {
    const body = (await res.json()) as FeedInsufficientData;
    const daysAvailable = body.error.details?.daysAvailable ?? 0;
    return (
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-default)] pb-6 mb-8">
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Intelligence Feed</h1>
          <div className="flex flex-wrap items-center gap-3">
            <DataTimestamp date={fetchedAt} />
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F1F5F9] px-3 py-1 text-xs font-medium text-[#64748B]">
              🔒 Read-only — your books are unchanged
            </span>
          </div>
        </div>
        <IntelligenceFeedBaseline daysAvailable={daysAvailable} />
      </div>
    );
  }

  // Any other non-OK status (403, 500, etc.)
  if (!res.ok) {
    return (
      <div role="alert" className="text-sm py-12 text-center text-[var(--text-secondary)]">
        Something went wrong loading your intelligence feed.
      </div>
    );
  }

  const json = (await res.json()) as FeedSuccess | FeedError;

  if ("error" in json) {
    return (
      <div role="alert" className="text-sm py-12 text-center text-[var(--text-secondary)]">
        Something went wrong loading your intelligence feed.
      </div>
    );
  }

  const { data: findings } = json;

  // Resolved findings — silently empty if the request failed (non-critical)
  let resolvedFindings: FindingFeedItem[] = [];
  if (resolvedRes.ok) {
    const resolvedJson = (await resolvedRes.json()) as FeedSuccess | FeedError;
    if (!("error" in resolvedJson)) {
      resolvedFindings = resolvedJson.data;
    }
  }

  // Status label for resolved findings
  const RESOLVED_STATUS_LABELS: Record<string, string> = {
    actioned: "Actioned",
    dismissed: "Dismissed",
  };

  return (
    <div>
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-default)] pb-6 mb-8">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Intelligence Feed</h1>
        <div className="flex flex-wrap items-center gap-3">
          <DataTimestamp date={fetchedAt} />
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F1F5F9] px-3 py-1 text-xs font-medium text-[#64748B]">
            🔒 Read-only — your books are unchanged
          </span>
        </div>
      </div>

      {/* Active findings */}
      {findings.length === 0 ? (
        <IntelligenceFeedHealthy />
      ) : (
        <div className="flex flex-col gap-4">
          {findings.map((finding) => (
            <FindingCard key={finding.id} {...finding} />
          ))}
        </div>
      )}

      {/* Resolved findings — shown below active feed when any exist */}
      {resolvedFindings.length > 0 && (
        <div className="mt-10">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Resolved · {resolvedFindings.length}
          </h2>
          <div className="flex flex-col gap-2">
            {resolvedFindings.map((finding) => (
              <div
                key={finding.id}
                className="flex items-start justify-between gap-4 rounded-md border border-[var(--border-default)] bg-[var(--gray-50)] px-4 py-3 opacity-75"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-[var(--text-secondary)]">
                    {finding.headline}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                    {new Date(finding.createdAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-[var(--gray-200)] px-2 py-0.5 text-xs text-[var(--text-muted)]">
                  {RESOLVED_STATUS_LABELS[finding.status] ?? finding.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
