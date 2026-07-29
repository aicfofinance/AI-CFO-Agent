import { beforeEach, describe, expect, it, vi } from "vitest";

import { detectRecurringExpenses } from "@/lib/financial/intelligence/cash-flow";

/**
 * The DB is unreachable in this environment, so we mock the Drizzle client and
 * feed the function pre-shaped rows. `detectRecurringExpenses` chains
 * `.select().from().where().orderBy()`, where `.orderBy()` resolves to the row
 * array. The recurrence detection (gap + amount-stability + median) is pure
 * JavaScript and is exactly what these cases exercise.
 */
const mocks = vi.hoisted(() => ({
  ORG_ID: "22222222-2222-2222-2222-222222222222",
  rows: [] as { vendorName: string | null; transactionDate: string; amount: string }[],
}));

vi.mock("@/lib/platform/db/client", () => ({
  db: {
    select: vi.fn(() => ({
      from: () => ({
        where: () => ({
          orderBy: () => Promise.resolve(mocks.rows),
        }),
      }),
    })),
  },
}));

const MS_PER_DAY = 86_400_000;

// Same UTC-anchored arithmetic the implementation uses, so the expected
// next-charge date is derived, not hand-transcribed.
function addDaysUtc(dateStr: string, days: number): string {
  return new Date(Date.parse(`${dateStr}T00:00:00Z`) + days * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
}

describe("detectRecurringExpenses", () => {
  beforeEach(() => {
    mocks.rows = [];
  });

  it("detects a monthly AWS subscription with the median amount and next date", async () => {
    // Three AWS charges on a 30-day cycle: days 0, 30, 60.
    const day0 = "2026-05-01";
    const day30 = "2026-05-31";
    const day60 = "2026-06-30";
    mocks.rows = [
      { vendorName: "AWS", transactionDate: day0, amount: "100.00" },
      { vendorName: "AWS", transactionDate: day30, amount: "102.00" },
      { vendorName: "AWS", transactionDate: day60, amount: "101.00" },
    ];

    const result = await detectRecurringExpenses(mocks.ORG_ID);

    expect(result).toHaveLength(1);
    const aws = result[0];
    expect(aws).toBeDefined();
    expect(aws?.vendorName).toBe("AWS");
    expect(aws?.cycledays).toBe(30);
    expect(aws?.occurrences).toBe(3);
    // Median of {100.00, 101.00, 102.00} is the middle sorted value: 101.00.
    expect(aws?.expectedAmount).toBe("101.00");
    // Next expected charge = last charge (day 60) + cycledays (30).
    expect(aws?.nextExpectedDate).toBe(addDaysUtc(day60, 30));
    // And it is a valid ISO date string.
    expect(aws?.nextExpectedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("excludes a vendor whose charges are not on a 25–35 day cycle", async () => {
    mocks.rows = [
      // AWS: valid 30-day cycle — should be detected.
      { vendorName: "AWS", transactionDate: "2026-05-01", amount: "100.00" },
      { vendorName: "AWS", transactionDate: "2026-05-31", amount: "100.00" },
      // Office Depot: two charges only 5 days apart — not recurring.
      { vendorName: "Office Depot", transactionDate: "2026-06-01", amount: "50.00" },
      { vendorName: "Office Depot", transactionDate: "2026-06-06", amount: "50.00" },
    ];

    const result = await detectRecurringExpenses(mocks.ORG_ID);

    expect(result.map((r) => r.vendorName)).toEqual(["AWS"]);
    expect(result.some((r) => r.vendorName === "Office Depot")).toBe(false);
  });

  it("returns an empty array when the org has no expenses", async () => {
    mocks.rows = [];

    const result = await detectRecurringExpenses(mocks.ORG_ID);

    expect(result).toEqual([]);
    expect(Array.isArray(result)).toBe(true);
  });
});
