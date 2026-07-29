import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ArAgingSchedule } from "@/lib/financial/intelligence/ar-aging";
import {
  buildCashFlowProjection,
  detectRecurringExpenses,
} from "@/lib/financial/intelligence/cash-flow";

/**
 * The DB is unreachable in this environment, so we mock the Drizzle client and
 * feed the functions pre-shaped rows.
 *
 * Two distinct query shapes flow through the mocked client:
 *   - `detectRecurringExpenses` chains `.select().from().where().orderBy()`,
 *     where `.orderBy()` resolves to `mocks.rows`.
 *   - the confidence query in `buildCashFlowProjection` chains
 *     `.select().from().where()` and awaits the builder itself, which resolves
 *     (via `then`) to `mocks.minDateRows`.
 * The builder therefore both exposes `.orderBy()` and is thenable.
 */
const mocks = vi.hoisted(() => ({
  ORG_ID: "22222222-2222-2222-2222-222222222222",
  rows: [] as { vendorName: string | null; transactionDate: string; amount: string }[],
  minDateRows: [{ minDate: null as string | null }],
  cashPosition: "0.00",
  arSchedule: {
    invoices: [],
    bucketTotals: {
      current: "0.00",
      "1-30": "0.00",
      "31-60": "0.00",
      "61-90": "0.00",
      "90+": "0.00",
    },
    totalOutstanding: "0.00",
  } as ArAgingSchedule,
}));

vi.mock("@/lib/platform/db/client", () => ({
  db: {
    select: vi.fn(() => {
      const builder = {
        from: () => builder,
        where: () => builder,
        orderBy: () => Promise.resolve(mocks.rows),
        then: (resolve: (rows: { minDate: string | null }[]) => unknown) =>
          resolve(mocks.minDateRows),
      };
      return builder;
    }),
  },
}));

vi.mock("@/lib/financial/calculations/cash-flow", () => ({
  getCashPosition: vi.fn(() => Promise.resolve(mocks.cashPosition)),
}));

vi.mock("@/lib/financial/intelligence/ar-aging", () => ({
  buildArAgingSchedule: vi.fn(() => Promise.resolve(mocks.arSchedule)),
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

/** Today as a UTC `YYYY-MM-DD` string — the projection's anchor day. */
function todayUtc(): string {
  return new Date(Date.now()).toISOString().slice(0, 10);
}

/** Build a minimal outstanding AR invoice landing on `projectedPaymentDate`. */
function arInvoice(
  amount: string,
  projectedPaymentDate: string,
): ArAgingSchedule["invoices"][number] {
  return {
    id: `inv-${projectedPaymentDate}`,
    transactionDate: projectedPaymentDate,
    amount,
    customerName: "Acme Co",
    daysOverdue: 0,
    bucket: "current",
    projectedPaymentDate,
    confidenceLevel: "high",
  };
}

describe("buildCashFlowProjection", () => {
  beforeEach(() => {
    mocks.rows = [];
    mocks.minDateRows = [{ minDate: null }];
    mocks.cashPosition = "0.00";
    mocks.arSchedule = {
      invoices: [],
      bucketTotals: {
        current: "0.00",
        "1-30": "0.00",
        "31-60": "0.00",
        "61-90": "0.00",
        "90+": "0.00",
      },
      totalOutstanding: "0.00",
    };
  });

  it("returns exactly 30 daily objects for a 30-day projection", async () => {
    mocks.cashPosition = "10000.00";

    const projection = await buildCashFlowProjection(mocks.ORG_ID, 30);

    expect(projection.projectedDays).toHaveLength(30);
    // Each entry is a well-formed DailyBalance for a distinct future day.
    const first = projection.projectedDays[0];
    expect(first?.date).toBe(addDaysUtc(todayUtc(), 1));
    expect(first?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(projection.projectedDays[29]?.date).toBe(addDaysUtc(todayUtc(), 30));
  });

  it("returns minimumProjectedBalance as a DECIMAL string with two decimal places", async () => {
    mocks.cashPosition = "5000.00";

    const projection = await buildCashFlowProjection(mocks.ORG_ID, 30);

    expect(typeof projection.minimumProjectedBalance).toBe("string");
    expect(projection.minimumProjectedBalance).toMatch(/^-?\d+\.\d{2}$/);
    // No inflows/outflows → balance holds flat at the starting position.
    expect(projection.minimumProjectedBalance).toBe("5000.00");
  });

  it("yields a null riskDate when an AR inflow arrives and there are no outflows", async () => {
    mocks.cashPosition = "1000.00";
    // A $2,000 invoice expected 5 days out; no recurring expenses (mocks.rows = []).
    const dueDate = addDaysUtc(todayUtc(), 5);
    mocks.arSchedule = {
      ...mocks.arSchedule,
      invoices: [arInvoice("2000.00", dueDate)],
    };

    const projection = await buildCashFlowProjection(mocks.ORG_ID, 30);

    expect(projection.riskDate).toBeNull();
    // The inflow lands on the due date and only ever raises the balance.
    const dueDay = projection.projectedDays.find((d) => d.date === dueDate);
    expect(dueDay?.inflows).toBe("2000.00");
    expect(projection.projectedDays[29]?.projectedBalance).toBe("3000.00");
  });

  it("yields a valid riskDate when a large recurring expense hits with no inflows", async () => {
    mocks.cashPosition = "1000.00";
    // Two prior charges of $5,000 on a 30-day cycle land the next charge tomorrow.
    const lastCharge = addDaysUtc(todayUtc(), -29); // + 30-day cycle = tomorrow
    const priorCharge = addDaysUtc(todayUtc(), -59);
    mocks.rows = [
      { vendorName: "BigSaaS", transactionDate: priorCharge, amount: "5000.00" },
      { vendorName: "BigSaaS", transactionDate: lastCharge, amount: "5000.00" },
    ];

    const projection = await buildCashFlowProjection(mocks.ORG_ID, 30);

    const tomorrow = addDaysUtc(todayUtc(), 1);
    expect(projection.riskDate).toBe(tomorrow);
    expect(projection.riskDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // 1000 - 5000 = -4000 on the day the charge lands.
    const riskDay = projection.projectedDays.find((d) => d.date === tomorrow);
    expect(riskDay?.outflows).toBe("5000.00");
    expect(riskDay?.projectedBalance).toBe("-4000.00");
  });

  it("derives confidenceLevel from transaction history length", async () => {
    mocks.cashPosition = "5000.00";
    // Only ~30 days of history → 'low'.
    mocks.minDateRows = [{ minDate: addDaysUtc(todayUtc(), -30) }];
    const low = await buildCashFlowProjection(mocks.ORG_ID, 30);
    expect(low.confidenceLevel).toBe("low");

    // ~120 days of history → 'medium'.
    mocks.minDateRows = [{ minDate: addDaysUtc(todayUtc(), -120) }];
    const medium = await buildCashFlowProjection(mocks.ORG_ID, 30);
    expect(medium.confidenceLevel).toBe("medium");

    // ~200 days of history → 'high'.
    mocks.minDateRows = [{ minDate: addDaysUtc(todayUtc(), -200) }];
    const high = await buildCashFlowProjection(mocks.ORG_ID, 30);
    expect(high.confidenceLevel).toBe("high");
  });
});
