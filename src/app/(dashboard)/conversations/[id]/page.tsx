"use client";

/**
 * /conversations/[id] — Step 11.4-ui.
 *
 * Full Q&A transcript for a single conversation. Fetches the conversation on
 * mount and renders each turn with the appropriate chat component:
 *   - role=user   → UserMessage (right-aligned bubble)
 *   - role=assistant → AIResponse (left border, disclaimer included by the component)
 *
 * Error handling:
 *   401 → redirect to /login
 *   403 → toast + redirect to /dashboard (cross-org access is an auth failure)
 *   404 → redirect to /conversations (conversation genuinely doesn't exist)
 *
 * "Copy answer" appears below each assistant message and writes the message
 * content (without the disclaimer) to the clipboard.
 */

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";

import { AIResponse } from "@/components/chat/AIResponse";
import { UserMessage } from "@/components/chat/UserMessage";
import { DataTimestamp } from "@/components/shared/DataTimestamp";
import type { ConversationDetail, MessageDetail } from "@/types/api";

// ---------------------------------------------------------------------------
// Loading skeleton — shown while the fetch resolves
// ---------------------------------------------------------------------------

function ConversationDetailSkeleton(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <div className="border-b border-[var(--border-default)] pb-6">
        <div className="h-8 w-80 animate-pulse rounded bg-[var(--border-default)]" />
        <div className="mt-1 h-4 w-48 animate-pulse rounded bg-[var(--border-default)]" />
      </div>
      <div className="flex flex-col gap-6">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded bg-[var(--border-default)]" />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ConversationDetailPage(): React.JSX.Element {
  // useParams<{ id: string }>() gives a well-typed return — no index-signature
  // uncertainty. `id` is always a string for this non-catch-all dynamic segment.
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  // Tracks which assistant message was most recently copied (for the "Copied" label).
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    const conversationId = params.id;

    // Defensive guard — in practice the route always provides a non-empty id.
    if (!conversationId) {
      router.push("/conversations");
      return;
    }

    void (async (): Promise<void> => {
      try {
        const res = await fetch(`/api/conversations/${conversationId}`);

        if (res.status === 401) {
          router.push("/login");
          return;
        }
        if (res.status === 403) {
          toast.error("You don't have access to this conversation.");
          router.push("/dashboard");
          return;
        }
        if (res.status === 404) {
          router.push("/conversations");
          return;
        }
        if (!res.ok) {
          toast.error("Failed to load conversation.");
          router.push("/conversations");
          return;
        }

        const json = (await res.json()) as { data: ConversationDetail };
        setConversation(json.data);
      } catch {
        // Network error or stream failure
        toast.error("Failed to load conversation.");
        router.push("/conversations");
      } finally {
        setLoading(false);
      }
    })();
  }, [params.id, router]);

  // Copies the assistant message content to the clipboard.
  // State setters and module imports are stable — empty deps array is correct.
  const copyToClipboard = useCallback(async (message: MessageDetail): Promise<void> => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedId(message.id);
      // Reset the "Copied" label after 2 seconds
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast.error("Failed to copy to clipboard.");
    }
  }, []);

  if (loading || !conversation) {
    return <ConversationDetailSkeleton />;
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border-default)] pb-6">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
            {conversation.title}
          </h1>
          <div className="mt-1">
            <DataTimestamp date={conversation.createdAt} label="Started" />
          </div>
        </div>
        <Link
          href="/ask"
          className="inline-flex items-center rounded bg-[var(--primary-500)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--primary-600)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary-500)]"
        >
          Ask a follow-up
        </Link>
      </div>

      {/* Message transcript */}
      {conversation.messages.length === 0 ? (
        <p className="py-12 text-center text-sm text-[var(--text-secondary)]">
          No messages in this conversation yet.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {conversation.messages.map((message) =>
            message.role === "user" ? (
              <UserMessage key={message.id} content={message.content} />
            ) : (
              /*
               * Assistant turn: AIResponse already renders the financial
               * disclaimer per CLAUDE.md — do not add a second one here.
               * "Copy answer" copies only the message content.
               */
              <div key={message.id} className="flex flex-col gap-1">
                <AIResponse content={message.content} />
                <div className="flex justify-end pr-1">
                  <button
                    type="button"
                    onClick={() => void copyToClipboard(message)}
                    aria-label="Copy answer to clipboard"
                    className="rounded px-3 py-1 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--gray-100)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary-500)]"
                  >
                    {copiedId === message.id ? "Copied" : "Copy answer"}
                  </button>
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
