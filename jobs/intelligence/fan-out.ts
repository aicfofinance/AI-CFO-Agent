import { notInArray } from "drizzle-orm";

import { inngest } from "@/lib/inngest";
import { db } from "@/lib/platform/db/client";
import { connections } from "@/lib/platform/db/schema";

/**
 * Intelligence fan-out cron. Runs daily at 06:00.
 *
 * Queries every org that has at least one connection not in a terminal state
 * (auth_expired or disconnected) and dispatches one `intelligence/run.requested`
 * event per org with `runType: 'scheduled'`. The per-org intelligence handler
 * (`intelligence-run`) picks up each event independently, giving Inngest per-org
 * isolation, retry semantics, and step-level observability — and, critically,
 * keeping each org's five analysis steps within the Vercel Hobby 10-second
 * per-invocation budget (a single combined invocation for all orgs could not).
 *
 * Auth-expired and disconnected connections are excluded: an auth-expired
 * connection's data is stale and its next sync will fail until re-authorised,
 * and a disconnected connection has been intentionally severed by the user.
 * Running the intelligence engine for either would surface findings against a
 * dataset the org can no longer refresh. The per-org run applies its own guards
 * (60-day history minimum, most-recent-sync-completed) on top of this filter.
 */
export const intelligenceFanOut = inngest.createFunction(
  { id: "intelligence-fan-out" },
  { cron: "0 6 * * *" },
  async ({ step }): Promise<void> => {
    // Distinct org ids with a non-terminal connection. `selectDistinct` collapses
    // multiple connections for the same org (the QB/Xero mutual-exclusivity
    // constraint makes >1 active accounting connection impossible, but a CSV or
    // future connection type could coexist) into a single intelligence run.
    const activeOrgs = await step.run("get-active-orgs", async (): Promise<string[]> => {
      const rows = await db
        .selectDistinct({ orgId: connections.orgId })
        .from(connections)
        .where(notInArray(connections.syncStatus, ["auth_expired", "disconnected"]));

      return rows.map((row) => row.orgId);
    });

    const count = activeOrgs.length;

    if (count === 0) {
      console.log({ event: "intelligence_fan_out_dispatched", count: 0 });
      return;
    }

    const events = activeOrgs.map((orgId) => ({
      name: "intelligence/run.requested" as const,
      data: { orgId, runType: "scheduled" as const },
    }));

    await step.sendEvent("dispatch-intelligence-events", events);

    console.log({ event: "intelligence_fan_out_dispatched", count });
  },
);
