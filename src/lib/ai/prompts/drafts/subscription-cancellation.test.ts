import { describe, expect, it } from "vitest";

import { buildSubscriptionCancellationPrompt } from "./subscription-cancellation";

const BASE_INPUT = {
  vendorName: "Zoom Video",
  transaction1Amount: "149.90",
  transaction1Id: "TXN-1001",
  account1Name: "Software Subscriptions",
  transaction2Amount: "149.90",
  transaction2Id: "TXN-1002",
  account2Name: "Operations",
} as const;

describe("buildSubscriptionCancellationPrompt", () => {
  it("includes the vendor name in the user prompt", () => {
    const result = buildSubscriptionCancellationPrompt({ ...BASE_INPUT });
    expect(result.user).toContain("Zoom Video");
  });

  it("includes both transaction amounts", () => {
    const result = buildSubscriptionCancellationPrompt({
      ...BASE_INPUT,
      transaction1Amount: "99.00",
      transaction2Amount: "129.50",
    });
    expect(result.user).toContain("99.00");
    expect(result.user).toContain("129.50");
  });

  it("includes both account names", () => {
    const result = buildSubscriptionCancellationPrompt({ ...BASE_INPUT });
    expect(result.user).toContain("Software Subscriptions");
    expect(result.user).toContain("Operations");
  });

  it("references both transaction IDs", () => {
    const result = buildSubscriptionCancellationPrompt({ ...BASE_INPUT });
    expect(result.user).toContain("TXN-1001");
    expect(result.user).toContain("TXN-1002");
  });

  it("returns a non-empty system prompt", () => {
    const result = buildSubscriptionCancellationPrompt({ ...BASE_INPUT });
    expect(result.system.length).toBeGreaterThan(20);
  });
});
