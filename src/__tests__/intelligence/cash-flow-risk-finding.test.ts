import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  generateCashFlowRiskFinding,
  isCashFlowRisk,
  type CashFlowProjection,
} from "@/lib/financial/intelligence/cash-flow";

/**
 * Unit tests for the Step 6.2 cash-flow risk finding logic (extracted from the
 * Inngest runner so it is testable without an Inngest harness — the runner in
 * `jobs/intelligence/run.ts` wires this into two isolated `step.run()` calls).
 *
 * The three Definition-of-Done cases:
 *   1. minimumProjectedBalance >= 0  → not a risk, no finding written.
 *   2. minimumProjectedBalance <  0  → a `cash_flow_risk` finding is written.
 *   3. AI provider returns HTTP 429  → the run is marked `status = 'skipped'`,
 *      `skipped_reason = 'rate_limit'`, no finding is written, nothing is thrown.
 *
 * Mocks (all hoisted so the `vi.mock` factories can close over them):
 *   - `ai` → `generateText` is a spy whose resolved/rejected value is set per test.
 *   - `@/lib/platform/db/client` → `db` exposes `insert().values()` and
 *     `update().set().where()` spies so we can assert exactly what was written.
 *   - `@/lib/env` → a minimal stub so the real router module loads (it reads
 *     `env.AI_PROVIDER`). `detectRateLimitError` is kept REAL (via importOriginal)
 *     so the 429 detection path is genuinely exercised; only `getModel` is stubbed.
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

/**
 * Builds a projection fixture with a given minimum balance and optional risk
 * date. Every monetary field is a DECIMAL string, matching the real shape.
 */
function projectionWith(
  minimumProjectedBalance: string,
  riskDate: string | null,
): CashFlowProjection {
  return {
    orgId: ORG_ID,
    projectedDays: [],
    minimumProjectedBalance,
    riskDate,
    confidenceLevel: "high",
    generatedAt: "2026-07-29T00:00:00.000Z",
  };
}

/**
 * Mirrors the runner's decision in `jobs/intelligence/run.ts`: the finding step
 * runs only when `isCashFlowRisk` is true. Lets us assert case 1 (no finding)
 * end-to-end at the same boundary the runner uses.
 */
async function runFindingStep(
  projection: CashFlowProjection,
): Promise<
  { ran: false } | { ran: true; result: Awaited<ReturnType<typeof generateCashFlowRiskFinding>> }
> {
  if (!isCashFlowRisk(projection)) {
    return { ran: false };
  }
  const result = await generateCashFlowRiskFinding(ORG_ID, RUN_ID, projection);
  return { ran: true, result };
}

describe("isCashFlowRisk", () => {
  it("is false when the projected minimum balance is non-negative", () => {
    expect(isCashFlowRisk(projectionWith("5000.00", null))).toBe(false);
    expect(isCashFlowRisk(projectionWith("0.00", null))).toBe(false);
  });

  it("is true when the projected minimum balance goes negative", () => {
    expect(isCashFlowRisk(projectionWith("-0.01", "2026-08-10"))).toBe(true);
    expect(isCashFlowRisk(projectionWith("-2500.00", "2026-08-10"))).toBe(true);
  });
});

describe("generateCashFlowRiskFinding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-arm the update chain after clearAllMocks wipes call data.
    mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
  });

  it("case 1: writes no finding when the minimum balance is non-negative", async () => {
    const outcome = await runFindingStep(projectionWith("5000.00", null));

    expect(outcome).toEqual({ ran: false });
    expect(mocks.generateText).not.toHaveBeenCalled();
    expect(mocks.insertValues).not.toHaveBeenCalled();
    expect(mocks.updateSet).not.toHaveBeenCalled();
  });

  it("case 2: writes a cash_flow_risk finding when the balance goes negative and AI succeeds", async () => {
    mocks.generateText
      .mockResolvedValueOnce({ text: "  Cash shortfall projected: act now  " })
      .mockResolvedValueOnce({
        text: "  Your cash is projected to run negative. Collect outstanding invoices.  ",
      });

    const outcome = await runFindingStep(projectionWith("-2500.00", "2026-08-10"));

    expect(outcome).toEqual({ ran: true, result: { status: "created" } });
    // Two prompts: one for the headline, one for the detail.
    expect(mocks.generateText).toHaveBeenCalledTimes(2);
    expect(mocks.insertValues).toHaveBeenCalledTimes(1);
    expect(mocks.updateSet).not.toHaveBeenCalled(); // no rate-limit skip

    const inserted = mocks.insertValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(inserted.orgId).toBe(ORG_ID);
    expect(inserted.intelligenceRunId).toBe(RUN_ID);
    expect(inserted.findingType).toBe("cash_flow_risk");
    expect(inserted.severity).toBe("high"); // -2500 is above the -10,000 critical floor
    expect(inserted.status).toBe("active");
    // Model text is trimmed before storage.
    expect(inserted.headline).toBe("Cash shortfall projected: act now");
    // expires_at is UTC midnight the day AFTER the risk date (CLAUDE.md rule).
    expect(inserted.expiresAt).toBeInstanceOf(Date);
    expect((inserted.expiresAt as Date).getTime()).toBe(
      new Date("2026-08-11T00:00:00.000Z").getTime(),
    );
    // Monetary value persisted as the original DECIMAL string, never a number.
    expect(inserted.relatedData).toMatchObject({
      minimumProjectedBalance: "-2500.00",
      riskDate: "2026-08-10",
    });
  });

  it("case 2b: escalates to critical severity below the -10,000 floor", async () => {
    mocks.generateText
      .mockResolvedValueOnce({ text: "Severe cash shortfall" })
      .mockResolvedValueOnce({ text: "Immediate action required." });

    await runFindingStep(projectionWith("-15000.00", "2026-08-10"));

    const inserted = mocks.insertValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(inserted.severity).toBe("critical");
  });

  it("case 2c: hard-caps an over-long model headline at 120 characters", async () => {
    const longHeadline = "A".repeat(200);
    mocks.generateText
      .mockResolvedValueOnce({ text: longHeadline })
      .mockResolvedValueOnce({ text: "Detail." });

    await runFindingStep(projectionWith("-500.00", "2026-08-10"));

    const inserted = mocks.insertValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect((inserted.headline as string).length).toBe(120);
  });

  it("case 3: a 429 marks the run skipped with reason rate_limit and writes no finding", async () => {
    const rateLimitError = Object.assign(new Error("Too Many Requests"), { statusCode: 429 });
    mocks.generateText.mockRejectedValueOnce(rateLimitError);

    const outcome = await runFindingStep(projectionWith("-2500.00", "2026-08-10"));

    expect(outcome).toEqual({ ran: true, result: { status: "skipped", reason: "rate_limit" } });
    // The run row is updated to the skipped state...
    expect(mocks.updateSet).toHaveBeenCalledTimes(1);
    expect(mocks.updateSet).toHaveBeenCalledWith({
      status: "skipped",
      skippedReason: "rate_limit",
    });
    expect(mocks.updateWhere).toHaveBeenCalledTimes(1);
    // ...and no finding is written.
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });

  it("rethrows a non-429 error rather than swallowing it", async () => {
    const boom = Object.assign(new Error("upstream exploded"), { statusCode: 500 });
    mocks.generateText.mockRejectedValueOnce(boom);

    await expect(
      generateCashFlowRiskFinding(ORG_ID, RUN_ID, projectionWith("-2500.00", "2026-08-10")),
    ).rejects.toThrow("upstream exploded");

    expect(mocks.updateSet).not.toHaveBeenCalled();
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });
});
