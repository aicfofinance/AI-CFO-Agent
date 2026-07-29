import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import type { LanguageModelV1 } from "ai";

import { env } from "@/lib/env";

/**
 * Central AI model router.
 *
 * This is the ONLY file in the codebase permitted to import `anthropic` from
 * `@ai-sdk/anthropic` or `google` from `@ai-sdk/google`. The ESLint
 * `no-restricted-imports` rule forbids those imports everywhere else, and this
 * file is the single documented exception. Every other module — prompts,
 * streaming, intelligence steps, report generation — obtains a model exclusively
 * through `getModel()`. Never import a provider directly to "save a hop."
 */

/**
 * Complexity score above which Anthropic routing selects the larger Sonnet
 * model instead of Haiku. Routine tasks (draft generation, simple Q&A) sit at
 * or below the default 0.5 and route to Haiku; complex financial analysis
 * scores 0.7+ and routes to Sonnet.
 */
const SONNET_COMPLEXITY_THRESHOLD = 0.7;

const MODEL_IDS = {
  google: "gemini-2.0-flash",
  anthropicComplex: "claude-sonnet-4-5",
  anthropicRoutine: "claude-haiku-4-5-20251001",
} as const;

/**
 * Returns a language model instance for the configured provider.
 *
 * Provider selection is driven by `AI_PROVIDER`:
 * - `google` → always `gemini-2.0-flash` (complexity is ignored; the free tier
 *   uses a single model).
 * - `anthropic` → complexity-routed: `>= 0.7` returns Sonnet, otherwise Haiku.
 *
 * `AI_PROVIDER` is optional in the env schema and defaults to `google` here so
 * local development works against the free Gemini tier without extra config.
 *
 * @param complexityScore 0.0 (simple) to 1.0 (complex). Defaults to 0.5.
 */
export function getModel(complexityScore = 0.5): LanguageModelV1 {
  const provider = env.AI_PROVIDER ?? "google";

  if (provider === "google") {
    return google(MODEL_IDS.google);
  }

  // provider === "anthropic"
  if (complexityScore >= SONNET_COMPLEXITY_THRESHOLD) {
    return anthropic(MODEL_IDS.anthropicComplex);
  }

  return anthropic(MODEL_IDS.anthropicRoutine);
}

const RATE_LIMIT_MESSAGE_PATTERNS = [
  "rate_limit",
  "rate limit",
  "too many requests",
  "quota",
] as const;

/**
 * Reads a numeric HTTP status off an unknown error shape, checking the property
 * names used across the AI SDK (`statusCode`) and various HTTP clients
 * (`status`). Returns `undefined` when no numeric status is present.
 */
function extractStatus(error: Record<string, unknown>): number | undefined {
  const status = error["status"];
  if (typeof status === "number") {
    return status;
  }

  const statusCode = error["statusCode"];
  if (typeof statusCode === "number") {
    return statusCode;
  }

  return undefined;
}

/**
 * Returns `true` when the given error represents an HTTP 429 / rate-limit
 * condition from an AI provider.
 *
 * Intelligence steps and streaming handlers use this to distinguish a
 * rate-limit (which must be skipped cleanly — never retried, never failed over
 * to a different provider) from a genuine failure. Detection is intentionally
 * permissive across error shapes because the AI SDK, the underlying fetch layer,
 * and provider SDKs surface rate limits differently.
 */
export function detectRateLimitError(error: unknown): boolean {
  if (error === null || typeof error !== "object") {
    return false;
  }

  const err = error as Record<string, unknown>;

  if (extractStatus(err) === 429) {
    return true;
  }

  const message = err["message"];
  if (typeof message === "string") {
    const normalized = message.toLowerCase();
    if (RATE_LIMIT_MESSAGE_PATTERNS.some((pattern) => normalized.includes(pattern))) {
      return true;
    }
  }

  return false;
}
