import { beforeEach, describe, expect, it, vi } from "vitest";

import { calculatePnL } from "@/lib/financial/calculations/pnl";

/**
 * Mock handles declared via `vi.hoisted` so they are reachable inside the
 * hoisted `vi.mock` factory below. The DB is unreachable in this environment,
 * so we mock the Drizzle client and assert the function's handling of the
 * aggregated SQL result — the actual SUM arithmetic is exercised by Postgres,
 * not by JavaScript.
 */
const mocks = vi.hoisted(() => ({
  ORG_ID: "22222222-2222-2222-2222-222222222222",
  // The single aggregated row the chainable builder resolves to.
  row: undefined as { revenue: string; expenses: string; netProfit: string } | undefined,
}));

// Mock the Drizzle client. `calculatePnL` chains `.select().from().where()`,
// where `.where()` resolves to the row array (Drizzle destructures `[row]`).
vi.mock("@/lib/platform/db/client", () => ({
  db: {
    select: vi.fn(() => ({
      from: () => ({
        where: () => Promise.resolve(mocks.row === undefined ? [] : [mocks.row]),
      }),
    })),
  },
}));

const START = "2026-01-01";
const END = "2026-01-31";

describe("calculatePnL", () => {
  beforeEach(() => {
    mocks.row = undefined;
  });

  it("returns the aggregated revenue, expenses and net profit as strings", async () => {
    mocks.row = { revenue: "5000.00", expenses: "3000.00", netProfit: "2000.00" };

    const result = await calculatePnL(mocks.ORG_ID, START, END);

    // Exact string equality — never toBeCloseTo for monetary values.
    expect(result.revenue).toBe("5000.00");
    expect(result.expenses).toBe("3000.00");
    expect(result.netProfit).toBe("2000.00");
  });

  it("returns zeroed strings when the org has no transactions in range", async () => {
    // COALESCE(..., 0) in SQL yields '0' for an empty range; the builder still
    // returns a row. This asserts the shape when that happens.
    mocks.row = { revenue: "0.00", expenses: "0.00", netProfit: "0.00" };

    const result = await calculatePnL(mocks.ORG_ID, START, END);

    expect(result.revenue).toBe("0.00");
    expect(result.expenses).toBe("0.00");
    expect(result.netProfit).toBe("0.00");
  });

  it("falls back to '0.00' strings when no row is returned at all", async () => {
    mocks.row = undefined;

    const result = await calculatePnL(mocks.ORG_ID, START, END);

    expect(result.revenue).toBe("0.00");
    expect(result.expenses).toBe("0.00");
    expect(result.netProfit).toBe("0.00");
  });

  it("returns monetary values typed as string, never number", async () => {
    mocks.row = { revenue: "145200.00", expenses: "98000.00", netProfit: "47200.00" };

    const result = await calculatePnL(mocks.ORG_ID, START, END);

    expect(typeof result.revenue).toBe("string");
    expect(typeof result.expenses).toBe("string");
    expect(typeof result.netProfit).toBe("string");
    // Two-decimal precision preserved exactly (DoD).
    expect(result.revenue).toBe("145200.00");
  });
});
