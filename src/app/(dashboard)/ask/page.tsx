"use client";

/**
 * /ask page — Step 11.2: context-aware empty state.
 *
 * On mount (parallel fetches):
 *   1. POST /api/conversations  { title: "Q&A Session" }  → stores conversationId
 *   2. GET  /api/intelligence/feed                        → determines empty-state variant
 *
 * Three empty-state variants (priority order):
 *   1. ?finding_id=[id] param    → finding context block + pre-filled chat input
 *   2. Active high/critical      → urgent finding headline + "talk through options" CTA
 *   3. Healthy (fallback)        → four standard question chips
 *
 * ChatInput and the data sovereignty notice always render at the bottom.
 * Actual streaming is wired in Step 11.3.
 *
 * useSearchParams() requires a Suspense boundary per Next.js 15 App Router.
 */

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { AIResponseSkeleton } from "@/components/chat/AIResponseSkeleton";
import { ChatInput } from "@/components/chat/ChatInput";

// ---------------------------------------------------------------------------
// Types — mirror the shape returned by GET /api/intelligence/feed
// (not yet in src/types/api.ts; defined inline per existing dashboard pattern)
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

type FeedSuccess = {
  data: FindingFeedItem[];
  meta: {
    total: number;
    bySeverity: { critical: number; high: number; medium: number; low: number };
    nextCursor: string | null;
  };
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SUGGESTED_QUESTIONS: readonly string[] = [
  "What are my top expenses this month?",
  "How does my cash flow look for the next 30 days?",
  "Which invoices are most overdue?",
  "How does my revenue compare to last month?",
] as const;

/**
 * Severity → Tailwind class string for the urgent finding border+background.
 * Follows the same documented-constant pattern as SEVERITY_LEFT_BORDER in
 * FindingCard.tsx — the mapping table itself is the documentation for these hex
 * values per CLAUDE.md component rules.
 *
 *   critical: loss-700 border (#A21520), loss-50 bg (#FFF1F1)
 *   high:     warning-600 border (#B45309), warning-50 bg (#FFFBEB)
 */
const URGENT_SEVERITY_CLASSES = {
  critical: "border-l-4 border-l-[#A21520] bg-[#FFF1F1]",
  high: "border-l-4 border-l-[#B45309] bg-[#FFFBEB]",
} as const;

// ---------------------------------------------------------------------------
// Empty-state sub-components
// ---------------------------------------------------------------------------

/** Variant 1 — an active high/critical finding exists (no ?finding_id param). */
function UrgentFindingEmptyState({ finding }: { finding: FindingFeedItem }): React.JSX.Element {
  // Ternary narrows finding.severity to the two keys present in URGENT_SEVERITY_CLASSES.
  // urgentFinding is filtered to critical|high upstream, so other values won't reach here.
  const severityClass =
    finding.severity === "critical"
      ? URGENT_SEVERITY_CLASSES.critical
      : URGENT_SEVERITY_CLASSES.high;

  return (
    <div className="flex flex-1 items-center justify-center py-10">
      <div className="w-full max-w-lg">
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
          Needs your attention
        </p>

        {/* Finding headline with severity left-border — uses Tailwind class constant */}
        <div className={`mb-4 rounded-r-lg px-4 py-3 ${severityClass}`}>
          <p className="text-[15px] font-medium leading-snug text-[var(--text-primary)]">
            {finding.headline}
          </p>
        </div>

        <p className="mb-5 text-[15px] text-[var(--text-secondary)]">
          Want to talk through your options?
        </p>

        {/*
         * CTA — visible in step 11.2. Actual submit wired in step 11.3.
         * NOT labelled "Send" (CLAUDE.md: agentic CTA must never be "Send").
         */}
        <button
          type="button"
          aria-label={`Tell me more about: ${finding.headline}`}
          className="inline-flex items-center gap-2 rounded bg-[var(--primary-500)] px-4 py-2 text-sm font-medium text-white transition-colors duration-100 hover:bg-[var(--primary-600)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary-500)]"
        >
          Tell me more about this
        </button>
      </div>
    </div>
  );
}

/** Variant 2 — ?finding_id=[id] param present; matching finding found in feed. */
function FindingContextEmptyState({ finding }: { finding: FindingFeedItem }): React.JSX.Element {
  return (
    <div className="flex flex-1 flex-col justify-center py-6">
      <div className="w-full max-w-lg">
        <div className="rounded-lg border border-[var(--primary-200)] bg-[var(--primary-50)] p-5">
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-[var(--primary-500)]">
            <span className="sr-only">Finding context loaded: </span>Context loaded
          </p>
          <p className="text-[15px] font-medium leading-snug text-[var(--text-primary)]">
            {finding.headline}
          </p>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            The question below is pre-filled and ready to send.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Variant 3 — healthy state, no high/critical findings and no finding_id param. */
function HealthyEmptyState(): React.JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
      <h2 className="text-xl font-semibold text-[var(--text-primary)]">
        What would you like to know?
      </h2>
      <p className="mt-2 text-sm text-[var(--text-secondary)]">
        Ask anything about your finances, or pick a question below.
      </p>

      {/* Question chips — per FRONTEND_GUIDELINES Section 8.5 */}
      <div className="mt-8 flex max-w-xl flex-wrap justify-center gap-2 overflow-hidden">
        {SUGGESTED_QUESTIONS.map((question) => (
          <button
            key={question}
            type="button"
            /*
             * Chips are visible in step 11.2. Click-to-fill wired in step 11.3.
             */
            aria-label={`Ask: ${question}`}
            className="rounded-full border border-[var(--border-default)] bg-[var(--gray-100)] px-3.5 py-1.5 text-sm text-[var(--text-secondary)] transition-colors duration-100 hover:border-[var(--primary-200)] hover:bg-[var(--primary-50)] hover:text-[var(--primary-600)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary-500)]"
          >
            {question}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inner page content — uses useSearchParams, must be inside <Suspense>
// ---------------------------------------------------------------------------

function AskContent(): React.JSX.Element {
  const searchParams = useSearchParams();
  const findingId = searchParams.get("finding_id");

  /**
   * Conversation state: the getter is not read in step 11.2 (streaming is wired
   * in step 11.3). Only the setter is needed here to persist the ID in React
   * state so step 11.3 can destructure the getter without a breaking change.
   */
  const [, setConversationId] = useState<string | null>(null);
  const [convError, setConvError] = useState(false);
  const [findings, setFindings] = useState<FindingFeedItem[] | null>(null);
  const [feedLoading, setFeedLoading] = useState(true);

  // Parallel fetches on mount
  useEffect(() => {
    // --- Conversation creation ---
    fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Q&A Session" }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`conversations POST returned ${res.status}`);
        return res.json() as Promise<{ data: { id: string; title: string } }>;
      })
      .then((json) => {
        setConversationId(json.data.id);
      })
      .catch(() => {
        setConvError(true);
      });

    // --- Intelligence feed ---
    fetch("/api/intelligence/feed")
      .then((res) => {
        if (!res.ok) {
          // 422 (insufficient data) or any other error → treat as no findings
          setFindings([]);
          setFeedLoading(false);
          return null;
        }
        return res.json() as Promise<FeedSuccess | { error: unknown }>;
      })
      .then((json) => {
        if (json === null) return;
        if ("error" in json) {
          setFindings([]);
        } else {
          setFindings(json.data);
        }
        setFeedLoading(false);
      })
      .catch(() => {
        setFindings([]);
        setFeedLoading(false);
      });
  }, []);

  // ---------------------------------------------------------------------------
  // Determine the correct empty-state variant
  // ---------------------------------------------------------------------------

  // Variant 2: ?finding_id=[id] — find the matching finding in the feed
  const contextFinding: FindingFeedItem | null =
    findingId !== null && findings !== null
      ? (findings.find((f) => f.id === findingId) ?? null)
      : null;

  // Variant 1: first high/critical finding (only relevant when no finding_id param)
  const urgentFinding: FindingFeedItem | null =
    findingId === null && findings !== null
      ? (findings.find((f) => f.severity === "critical" || f.severity === "high") ?? null)
      : null;

  // Pre-fill value for ChatInput when ?finding_id is present and matched
  const chatInitialValue =
    contextFinding !== null ? `Tell me more about: ${contextFinding.headline}` : "";

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  let emptyStateContent: React.JSX.Element;

  if (feedLoading) {
    emptyStateContent = (
      <div className="flex flex-1 flex-col justify-center py-10">
        <AIResponseSkeleton />
      </div>
    );
  } else if (contextFinding !== null) {
    emptyStateContent = <FindingContextEmptyState finding={contextFinding} />;
  } else if (urgentFinding !== null) {
    emptyStateContent = <UrgentFindingEmptyState finding={urgentFinding} />;
  } else {
    emptyStateContent = <HealthyEmptyState />;
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="border-b border-[var(--border-default)] pb-6">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Ask CFO Lens</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Ask any question about your financial data.
        </p>
      </div>

      {/* Messages / empty-state area — minimum height gives the "chat" feel */}
      <div className="flex min-h-[320px] flex-col">{emptyStateContent}</div>

      {/* Conversation error — subtle inline notice */}
      {convError && (
        <p className="text-sm text-[var(--text-muted)]" role="alert">
          Could not create a conversation session. Please refresh to try again.
        </p>
      )}

      {/* Chat input area */}
      <div className="border-t border-[var(--border-default)] pt-4">
        {/*
         * key forces a remount (and re-initialisation of the textarea value)
         * when contextFinding changes — e.g. when the feed loads and a matching
         * ?finding_id is resolved after initial render.
         */}
        <ChatInput
          key={contextFinding?.id ?? "default"}
          onSubmit={() => {
            // No-op in step 11.2 — streaming wired in step 11.3.
          }}
          initialValue={chatInitialValue}
        />

        {/* Data sovereignty notice — FRONTEND_GUIDELINES Section 8 */}
        <p className="mt-2 text-center text-xs italic text-[var(--text-muted)]">
          This AI reads your accounting data and provides analysis — not financial advice.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading fallback — minimal skeleton shown while search params resolve
// ---------------------------------------------------------------------------

function AskSkeleton(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <div className="border-b border-[var(--border-default)] pb-6">
        <div className="h-8 w-40 animate-pulse rounded bg-[var(--border-default)]" />
        <div className="mt-1 h-4 w-64 animate-pulse rounded bg-[var(--border-default)]" />
      </div>
      <div className="flex min-h-[320px] flex-col justify-center py-10">
        <AIResponseSkeleton />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page — wraps AskContent in Suspense as required by Next.js 15
// ---------------------------------------------------------------------------

export default function AskPage(): React.JSX.Element {
  return (
    <Suspense fallback={<AskSkeleton />}>
      <AskContent />
    </Suspense>
  );
}
