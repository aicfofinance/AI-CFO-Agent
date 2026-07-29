import { beforeEach, describe, expect, it, vi } from "vitest";

import { getPeriodComparison } from "@/lib/financial/aggregations/trends";
import { calculatePnL } from "@/lib/financial/calculations/pnl";

/**
 * `getPeriodComparison` derives its change percentage from two `calculatePnL()`
 * results, so we mock `calculatePnL` directly rather than the DB client. The
 * function calls it twice: current period first, then prior period.
 */
vi.mock("@/lib/financial/calculations/pnl", () => ({
  calculatePnL: vi.fn(),
}));

const ORG_ID = "22222222-2222-2222-2222-222222222222";
const CUR_START = "2026-02-01";
const CUR_END = "2026-02-28";
const PRIOR_START = "2026-01-01";
const PRIOR_END = "2026-01-31";

const calculatePnLMock = vi.mocked(calculatePnL);

describe("getPeriodComparison", () => {
  beforeEach(() => {
    calculatePnLMock.mockReset();
  });

  it("current=150, prior=100 → changePct='50.00', direction='up' (DoD case)", async () => {
    calculatePnLMock
      .mockResolvedValueOnce({ revenue: "150.00", expenses: "0.00", netProfit: "150.00" })
      .mockResolvedValueOnce({ revenue: "100.00", expenses: "0.00", netProfit: "100.00" });

    const result = await getPeriodComparison(ORG_ID, CUR_START, CUR_END, PRIOR_START, PRIOR_END);

    expect(result.changePct).toBe("50.00");
    expect(result.direction).toBe("up");
    expect(result.currentRevenue).toBe("150.00");
    expect(result.priorRevenue).toBe("100.00");
  });

  it("current=80, prior=100 → direction='down'", async () => {
    calculatePnLMock
      .mockResolvedValueOnce({ revenue: "80.00", expenses: "0.00", netProfit: "80.00" })
      .mockResolvedValueOnce({ revenue: "100.00", expenses: "0.00", netProfit: "100.00" });

    const result = await getPeriodComparison(ORG_ID, CUR_START, CUR_END, PRIOR_START, PRIOR_END);

    expect(result.direction).toBe("down");
    expect(result.changePct).toBe("-20.00");
  });

  it("prior=0 → direction='flat', changePct='0.00'", async () => {
    calculatePnLMock
      .mockResolvedValueOnce({ revenue: "500.00", expenses: "0.00", netProfit: "500.00" })
      .mockResolvedValueOnce({ revenue: "0.00", expenses: "0.00", netProfit: "0.00" });

    const result = await getPeriodComparison(ORG_ID, CUR_START, CUR_END, PRIOR_START, PRIOR_END);

    expect(result.direction).toBe("flat");
    expect(result.changePct).toBe("0.00");
  });
});
