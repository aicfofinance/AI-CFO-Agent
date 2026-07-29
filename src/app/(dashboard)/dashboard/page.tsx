import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { env } from "@/lib/env";
import { DataTimestamp } from "@/components/shared/DataTimestamp";
import { FindingCard } from "@/components/dashboard/FindingCard";

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

// ---------------------------------------------------------------------------
// Page — Server Component (no "use client")
// ---------------------------------------------------------------------------

export default async function IntelligenceFeedPage(): Promise<React.JSX.Element> {
  const baseUrl = env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const cookie = (await headers()).get("cookie") ?? "";

  const res = await fetch(`${baseUrl}/api/intelligence/feed`, {
    headers: { cookie },
    cache: "no-store",
  });

  // 401: session expired or not present — send to login
  if (res.status === 401) {
    redirect("/login");
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

  // Captured at render time — represents when this data was fetched.
  const fetchedAt = new Date().toISOString();

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

      {/* Feed area */}
      {findings.length === 0 ? (
        <div className="py-12 text-center text-sm text-[var(--text-muted)]">
          No active findings. Your finances look healthy.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {findings.map((finding) => (
            <FindingCard key={finding.id} {...finding} />
          ))}
        </div>
      )}
    </div>
  );
}
