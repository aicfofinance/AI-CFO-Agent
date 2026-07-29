/**
 * Step 11.0 verification script.
 *
 * Confirms the configured AI provider is wired correctly by routing through
 * `getModel()` (the sole model entry point) and streaming a trivial prompt to
 * stdout. With `AI_PROVIDER=google` this uses the free Gemini tier ($0 cost).
 *
 * Run: `pnpm tsx scripts/test-ai-provider.ts`
 *
 * This is a development utility — never imported by application code.
 */
import { streamText } from "ai";

import { getModel } from "@/lib/ai/models/router";
import { env } from "@/lib/env";

async function main(): Promise<void> {
  console.log(`AI_PROVIDER = ${env.AI_PROVIDER ?? "google (default)"}`);
  console.log("Prompt: What is 2+2?");
  console.log("--- streaming response ---");

  const result = streamText({
    model: getModel(0.5),
    prompt: "What is 2+2?",
  });

  for await (const delta of result.textStream) {
    process.stdout.write(delta);
  }

  process.stdout.write("\n--- done ---\n");
  const usage = await result.usage;
  console.log(`Total tokens: ${usage.totalTokens ?? "unknown"}`);
}

main().catch((error: unknown) => {
  console.error("test-ai-provider failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
