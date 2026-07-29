import { sql } from "drizzle-orm";

import { inngest } from "@/lib/inngest";
import { db } from "@/lib/platform/db/client";
import { conversations, messages, queryLog } from "@/lib/platform/db/schema";

/**
 * Message retention cleanup cron. Runs nightly at 03:00.
 *
 * V1 retains 12 months of conversation history. This job is a global,
 * age-based maintenance sweep (not org-scoped): it applies the same retention
 * cutoff to every tenant, so there is no cross-tenant exposure to guard against.
 *
 * Ordering matters and the whole sweep runs in a single transaction:
 *   1. NULL out `query_log.message_id` for any query-log row pointing at a
 *      message about to be deleted. The FK from `query_log` to `messages` has NO
 *      cascade by design (the audit row must outlive the message), which means a
 *      raw DELETE would raise a foreign-key violation. Nulling the reference
 *      first preserves the audit record while releasing the constraint.
 *   2. DELETE messages older than 12 months.
 *   3. DELETE conversations that are themselves older than 12 months AND now
 *      have zero messages. The age guard is deliberate: the `/ask` page
 *      pre-creates an empty conversation before the first question, so deleting
 *      every empty conversation would destroy brand-new sessions. Only
 *      conversations left orphaned by step 2's pruning are removed.
 */
export const messageCleanup = inngest.createFunction(
  { id: "message-cleanup" },
  { cron: "0 3 * * *" },
  async ({ step }): Promise<void> => {
    const result = await step.run("prune-old-messages", async () => {
      return db.transaction(async (tx) => {
        // 1. Release the query_log FK by nulling references to soon-deleted
        //    messages. Keeps the audit trail intact.
        await tx
          .update(queryLog)
          .set({ messageId: null })
          .where(
            sql`${queryLog.messageId} IN (SELECT ${messages.id} FROM ${messages} WHERE ${messages.createdAt} < now() - interval '12 months')`,
          );

        // 2. Delete messages past the 12-month retention window.
        const deletedMessages = await tx
          .delete(messages)
          .where(sql`${messages.createdAt} < now() - interval '12 months'`)
          .returning({ id: messages.id });

        // 3. Delete conversations older than 12 months that no longer have any
        //    messages (orphaned by step 2). Fresh empty conversations are spared
        //    by the age guard.
        const deletedConversations = await tx
          .delete(conversations)
          .where(
            sql`${conversations.createdAt} < now() - interval '12 months' AND NOT EXISTS (SELECT 1 FROM ${messages} WHERE ${messages.conversationId} = ${conversations.id})`,
          )
          .returning({ id: conversations.id });

        return {
          messagesDeleted: deletedMessages.length,
          conversationsDeleted: deletedConversations.length,
        };
      });
    });

    console.log({
      event: "message_cleanup_completed",
      messagesDeleted: result.messagesDeleted,
      conversationsDeleted: result.conversationsDeleted,
    });
  },
);
