import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  computeGrossMargin,
  generateCollectionsSlippageFinding,
  generateExpenseSpikeFinding,
  generateMarginAlertFinding,
  hasSufficientMarginHistory,
  isExpenseSpike,
  isMarginDecline,
} from "@/lib/financial/intelligence/anomaly";

/**
 * Unit tests for the Step 6.3 (anomaly) and Step 6.4 (margin) intelligence logic.
 *
 * The deterministic decision helpers (`isExpenseSpike`, `computeGrossMargin`,
 * `isMarginDecline`, `hasSufficientMarginHistory`) are pure and tested directly.
 * The finding-generation functions are tested with `generateText` and the Drizzle
 * client mocked — the same pattern as `cash-flow-risk-finding.test.ts` — so finding
 * storage and the 429 rate-limit skip are exercised without an Inngest harness or a
 * live database.
 *
 * `detectRateLimitError` is kept REAL (via importOriginal) so the 429 detection
 * path is genuinely exercised; only `getModel` is stubbed.
 */
const mocks = vi.hoisted(() => {
  const updateWhere = vi.fn<(predicate?: unknown) => Promise<void>>();
  return {
    generateText: vi.fn<(options: Record<string, unknown>) => Promise<{ text: string }>>(),
    insertValues: vi.fn<(values: Record<string, unknown>) => Promise<void>>(),
    updateWhere,
    updateSet: vi.fn<(values: Record<string, unknown>) => { where: typeof updateWhere }>(() => ({
      where: updateWhere,
    })),
  };
});

vi.mock("ai", () => ({
  generateText: mocks.generateText,
}));

vi.mock("@/lib/platform/db/client", () => ({
  db: {
    insert: () => ({ values: mocks.insertValues }),
    update: () => ({ set: mocks.updateSet }),
  },
}));

vi.mock("@/lib/env", () => ({
  env: { AI_PROVIDER: "google" as const },
}));

vi.mock("@/lib/ai/models/router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/models/router")>();
  return {
    ...actual,
    // Stub only the model factory; keep the real detectRateLimitError.
    getModel: vi.fn(() => ({}) as never),
  };
});

const ORG_ID = "22222222-2222-2222-2222-222222222222";
const RUN_ID = "33333333-3333-3333-3333-333333333333";

/** Arms both `generateText` calls (headline + detail) with trivial text. */
function armSuccessfulPhrasing(): void {
  mocks.generateText
    .mockResolvedValueOnce({ text: "  A headline  " })
    .mockResolvedValueOnce({ text: "  A detail explanation.  " });
}

describe("isExpenseSpike (pure)", () => {
  it("case 1: is true when the 7-day average exceeds the 30-day average by > threshold", () => {
    // 200 > 100 * 1.25 → spike.
    expect(isExpenseSpike("200.00", "100.00", 0.25)).toBe(true);
  });

  it("case 2: is false when the 7-day average is within the threshold band", () => {
    // 110 is not > 100 * 1.25 (125) → no spike.
    expect(isExpenseSpike("110.00", "100.00", 0.25)).toBe(false);
    // Exactly at the boundary is not a spike (strict greater-than).
    expect(isExpenseSpike("125.00", "100.00", 0.25)).toBe(false);
  });

  it("is false when the 30-day baseline is non-positive", () => {
    expect(isExpenseSpike("500.00", "0.00", 0.25)).toBe(false);
  });
});

describe("computeGrossMargin (pure)", () => {
  it("derives the margin percentage from revenue and expenses", () => {
    // (1000 - 600) / 1000 * 100 = 40.
    expect(computeGrossMargin("1000.00", "600.00")).toBe(40);
  });

  it("returns null when revenue is non-positive (margin undefined)", () => {
    expect(computeGrossMargin("0.00", "600.00")).toBeNull();
  });
});

describe("isMarginDecline (pure)", () => {
  it("is true for a drop greater than 10 percentage points", () => {
    expect(isMarginDecline(20, 55)).toBe(true);
  });

  it("is false for a drop within 10 percentage points", () => {
    expect(isMarginDecline(48, 55)).toBe(false);
  });
});

describe("hasSufficientMarginHistory (pure)", () => {
  it("case 6: is false when the earliest transaction is under 12 months old", () => {
    // Earliest data is 2026-03-01; 'now' is 2026-07-29 → under a year → skip.
    expect(hasSufficientMarginHistory("2026-03-01", new Date("2026-07-29T00:00:00Z"))).toBe(false);
  });

  it("case 6: is false when the org has no transactions", () => {
    expect(hasSufficientMarginHistory(null, new Date("2026-07-29T00:00:00Z"))).toBe(false);
  });

  it("is true when the earliest transaction is at least 12 months old", () => {
    expect(hasSufficientMarginHistory("2025-01-01", new Date("2026-07-29T00:00:00Z"))).toBe(true);
  });
});

describe("generateExpenseSpikeFinding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
  });

  it("case 1: writes an anomaly finding with related_data.type='expense_spike'", async () => {
    armSuccessfulPhrasing();

    const result = await generateExpenseSpikeFinding(ORG_ID, RUN_ID, {
      amount7d: "500.00",
      amount30d: "200.00",
    });

    expect(result).toEqual({ status: "created" });
    expect(mocks.generateText).toHaveBeenCalledTimes(2); // headline + detail
    expect(mocks.insertValues).toHaveBeenCalledTimes(1);
    expect(mocks.updateSet).not.toHaveBeenCalled(); // no rate-limit skip

    const inserted = mocks.insertValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(inserted.orgId).toBe(ORG_ID);
    expect(inserted.intelligenceRunId).toBe(RUN_ID);
    expect(inserted.findingType).toBe("anomaly");
    expect(inserted.severity).toBe("medium");
    expect(inserted.status).toBe("active");
    // Anomaly findings never expire (CLAUDE.md selective expiry).
    expect(inserted.expiresAt).toBeNull();
    // Model text is trimmed before storage.
    expect(inserted.headline).toBe("A headline");
    expect(inserted.relatedData).toEqual({
      type: "expense_spike",
      amount7d: "500.00",
      amount30d: "200.00",
    });
  });

  it("case 4: a 429 marks the run skipped with reason rate_limit and writes no finding", async () => {
    const rateLimitError = Object.assign(new Error("Too Many Requests"), { statusCode: 429 });
    mocks.generateText.mockRejectedValueOnce(rateLimitError);

    const result = await generateExpenseSpikeFinding(ORG_ID, RUN_ID, {
      amount7d: "500.00",
      amount30d: "200.00",
    });

    expect(result).toEqual({ status: "skipped", reason: "rate_limit" });
    expect(mocks.updateSet).toHaveBeenCalledTimes(1);
    expect(mocks.updateSet).toHaveBeenCalledWith({
      status: "skipped",
      skippedReason: "rate_limit",
    });
    expect(mocks.updateWhere).toHaveBeenCalledTimes(1);
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });

  it("rethrows a non-429 error rather than swallowing it", async () => {
    const boom = Object.assign(new Error("upstream exploded"), { statusCode: 500 });
    mocks.generateText.mockRejectedValueOnce(boom);

    await expect(
      generateExpenseSpikeFinding(ORG_ID, RUN_ID, { amount7d: "500.00", amount30d: "200.00" }),
    ).rejects.toThrow("upstream exploded");

    expect(mocks.updateSet).not.toHaveBeenCalled();
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });
});

describe("generateCollectionsSlippageFinding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
  });

  it("case 3: writes an anomaly finding with related_data.type='collections_slippage'", async () => {
    armSuccessfulPhrasing();

    const result = await generateCollectionsSlippageFinding(ORG_ID, RUN_ID, {
      daysOutstanding: 62,
      invoiceCount: 3,
    });

    expect(result).toEqual({ status: "created" });
    expect(mocks.insertValues).toHaveBeenCalledTimes(1);

    const inserted = mocks.insertValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(inserted.findingType).toBe("anomaly");
    expect(inserted.severity).toBe("medium");
    expect(inserted.expiresAt).toBeNull();
    expect(inserted.relatedData).toEqual({
      type: "collections_slippage",
      daysOutstanding: 62,
      invoiceCount: 3,
    });
  });
});

describe("generateMarginAlertFinding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
  });

  it("case 5: writes a high-severity margin_alert for a >= 30-point decline", async () => {
    armSuccessfulPhrasing();

    const result = await generateMarginAlertFinding(ORG_ID, RUN_ID, {
      currentMargin: 20,
      priorYearMargin: 55,
      declinePoints: 35,
    });

    expect(result).toEqual({ status: "created" });
    expect(mocks.insertValues).toHaveBeenCalledTimes(1);

    const inserted = mocks.insertValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(inserted.findingType).toBe("margin_alert");
    expect(inserted.severity).toBe("high"); // 35-point drop >= 30 → high
    expect(inserted.expiresAt).toBeNull();
    expect(inserted.relatedData).toEqual({
      currentMargin: 20,
      priorYearMargin: 55,
      declinePoints: 35,
    });
  });

  it("writes a medium-severity margin_alert for a decline below 30 points", async () => {
    armSuccessfulPhrasing();

    await generateMarginAlertFinding(ORG_ID, RUN_ID, {
      currentMargin: 40,
      priorYearMargin: 55,
      declinePoints: 15,
    });

    const inserted = mocks.insertValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(inserted.severity).toBe("medium");
  });

  it("case 4 (margin): a 429 marks the run skipped and writes no finding", async () => {
    const rateLimitError = Object.assign(new Error("rate limit exceeded"), { status: 429 });
    mocks.generateText.mockRejectedValueOnce(rateLimitError);

    const result = await generateMarginAlertFinding(ORG_ID, RUN_ID, {
      currentMargin: 20,
      priorYearMargin: 55,
      declinePoints: 35,
    });

    expect(result).toEqual({ status: "skipped", reason: "rate_limit" });
    expect(mocks.updateSet).toHaveBeenCalledWith({
      status: "skipped",
      skippedReason: "rate_limit",
    });
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });
});
