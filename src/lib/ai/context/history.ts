import type { CoreMessage } from "ai";
import { desc, eq } from "drizzle-orm";

import { db } from "@/lib/platform/db/client";
import { messages } from "@/lib/platform/db/schema";

/**
 * Loads window-trimmed conversation history for injection into a Q&A turn
 * (Step 11.3).
 *
 * Only the most recent `limit` (default 20) messages are loaded — the newest-N
 * are fetched with `ORDER BY created_at DESC LIMIT N` and then reversed to
 * chronological (oldest-first) order, which is the order the AI SDK's `messages`
 * array expects. This satisfies CLAUDE.md's "load the last 20 messages maximum"
 * window-trimming rule (oldest turns fall out of the window first).
 *
 * The query filters by `conversation_id` only. `messages` is an org-scoped table,
 * but the caller (`POST /api/conversations/:id/messages`) verifies the parent
 * conversation belongs to the session org BEFORE calling this function, so the
 * conversation id passed here is already org-authorised — the history is
 * transitively org-scoped. This function is never called with an unverified id.
 *
 * Rows whose `role` is neither `user` nor `assistant` are skipped defensively;
 * `CoreMessage` only models conversational turns.
 *
 * @param conversationId Org-verified conversation id (see note above).
 * @param limit          Maximum turns to load. Defaults to 20.
 * @returns Prior turns as `CoreMessage[]` in chronological order; `[]` when the
 *   conversation has no messages yet.
 */
export async function loadConversationHistory(
  conversationId: string,
  limit = 20,
): Promise<CoreMessage[]> {
  const rows = await db
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(limit);

  // Rows arrive newest-first (for the LIMIT to select the most recent N); reverse
  // to oldest-first so the model reads the conversation in order.
  const chronological = rows.slice().reverse();

  const history: CoreMessage[] = [];
  for (const row of chronological) {
    if (row.role === "user") {
      history.push({ role: "user", content: row.content });
    } else if (row.role === "assistant") {
      history.push({ role: "assistant", content: row.content });
    }
  }

  return history;
}
