import { anthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
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
  anthropicComplex: "claude-sonnet-5",
  anthropicRoutine: "claude-haiku-4-5-20251001",
} as const;

// Hoisted once per cold start so createGoogleGenerativeAI() is not re-called on
// every getModel() invocation. The Anthropic provider (imported above) is
// already a module-level singleton — this makes the two providers consistent.
const googleProvider = env.GOOGLE_AI_API_KEY
  ? createGoogleGenerativeAI({ apiKey: env.GOOGLE_AI_API_KEY })
  : createGoogleGenerativeAI();

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

  switch (provider) {
    case "google":
      return googleProvider(MODEL_IDS.google);
    case "anthropic":
      return complexityScore >= SONNET_COMPLEXITY_THRESHOLD
        ? anthropic(MODEL_IDS.anthropicComplex)
        : anthropic(MODEL_IDS.anthropicRoutine);
    default:
      // The env schema enforces z.enum(["anthropic","google"]) so this branch
      // is unreachable in production, but an explicit throw catches a future
      // misconfiguration (new provider added to env before the router handles
      // it) rather than silently routing to Anthropic.
      throw new Error(`Unknown AI_PROVIDER: "${String(provider)}"`);
  }
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
 *
 * Skipping on rate-limit rather than retrying is intentional: these callers are
 * Inngest background steps and a retry would replay the entire function, not
 * just the failing step. The next scheduled intelligence run picks up where this
 * one left off (CLAUDE.md — Intelligence Engine Rules).
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

  // Walk the nested cause: modern fetch/AI SDK errors often wrap the underlying
  // 429 in error.cause rather than surfacing it on the top-level object.
  const cause = err["cause"];
  if (cause !== null && typeof cause === "object") {
    return detectRateLimitError(cause);
  }

  return false;
}
