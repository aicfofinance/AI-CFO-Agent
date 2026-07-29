import { describe, expect, it } from "vitest";

import { buildVendorNegotiationPrompt } from "./vendor-negotiation";

describe("buildVendorNegotiationPrompt", () => {
  it("includes the vendor context when provided", () => {
    const result = buildVendorNegotiationPrompt({
      currentMargin: 0.32,
      priorYearMargin: 0.4,
      declinePoints: 8,
      vendorContext: "Global Supplies Ltd",
    });
    expect(result.user).toContain("Global Supplies Ltd");
  });

  it("includes the decline in percentage points", () => {
    const result = buildVendorNegotiationPrompt({
      currentMargin: 0.32,
      priorYearMargin: 0.4,
      declinePoints: 8,
      vendorContext: "Global Supplies Ltd",
    });
    expect(result.user).toContain("8 percentage points");
  });

  it("does not include raw margin figures in the prompt", () => {
    const result = buildVendorNegotiationPrompt({
      currentMargin: 0.32,
      priorYearMargin: 0.4,
      declinePoints: 8,
      vendorContext: "Global Supplies Ltd",
    });
    expect(result.user).not.toContain("0.32");
    expect(result.user).not.toContain("0.4");
  });

  it("falls back to a generic recipient when vendorContext is omitted", () => {
    const result = buildVendorNegotiationPrompt({
      currentMargin: 0.28,
      priorYearMargin: 0.35,
      declinePoints: 7,
    });
    expect(result.user).toContain("a key vendor");
  });

  it("falls back to a generic recipient when vendorContext is blank", () => {
    const result = buildVendorNegotiationPrompt({
      currentMargin: 0.28,
      priorYearMargin: 0.35,
      declinePoints: 7,
      vendorContext: "   ",
    });
    expect(result.user).toContain("a key vendor");
  });

  it("returns a non-empty system prompt", () => {
    const result = buildVendorNegotiationPrompt({
      currentMargin: 0.28,
      priorYearMargin: 0.35,
      declinePoints: 7,
    });
    expect(result.system.length).toBeGreaterThan(20);
  });
});
