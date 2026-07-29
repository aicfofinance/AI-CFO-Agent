import { beforeEach, describe, expect, it, vi } from "vitest";

import { getExpensesByCategory } from "@/lib/financial/aggregations/categories";

/**
 * The DB is unreachable in this environment, so we mock the Drizzle client and
 * assert the function's handling of the aggregated SQL result. The real SUM /
 * window arithmetic is exercised by Postgres, not JavaScript.
 *
 * `getExpensesByCategory` chains `.select().from().where().groupBy().orderBy()`,
 * where `.orderBy()` resolves to the row array.
 */
const mocks = vi.hoisted(() => ({
  ORG_ID: "22222222-2222-2222-2222-222222222222",
  rows: [] as { category: string; amount: string; sharePct: string }[],
}));

vi.mock("@/lib/platform/db/client", () => ({
  db: {
    select: vi.fn(() => ({
      from: () => ({
        where: () => ({
          groupBy: () => ({
            orderBy: () => Promise.resolve(mocks.rows),
          }),
        }),
      }),
    })),
  },
}));

const START = "2026-01-01";
const END = "2026-01-31";

describe("getExpensesByCategory", () => {
  beforeEach(() => {
    mocks.rows = [];
  });

  it("returns rows sorted by amount descending (as ordered by SQL)", async () => {
    // SQL orders by SUM DESC; the function preserves that ordering.
    mocks.rows = [
      { category: "payroll", amount: "5000.00", sharePct: "50.0000" },
      { category: "software", amount: "3000.00", sharePct: "30.0000" },
      { category: "rent", amount: "2000.00", sharePct: "20.0000" },
    ];

    const result = await getExpensesByCategory(mocks.ORG_ID, START, END);

    expect(result.map((r) => r.category)).toEqual(["payroll", "software", "rent"]);
    const amounts = result.map((r) => Number(r.amount));
    expect(amounts).toEqual([...amounts].sort((a, b) => b - a));
  });

  it("returns sharePct as a string with four decimal places", async () => {
    mocks.rows = [{ category: "payroll", amount: "5000.00", sharePct: "50.0000" }];

    const result = await getExpensesByCategory(mocks.ORG_ID, START, END);

    expect(result[0]).toBeDefined();
    expect(typeof result[0]?.sharePct).toBe("string");
    expect(result[0]?.sharePct).toMatch(/^\d+\.\d{4}$/);
    expect(result[0]?.sharePct).toBe("50.0000");
  });

  it("returns an empty array when the org has no expenses in range", async () => {
    mocks.rows = [];

    const result = await getExpensesByCategory(mocks.ORG_ID, START, END);

    expect(result).toEqual([]);
    expect(Array.isArray(result)).toBe(true);
  });
});
