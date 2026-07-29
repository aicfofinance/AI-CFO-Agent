import { describe, expect, it } from "vitest";

import { buildFinancialQAPrompt } from "@/lib/ai/prompts/financial-qa";

/**
 * Unit tests for `buildFinancialQAPrompt` (Step 11.3).
 *
 * The builder is a thin, provider-free formatter: the financial context is
 * injected into the SYSTEM prompt (via `buildSystemPrompt`), so this function
 * only labels the raw question for the user turn. These tests pin the two
 * Definition-of-Done contract points: it returns a `Promise<string>` and the
 * result contains the question verbatim.
 */
describe("buildFinancialQAPrompt", () => {
  const ORG_ID = "22222222-2222-2222-2222-222222222222";

  it("returns a string containing the question verbatim", async () => {
    const question = "What were my top expenses last month?";
    const result = await buildFinancialQAPrompt(ORG_ID, question);

    expect(typeof result).toBe("string");
    expect(result).toContain(question);
  });

  it("returns a Promise<string>", () => {
    const returned = buildFinancialQAPrompt(ORG_ID, "How much cash do I have?");

    expect(returned).toBeInstanceOf(Promise);
    return returned.then((value) => {
      expect(typeof value).toBe("string");
    });
  });
});
