"use client";

/**
 * /ask page — Step 11.3: streaming Q&A wired.
 *
 * Builds on Step 11.2's context-aware empty state by wiring SSE streaming via
 * manual fetch + ReadableStream parsing (Vercel AI SDK data-stream format).
 *
 * Message endpoint expects: POST { question: string }
 * Stream format (data-stream protocol):
 *   0:"text chunk"  → text part (JSON-encoded string value)
 *   d:{...}         → done signal (ignored — we read until the stream closes)
 *   other prefixes  → silently ignored
 *
 * useSearchParams() requires a Suspense boundary per Next.js 15 App Router.
 */

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

import { AIResponse } from "@/components/chat/AIResponse";
import { AIResponseSkeleton } from "@/components/chat/AIResponseSkeleton";
import { ChatInput } from "@/components/chat/ChatInput";
import { UserMessage } from "@/components/chat/UserMessage";

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
// Chat message type
// ---------------------------------------------------------------------------

type ChatMessage = { role: "user" | "assistant"; content: string };

// ---------------------------------------------------------------------------
// SSE stream parsing
// ---------------------------------------------------------------------------

/**
 * Extracts text from a Vercel AI SDK data-stream chunk.
 * Lines prefixed with "0:" contain JSON-encoded text parts.
 * Example: `0:"hello world"\n` → "hello world"
 */
function parseStreamChunk(chunk: string): string {
  const lines = chunk.split("\n");
  let text = "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("0:")) {
      try {
        const parsed: unknown = JSON.parse(trimmed.slice(2));
        if (typeof parsed === "string") {
          text += parsed;
        }
      } catch {
        // malformed line — skip silently
      }
    }
  }
  return text;
}

// ---------------------------------------------------------------------------
// localStorage persistence helpers
// ---------------------------------------------------------------------------

const LS_KEY = "cfolens_ask_session";

type SavedSession = {
  conversationId: string;
  messages: ChatMessage[];
};

function loadSession(): SavedSession | null {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(LS_KEY) : null;
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "conversationId" in parsed &&
      "messages" in parsed &&
      typeof (parsed as SavedSession).conversationId === "string" &&
      Array.isArray((parsed as SavedSession).messages)
    ) {
      return parsed as SavedSession;
    }
    return null;
  } catch {
    return null;
  }
}

function saveSession(conversationId: string, msgs: ChatMessage[]): void {
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify({ conversationId, messages: msgs }));
  } catch {
    // localStorage may be unavailable in some environments — silently ignore
  }
}

function clearSession(): void {
  try {
    window.localStorage.removeItem(LS_KEY);
  } catch {
    // ignore
  }
}

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
function UrgentFindingEmptyState({
  finding,
  onSubmit,
}: {
  finding: FindingFeedItem;
  onSubmit: (question: string) => void;
}): React.JSX.Element {
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

        {/* Finding headline with severity left-border */}
        <div className={`mb-4 rounded-r-lg px-4 py-3 ${severityClass}`}>
          <p className="text-[15px] font-medium leading-snug text-[var(--text-primary)]">
            {finding.headline}
          </p>
        </div>

        <p className="mb-5 text-[15px] text-[var(--text-secondary)]">
          Want to talk through your options?
        </p>

        {/*
         * CTA — submits the question about this finding.
         * NOT labelled "Send" (CLAUDE.md: agentic CTA must never be "Send").
         */}
        <button
          type="button"
          onClick={() => onSubmit(`Tell me more about: ${finding.headline}`)}
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
function HealthyEmptyState({
  onSubmit,
}: {
  onSubmit: (question: string) => void;
}): React.JSX.Element {
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
            onClick={() => onSubmit(question)}
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

  // Conversation & feed state
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [convError, setConvError] = useState(false);
  const [findings, setFindings] = useState<FindingFeedItem[] | null>(null);
  const [feedLoading, setFeedLoading] = useState(true);

  // Streaming state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [queriesRemaining, setQueriesRemaining] = useState<number | null>(null);
  const [quotaExhausted, setQuotaExhausted] = useState(false);

  // Auto-submit tracking: ref for immediate sync guard, state to remount ChatInput
  const autoSubmittedRef = useRef(false);
  const [didAutoSubmit, setDidAutoSubmit] = useState(false);

  // Parallel fetches on mount
  useEffect(() => {
    // --- Conversation: restore from localStorage or create new ---
    const saved = loadSession();
    if (saved) {
      // Restore previous session — no API call needed
      setConversationId(saved.conversationId);
      setMessages(saved.messages);
    } else {
      // No saved session — create a fresh conversation
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
    }

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
  // Core streaming handler
  // ---------------------------------------------------------------------------

  /**
   * Submits a question to the messages endpoint and reads the SSE stream.
   * Uses useCallback with empty deps because all referenced setters are stable
   * React state setter references.
   */
  const handleQuestion = useCallback(
    async (question: string, convId: string): Promise<void> => {
      setMessages((prev) => [...prev, { role: "user" as const, content: question }]);
      setIsStreaming(true);
      setStreamingContent("");

      try {
        const response = await fetch(`/api/conversations/${convId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question }),
        });

        if (!response.ok) {
          // Check for quota exhaustion (429 + QUOTA_EXCEEDED code)
          let quotaHit = false;
          try {
            const errBody = (await response.json()) as { error?: { code?: string } };
            quotaHit = response.status === 429 && errBody.error?.code === "QUOTA_EXCEEDED";
          } catch {
            // ignore parse failure — treat as generic error
          }

          if (quotaHit) {
            setQuotaExhausted(true);
          } else {
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant" as const,
                content: "Something went wrong. Please try again.",
              },
            ]);
          }
          return;
        }

        // Read X-Queries-Remaining header
        const remainingHeader = response.headers.get("X-Queries-Remaining");
        if (remainingHeader !== null) {
          const parsed = parseInt(remainingHeader, 10);
          if (!isNaN(parsed)) {
            setQueriesRemaining(parsed);
          }
        }

        // Read the SSE data-stream
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let fullContent = "";

        if (reader !== undefined) {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            const extracted = parseStreamChunk(chunk);
            if (extracted.length > 0) {
              fullContent += extracted;
              setStreamingContent(fullContent);
            }
          }
        }

        setMessages((prev) => {
          const updated = [...prev, { role: "assistant" as const, content: fullContent }];
          if (convId) saveSession(convId, updated);
          return updated;
        });
      } catch {
        // Network error or stream interruption
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant" as const,
            content: "Connection error. Please check your network and try again.",
          },
        ]);
      } finally {
        setIsStreaming(false);
        setStreamingContent("");
      }
    },
    [], // state setters are stable references — no external deps
  );

  // Clears localStorage and starts a fresh conversation
  function handleNewConversation(): void {
    clearSession();
    setMessages([]);
    setConversationId(null);
    setConvError(false);
    setQueriesRemaining(null);
    setQuotaExhausted(false);
    autoSubmittedRef.current = false;
    setDidAutoSubmit(false);

    fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Q&A Session" }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`conversations POST returned ${res.status}`);
        return res.json() as Promise<{ data: { id: string } }>;
      })
      .then((json) => {
        setConversationId(json.data.id);
      })
      .catch(() => {
        setConvError(true);
      });
  }

  // ---------------------------------------------------------------------------
  // Auto-submit when ?finding_id param resolves to a matched finding
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

  useEffect(() => {
    // Ref guard prevents double-execution across re-renders
    if (autoSubmittedRef.current) return;
    if (contextFinding === null || conversationId === null) return;

    autoSubmittedRef.current = true;
    setDidAutoSubmit(true);
    void handleQuestion(`Tell me more about: ${contextFinding.headline}`, conversationId);
  }, [contextFinding, conversationId, handleQuestion]);

  // ---------------------------------------------------------------------------
  // Derived values for the input area
  // ---------------------------------------------------------------------------

  // Pre-fill value for ChatInput when ?finding_id is present, matched, and not yet submitted
  const chatInitialValue =
    !didAutoSubmit && contextFinding !== null
      ? `Tell me more about: ${contextFinding.headline}`
      : "";

  // ChatInput key: remount to clear pre-filled value after auto-submit fires
  const chatInputKey = didAutoSubmit ? "post-auto-submit" : (contextFinding?.id ?? "default");

  // Callback passed to both the input and empty-state buttons
  function onQuestion(question: string): void {
    if (!conversationId || isStreaming) return;
    void handleQuestion(question, conversationId);
  }

  // ---------------------------------------------------------------------------
  // Empty-state variant selection (shown only when no messages yet)
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
    emptyStateContent = <UrgentFindingEmptyState finding={urgentFinding} onSubmit={onQuestion} />;
  } else {
    emptyStateContent = <HealthyEmptyState onSubmit={onQuestion} />;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4 border-b border-[var(--border-default)] pb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Ask CFO Lens</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Ask any question about your financial data.
          </p>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={handleNewConversation}
            className="shrink-0 rounded border border-[var(--border-default)] px-3 py-1.5 text-sm text-[var(--text-secondary)] transition-colors duration-100 hover:border-[var(--primary-300)] hover:text-[var(--primary-600)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary-500)]"
          >
            New conversation
          </button>
        )}
      </div>

      {/* Messages thread or empty-state area */}
      {messages.length === 0 && !isStreaming ? (
        <div className="flex min-h-[320px] flex-col">{emptyStateContent}</div>
      ) : (
        <div className="flex flex-col gap-6">
          {messages.map((msg, i) =>
            msg.role === "user" ? (
              <UserMessage key={i} content={msg.content} />
            ) : (
              <AIResponse key={i} content={msg.content} />
            ),
          )}
          {/* Live streaming response — appended below the last user message */}
          {isStreaming && <AIResponse content={streamingContent} isStreaming={true} />}
        </div>
      )}

      {/* Conversation error — subtle inline notice */}
      {convError && (
        <p className="text-sm text-[var(--text-muted)]" role="alert">
          Could not create a conversation session. Please refresh to try again.
        </p>
      )}

      {/* Chat input area */}
      <div className="border-t border-[var(--border-default)] pt-4">
        {/* Queries remaining — shown once the first response arrives */}
        {queriesRemaining !== null && (
          <p className="mb-2 text-right text-xs text-[var(--text-muted)]">
            {queriesRemaining} {queriesRemaining === 1 ? "query" : "queries"} remaining this month
          </p>
        )}

        {quotaExhausted ? (
          // Quota exhaustion state — replaces ChatInput per CLAUDE.md agentic rules
          <div className="rounded-lg border border-[var(--warning-200)] bg-[var(--warning-50)] px-4 py-3 text-sm text-[var(--warning-700)]">
            You&apos;ve reached your monthly query limit.{" "}
            <Link
              href="/settings/billing"
              className="font-medium underline hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary-500)]"
            >
              Upgrade your plan →
            </Link>
          </div>
        ) : (
          /*
           * key forces a remount (resetting textarea value) when:
           *   1. contextFinding changes after initial render (finding_id resolved)
           *   2. after auto-submit fires (clears the pre-filled value)
           */
          <ChatInput
            key={chatInputKey}
            onSubmit={onQuestion}
            disabled={isStreaming || conversationId === null}
            initialValue={chatInitialValue}
          />
        )}

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
