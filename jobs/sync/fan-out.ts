import { and, eq, ne } from "drizzle-orm";

import { inngest } from "@/lib/inngest";
import { db } from "@/lib/platform/db/client";
import { connections } from "@/lib/platform/db/schema";

/**
 * Sync fan-out cron. Runs every 6 hours.
 *
 * Queries all active connections that are not in a terminal state
 * (auth_expired or disconnected) and dispatches one `sync/org.requested`
 * event per connection. The per-org sync handler (`sync-single-org`) picks
 * up each event independently, giving Inngest per-org isolation, retry
 * semantics, and step-level observability.
 *
 * Auth-expired connections are intentionally skipped per CLAUDE.md:
 * "401 → sync_status = 'auth_expired', stop, never retry with an expired token."
 * Disconnected connections are skipped because they have been intentionally
 * severed by the user — issuing sync events for them would produce immediate
 * 401s and pollute data_quality_log.
 */
export const syncFanOut = inngest.createFunction(
  { id: "sync-fan-out" },
  { cron: "0 */6 * * *" },
  async ({ step }): Promise<void> => {
    // Query all connections that are active and not in a terminal state.
    // Select only `id` and `orgId` — token values are never read in the fan-out;
    // token handling belongs exclusively to `getQuickBooksClient()` in client.ts.
    const activeConnections = await db
      .select({ id: connections.id, orgId: connections.orgId })
      .from(connections)
      .where(
        and(
          eq(connections.isActive, true),
          ne(connections.syncStatus, "auth_expired"),
          ne(connections.syncStatus, "disconnected"),
          // CSV is a one-time import — there is no external API to poll on a
          // schedule. Exclude CSV connections so the fan-out never dispatches
          // sync/org.requested events for them (avoids SINGLE_ORG_UNKNOWN_PROVIDER).
          ne(connections.provider, "csv"),
        ),
      );

    const count = activeConnections.length;

    if (count === 0) {
      console.log({ event: "sync_fan_out_dispatched", count: 0 });
      return;
    }

    const events = activeConnections.map((conn) => ({
      name: "sync/org.requested" as const,
      data: { connectionId: conn.id, orgId: conn.orgId },
    }));

    await step.sendEvent("dispatch-sync-events", events);

    console.log({ event: "sync_fan_out_dispatched", count });
  },
);
