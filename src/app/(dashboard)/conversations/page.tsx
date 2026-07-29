import { redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";

import { env } from "@/lib/env";
import { DataTimestamp } from "@/components/shared/DataTimestamp";
import type { ConversationSummary } from "@/types/api";

/**
 * /conversations — Step 11.4-ui.
 *
 * Lists all conversations for the org, newest first (first page only — the
 * API returns up to 20 per page via cursor pagination). Forwards the session
 * cookie so the server-side fetch is authenticated. Handles 401 by redirecting
 * to /login before React renders anything.
 *
 * Server Component — no "use client". Data is fetched at request time.
 */

// ---------------------------------------------------------------------------
// Types — shapes returned by GET /api/conversations
// ---------------------------------------------------------------------------

type ConversationsListResponse = {
  data: ConversationSummary[];
  meta: { total: number; nextCursor: string | null };
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function ConversationsPage(): Promise<React.JSX.Element> {
  const baseUrl = env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const cookie = (await headers()).get("cookie") ?? "";

  const res = await fetch(`${baseUrl}/api/conversations`, {
    headers: { cookie },
    cache: "no-store",
  });

  // 401: session expired or absent — redirect before React renders.
  if (res.status === 401) {
    redirect("/login");
  }

  let conversations: ConversationSummary[] = [];

  if (res.ok) {
    const json = (await res.json()) as ConversationsListResponse;
    conversations = json.data;
  }

  return (
    <div>
      {/* Page header */}
      <div className="mb-8 flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border-default)] pb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Conversations</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            All conversations for your organization
          </p>
        </div>
        {/*
         * Export all — plain anchor with download attribute so the browser
         * treats the response as a file download (JSON). No JS needed.
         */}
        <a
          href="/api/conversations/export"
          download
          className="inline-flex items-center rounded border border-[var(--border-default)] bg-white px-3.5 py-2 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--gray-50)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary-500)]"
        >
          Export all
        </a>
      </div>

      {/* Empty state */}
      {conversations.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-lg font-medium text-[var(--text-primary)]">No conversations yet</p>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            Ask your AI CFO a question to get started.
          </p>
          <Link
            href="/ask"
            className="mt-6 inline-flex items-center rounded bg-[var(--primary-500)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--primary-600)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary-500)]"
          >
            Ask a question
          </Link>
        </div>
      ) : (
        /*
         * Conversation list — divide-y creates the row separators; no rounded
         * corners on this data list (CLAUDE.md component rules: rounded-none for
         * financial data tables and lists).
         */
        <div className="divide-y divide-[var(--border-default)] border border-[var(--border-default)]">
          {conversations.map((conv) => (
            <Link
              key={conv.id}
              href={`/conversations/${conv.id}`}
              className="flex items-center justify-between bg-white px-5 py-4 transition-colors hover:bg-[var(--gray-50)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary-500)]"
            >
              <div className="min-w-0">
                <p className="truncate text-[15px] font-medium text-[var(--text-primary)]">
                  {conv.title}
                </p>
                <div className="mt-1 flex items-center gap-3">
                  <DataTimestamp date={conv.lastMessageAt ?? conv.createdAt} label="Last message" />
                  <span className="text-xs text-[var(--text-muted)]">
                    {conv.messageCount} {conv.messageCount === 1 ? "message" : "messages"}
                  </span>
                </div>
              </div>
              {/* Directional cue — decorative arrow, hidden from screen readers */}
              <span className="ml-4 shrink-0 text-sm text-[var(--primary-500)]" aria-hidden="true">
                →
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
