import { serve } from "inngest/next";

import { inngest } from "@/lib/inngest";
import { syncFanOut } from "@/jobs/sync/fan-out";
import { syncSingleOrg } from "@/jobs/sync/single-org";
import { intelligenceFanOut } from "@/jobs/intelligence/fan-out";
import { intelligenceRun } from "@/jobs/intelligence/run";
import { intelligenceEmail } from "@/jobs/intelligence/email";
import { messageCleanup } from "@/jobs/billing/reset-quotas";

/**
 * Inngest serve handler — the single registration point for every Inngest
 * function in the codebase. Functions from any layer are added to the
 * `functions` array here; no job self-registers.
 */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    syncFanOut,
    syncSingleOrg,
    intelligenceFanOut,
    intelligenceRun,
    intelligenceEmail,
    messageCleanup,
  ],
});
