import { redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import { env } from "@/lib/env";
import { FindingCard } from "@/components/dashboard/FindingCard";
import { IntelligenceFeedHealthy } from "@/components/dashboard/IntelligenceFeedHealthy";

// ---------------------------------------------------------------------------
// Types — defined inline; mirrors the shape returned by GET /api/intelligence/feed
// (see src/app/api/intelligence/feed/route.ts). Not imported from src/types/
// because the feed response type is not yet exported from api.ts.
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
  status: string;
  createdAt: string;
  expiresAt: string | null;
  hasActionableType: boolean;
};

type FeedSuccess = {
  data: FindingFeedItem[];
  meta: {
    total: number;
    nextCursor: string | null;
    bySeverity: { critical: number; high: number; medium: number; low: number };
  };
};

// ---------------------------------------------------------------------------
// Page — Server Component (no "use client")
// Step 10.4: first scan results shown after the intelligence run completes.
// ---------------------------------------------------------------------------

export default async function FirstBriefPage(): Promise<React.JSX.Element> {
  const requestHeaders = await headers();
  const cookie = requestHeaders.get("cookie") ?? "";
  const host = requestHeaders.get("host");
  const proto = requestHeaders.get("x-forwarded-proto") ?? "https";
  const baseUrl = host
    ? `${proto}://${host}`
    : (env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000");

  let findings: FindingFeedItem[] = [];

  const res = await fetch(`${baseUrl}/api/intelligence/feed?limit=3`, {
    headers: { cookie },
    cache: "no-store",
  });

  // 401: session expired or not present — send to login
  if (res.status === 401) {
    redirect("/login");
  }

  // Any 2xx response: parse and extract findings
  if (res.ok) {
    const json = (await res.json()) as FeedSuccess | { error: unknown };
    if (!("error" in json)) {
      findings = json.data;
    }
  }
  // Non-ok, non-401 → findings stays [] → healthy state shown below

  return (
    <div className="mx-auto max-w-2xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
          Here&apos;s what I found in your first scan
        </h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">Just now</p>
      </div>

      {/* Content — up to 3 finding cards, or healthy state if none */}
      {findings.length === 0 ? (
        <IntelligenceFeedHealthy />
      ) : (
        <div className="flex flex-col gap-4">
          {findings.map((finding) => (
            <FindingCard
              key={finding.id}
              id={finding.id}
              findingType={finding.findingType}
              severity={finding.severity}
              headline={finding.headline}
              detail={finding.detail}
              recommendedAction={finding.recommendedAction}
              relatedData={finding.relatedData}
              hasActionableType={finding.hasActionableType}
              createdAt={finding.createdAt}
            />
          ))}
        </div>
      )}

      {/* Data sovereignty statement — always present */}
      <div
        className="mt-8 border-l-4 border-[var(--primary-500)] bg-[var(--primary-50)] px-4 py-3"
        role="note"
        aria-label="Data sovereignty statement"
      >
        <div className="flex items-start gap-2">
          <ShieldCheck
            size={16}
            className="mt-0.5 shrink-0 text-[var(--primary-500)]"
            aria-hidden="true"
          />
          <p className="text-sm leading-relaxed text-[var(--primary-800)]">
            Your data lives in QuickBooks — not here. If you cancel, your books are unchanged.
          </p>
        </div>
      </div>

      {/* CTAs */}
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Link
          href="/dashboard"
          className="inline-flex items-center justify-center rounded-lg bg-[var(--primary-500)] px-5 py-2.5 text-sm font-medium text-white transition-colors duration-150 hover:bg-[var(--primary-600)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary-500)]"
        >
          Go to Intelligence Feed &rarr;
        </Link>
        <Link
          href="/cashflow"
          className="inline-flex items-center justify-center rounded-lg border border-[var(--border-default)] bg-white px-5 py-2.5 text-sm font-medium text-[var(--text-primary)] transition-colors duration-150 hover:bg-[var(--primary-50)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary-500)]"
        >
          View Cash Flow Projection &rarr;
        </Link>
      </div>
    </div>
  );
}
