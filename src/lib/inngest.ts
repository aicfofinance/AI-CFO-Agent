import { Inngest } from "inngest";

/**
 * The Inngest client singleton.
 *
 * `id` identifies this application to Inngest. In local development the client
 * runs without credentials against the Inngest dev server. In production the
 * SDK reads `INNGEST_SIGNING_KEY` and `INNGEST_EVENT_KEY` from the environment
 * automatically (both are validated in `@/lib/env`).
 *
 * Every Inngest function is created from this client and served from the single
 * handler in `src/app/api/webhooks/inngest/route.ts`.
 */
export const inngest = new Inngest({ id: "ai-cfo-agent" });
