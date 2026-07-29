import { describe, expect, it, vi } from "vitest";

import { buildSystemPrompt } from "./system";

// The financial context builder is mocked so this unit test exercises only the
// prompt-assembly logic in system.ts — not the database or the aggregation layer.
// The stub returns a block containing recognizable real financial numbers so we
// can assert they flow through into the assembled prompt (Step 11.1 DoD:
// "buildSystemPrompt() contains real financial numbers").
vi.mock("@/lib/ai/context/builder", () => ({
  buildFinancialContext: vi
    .fn()
    .mockResolvedValue(
      [
        "=== FINANCIAL CONTEXT ===",
        "Organization: Acme Widgets Inc (growth)",
        "Current cash: $12,450.00",
        "July 2026: Revenue $45,200.00 | Expenses $38,100.00 | Net $7,100.00",
        "=== END FINANCIAL CONTEXT ===",
      ].join("\n"),
    ),
}));

describe("buildSystemPrompt", () => {
  it("injects the org's financial context with real numbers", async () => {
    const prompt = await buildSystemPrompt("org-123");
    expect(prompt).toContain("Acme Widgets Inc");
    expect(prompt).toContain("$45,200.00");
    expect(prompt).toContain("$12,450.00");
  });

  it("includes the currency formatting instruction", async () => {
    const prompt = await buildSystemPrompt("org-123");
    expect(prompt).toContain("CURRENCY FORMATTING");
    // The canonical example format and the Unicode minus sign must be present.
    expect(prompt).toContain("$1,234.56");
    expect(prompt).toContain("−$1,234.56");
    expect(prompt).toContain("$45,000.00 + $12,500.00 = $57,500.00");
  });

  it("includes role and prohibition instructions", async () => {
    const prompt = await buildSystemPrompt("org-123");
    expect(prompt).toContain("AI financial advisor assistant");
    expect(prompt).toContain("PROHIBITED BEHAVIORS");
  });

  it("stays well under the 40,000-character (≈10k token) budget", async () => {
    const prompt = await buildSystemPrompt("org-123");
    expect(prompt.length).toBeLessThan(40_000);
  });
});
