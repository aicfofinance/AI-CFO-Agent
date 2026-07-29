import { afterEach, describe, expect, it, vi } from "vitest";

import { detectRateLimitError, getModel } from "./router";

/**
 * The env module is mocked with a mutable `AI_PROVIDER` field so each test can
 * flip the provider without reloading modules. `getModel()` reads
 * `env.AI_PROVIDER` on every call, so mutating this hoisted object between
 * tests is sufficient. Held via `vi.hoisted` so the mutable state exists before
 * the hoisted `vi.mock` factory runs (and so it is typed as mutable, unlike the
 * real readonly `env` export).
 */
const mockEnv = vi.hoisted(() => ({
  env: { AI_PROVIDER: "google" as "anthropic" | "google" | undefined },
}));

vi.mock("@/lib/env", () => mockEnv);

/**
 * The provider factories are mocked to echo their model id into a plain object.
 * This keeps the test free of network/key requirements and lets us assert on
 * the id string that the router passed to each provider.
 */
vi.mock("@ai-sdk/google", () => ({
  google: vi.fn((modelId: string) => ({ modelId, provider: "google" })),
}));
vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: vi.fn((modelId: string) => ({ modelId, provider: "anthropic" })),
}));

function setProvider(provider: "anthropic" | "google" | undefined): void {
  mockEnv.env.AI_PROVIDER = provider;
}

/** Narrow the mocked model object to read its `modelId` in assertions. */
function modelIdOf(model: unknown): string {
  return (model as { modelId: string }).modelId;
}

afterEach(() => {
  setProvider("google");
  vi.clearAllMocks();
});

describe("getModel", () => {
  it("returns a Gemini model when AI_PROVIDER=google", () => {
    setProvider("google");

    const model = getModel();

    expect(modelIdOf(model)).toContain("gemini");
  });

  it("defaults to Gemini when AI_PROVIDER is unset", () => {
    setProvider(undefined);

    const model = getModel();

    expect(modelIdOf(model)).toContain("gemini");
  });

  it("returns a Claude model when AI_PROVIDER=anthropic", () => {
    setProvider("anthropic");

    const model = getModel();

    expect(modelIdOf(model)).toContain("claude");
  });

  it("routes high complexity (>= 0.7) to Sonnet", () => {
    setProvider("anthropic");

    const model = getModel(0.8);

    expect(modelIdOf(model)).toContain("claude-sonnet");
  });

  it("routes complexity exactly at the 0.7 threshold to Sonnet", () => {
    setProvider("anthropic");

    const model = getModel(0.7);

    expect(modelIdOf(model)).toContain("claude-sonnet");
  });

  it("routes low complexity (< 0.7) to Haiku", () => {
    setProvider("anthropic");

    const model = getModel(0.3);

    expect(modelIdOf(model)).toContain("claude-haiku");
  });

  it("routes the default complexity (0.5) to Haiku", () => {
    setProvider("anthropic");

    const model = getModel();

    expect(modelIdOf(model)).toContain("claude-haiku");
  });
});

describe("detectRateLimitError", () => {
  it("returns true for an error with statusCode 429 (AI SDK shape)", () => {
    expect(detectRateLimitError({ statusCode: 429, message: "boom" })).toBe(true);
  });

  it("returns true for an error with status 429", () => {
    const err = Object.assign(new Error("Request failed"), { status: 429 });

    expect(detectRateLimitError(err)).toBe(true);
  });

  it("returns true when the message mentions rate_limit", () => {
    expect(detectRateLimitError(new Error("rate_limit_error: slow down"))).toBe(true);
  });

  it("returns true when the message mentions too many requests", () => {
    expect(detectRateLimitError(new Error("429 Too Many Requests"))).toBe(true);
  });

  it("returns true when the message mentions quota", () => {
    expect(detectRateLimitError(new Error("You exceeded your current quota"))).toBe(true);
  });

  it("returns false for a generic error", () => {
    expect(detectRateLimitError(new Error("Something else went wrong"))).toBe(false);
  });

  it("returns false for a non-429 HTTP status", () => {
    expect(detectRateLimitError({ status: 500, message: "server error" })).toBe(false);
  });

  it("returns false for null and primitive inputs", () => {
    expect(detectRateLimitError(null)).toBe(false);
    expect(detectRateLimitError(undefined)).toBe(false);
    expect(detectRateLimitError("429")).toBe(false);
    expect(detectRateLimitError(429)).toBe(false);
  });
});
