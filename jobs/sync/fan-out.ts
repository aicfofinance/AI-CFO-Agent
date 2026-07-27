import { inngest } from "@/lib/inngest";

/**
 * Sync fan-out cron. Runs every 6 hours and, once implemented in Step 4.9,
 * dispatches one sync event per active connection.
 *
 * Stub: the handler is intentionally a no-op until Step 4.9.
 */
export const syncFanOut = inngest.createFunction(
  { id: "sync-fan-out" },
  { cron: "0 */6 * * *" },
  async (): Promise<void> => {
    // Stub — implementation in Step 4.9.
  },
);
