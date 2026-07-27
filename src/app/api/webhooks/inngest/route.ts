import { serve } from "inngest/next";

import { inngest } from "@/lib/inngest";
import { syncFanOut } from "@/jobs/sync/fan-out";

/**
 * Inngest serve handler — the single registration point for every Inngest
 * function in the codebase. Functions from any layer are added to the
 * `functions` array here; no job self-registers.
 */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [syncFanOut],
});
