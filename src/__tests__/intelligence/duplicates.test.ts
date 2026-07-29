import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  amountsWithinTolerance,
  findDuplicateSubscriptionPairs,
  generateDuplicateSubscriptionFinding,
  type DuplicateSubscriptionPair,
} from "@/lib/financial/intelligence/duplicates";

/**
 * Unit tests for the Step 6.6 duplicate subscription scan.
 *
 * The deterministic detector (`findDuplicateSubscriptionPairs`,
 * `amountsWithinTolerance`) is pure and tested directly against fixture charge
 * rows. The finding-generation function is tested with `generateText` and the
 * Drizzle client mocked — the same pattern as `anomaly.test.ts` — so finding
 * storage, the `related_data` shape, and the 429 rate-limit skip are exercised
 * without an Inngest harness or a live database.
 *
 * `detectRateLimitError` is kept REAL (via importOriginal); only `getModel` is
 * stubbed.
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
    // Step 6.7: findings are written via `insertFindingDeduped`, which first runs
    // a same-day dedup SELECT. Resolve it to an empty array so no duplicate is
    // detected and the insert proceeds (the path these tests assert on).
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
    }),
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

const SAMPLE_PAIR: DuplicateSubscriptionPair = {
  vendorName: "Adobe Creative Cloud",
  transaction1Id: "txn-1",
  transaction1Amount: "52.99",
  account1Name: "Business Checking",
  transaction2Id: "txn-2",
  transaction2Amount: "54.99",
  account2Name: "Company Credit Card",
};

/** Arms both `generateText` calls (headline + detail) with trivial text. */
function armSuccessfulPhrasing(): void {
  mocks.generateText
    .mockResolvedValueOnce({ text: "  Possible duplicate subscription  " })
    .mockResolvedValueOnce({ text: "  Adobe appears billed twice.  " });
}

describe("amountsWithinTolerance (pure)", () => {
  it("is true when two amounts are within 10% of their mean", () => {
    expect(amountsWithinTolerance("52.99", "54.99")).toBe(true);
    expect(amountsWithinTolerance("100.00", "100.00")).toBe(true);
  });

  it("is false when the amounts differ by more than 10%", () => {
    expect(amountsWithinTolerance("100.00", "120.00")).toBe(false);
  });

  it("is false when the mean is non-positive", () => {
    expect(amountsWithinTolerance("0.00", "0.00")).toBe(false);
  });
});

describe("findDuplicateSubscriptionPairs (pure)", () => {
  it("case 1: pairs the same vendor across two accounts with amounts within 10%", () => {
    const pairs = findDuplicateSubscriptionPairs([
      {
        id: "txn-1",
        description: "Adobe Creative Cloud",
        amount: "52.99",
        accountId: "acct-A",
        accountName: "Business Checking",
      },
      {
        id: "txn-2",
        description: "Adobe Creative Cloud",
        amount: "54.99",
        accountId: "acct-B",
        accountName: "Company Credit Card",
      },
    ]);

    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.vendorName).toBe("Adobe Creative Cloud");
    expect(pairs[0]?.transaction1Id).toBe("txn-1");
    expect(pairs[0]?.transaction2Id).toBe("txn-2");
    expect(pairs[0]?.account1Name).toBe("Business Checking");
    expect(pairs[0]?.account2Name).toBe("Company Credit Card");
  });

  it("case 2: returns no pair when the amounts differ by more than 10%", () => {
    const pairs = findDuplicateSubscriptionPairs([
      {
        id: "txn-1",
        description: "Adobe Creative Cloud",
        amount: "50.00",
        accountId: "acct-A",
        accountName: "Business Checking",
      },
      {
        id: "txn-2",
        description: "Adobe Creative Cloud",
        amount: "100.00",
        accountId: "acct-B",
        accountName: "Company Credit Card",
      },
    ]);

    expect(pairs).toHaveLength(0);
  });

  it("case 3: returns no pair when both charges are on the same account", () => {
    const pairs = findDuplicateSubscriptionPairs([
      {
        id: "txn-1",
        description: "Adobe Creative Cloud",
        amount: "52.99",
        accountId: "acct-A",
        accountName: "Business Checking",
      },
      {
        id: "txn-2",
        description: "Adobe Creative Cloud",
        amount: "54.99",
        accountId: "acct-A",
        accountName: "Business Checking",
      },
    ]);

    expect(pairs).toHaveLength(0);
  });
});

describe("generateDuplicateSubscriptionFinding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
  });

  it("case 1: writes a duplicate_subscription finding with the correct related_data", async () => {
    armSuccessfulPhrasing();

    const result = await generateDuplicateSubscriptionFinding(ORG_ID, RUN_ID, SAMPLE_PAIR);

    expect(result).toEqual({ status: "created" });
    expect(mocks.generateText).toHaveBeenCalledTimes(2); // headline + detail
    expect(mocks.insertValues).toHaveBeenCalledTimes(1);
    expect(mocks.updateSet).not.toHaveBeenCalled(); // no rate-limit skip

    const inserted = mocks.insertValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(inserted.orgId).toBe(ORG_ID);
    expect(inserted.intelligenceRunId).toBe(RUN_ID);
    expect(inserted.findingType).toBe("duplicate_subscription");
    expect(inserted.severity).toBe("medium");
    expect(inserted.status).toBe("active");
    // duplicate_subscription never expires (CLAUDE.md selective expiry).
    expect(inserted.expiresAt).toBeNull();
    expect(inserted.headline).toBe("Possible duplicate subscription");

    expect(inserted.relatedData).toEqual({
      type: "duplicate_subscription",
      vendorName: "Adobe Creative Cloud",
      transaction1Id: "txn-1",
      transaction1Amount: "52.99",
      account1Name: "Business Checking",
      transaction2Id: "txn-2",
      transaction2Amount: "54.99",
      account2Name: "Company Credit Card",
    });
  });

  it("case 4: a 429 marks the run skipped with reason rate_limit and writes no finding", async () => {
    const rateLimitError = Object.assign(new Error("rate limit exceeded"), { status: 429 });
    mocks.generateText.mockRejectedValueOnce(rateLimitError);

    const result = await generateDuplicateSubscriptionFinding(ORG_ID, RUN_ID, SAMPLE_PAIR);

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

    await expect(generateDuplicateSubscriptionFinding(ORG_ID, RUN_ID, SAMPLE_PAIR)).rejects.toThrow(
      "upstream exploded",
    );

    expect(mocks.updateSet).not.toHaveBeenCalled();
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });
});
