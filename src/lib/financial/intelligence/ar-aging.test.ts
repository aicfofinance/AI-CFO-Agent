import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildArAgingSchedule } from "@/lib/financial/intelligence/ar-aging";

/**
 * The DB is unreachable in this environment, so the Drizzle client is mocked.
 * `buildArAgingSchedule` issues three queries in this order:
 *   1. invoice detail    — `.select().from().where()`            (awaited)
 *   2. bucket totals      — `.select().from().where().groupBy()`  (awaited)
 *   3. grand total        — `.select().from().where()`            (awaited)
 *
 * The mock returns a queued result per `db.select()` call. Each result object is
 * both awaitable (a thenable) and exposes `.groupBy()` returning the same value,
 * so it satisfies whichever chain the implementation uses for that call.
 */
type InvoiceRow = {
  id: string;
  transactionDate: string;
  amount: string;
  customerName: string | null;
};
type BucketRow = { bucket: string; total: string };
type TotalRow = { total: string };

const mocks = vi.hoisted(() => ({
  ORG_ID: "22222222-2222-2222-2222-222222222222",
  queue: [] as unknown[],
}));

function resultFor(value: unknown): {
  then: (resolve: (v: unknown) => void) => void;
  groupBy: () => Promise<unknown>;
} {
  return {
    then: (resolve) => resolve(value),
    groupBy: () => Promise.resolve(value),
  };
}

vi.mock("@/lib/platform/db/client", () => ({
  db: {
    select: vi.fn(() => ({
      from: () => ({
        where: () => resultFor(mocks.queue.shift()),
      }),
    })),
  },
}));

/** ISO `YYYY-MM-DD` for `n` days before today (UTC), matching the impl's math. */
function daysAgoIso(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function seed(invoiceRows: InvoiceRow[], bucketRows: BucketRow[], totalRow: TotalRow): void {
  mocks.queue = [invoiceRows, bucketRows, [totalRow]];
}

describe("buildArAgingSchedule", () => {
  beforeEach(() => {
    mocks.queue = [];
  });

  it("places a 10-day-old invoice in 'current' with high confidence", async () => {
    seed(
      [{ id: "inv-1", transactionDate: daysAgoIso(10), amount: "1000.00", customerName: "Acme" }],
      [{ bucket: "current", total: "1000.00" }],
      { total: "1000.00" },
    );

    const schedule = await buildArAgingSchedule(mocks.ORG_ID);
    const invoice = schedule.invoices[0];

    expect(invoice).toBeDefined();
    expect(invoice?.bucket).toBe("current");
    expect(invoice?.confidenceLevel).toBe("high");
    expect(invoice?.projectedPaymentDate).not.toBeNull();
    expect(invoice?.projectedPaymentDate).toMatch(ISO_DATE);
  });

  it("places a 45-day-old invoice in '1-30' with high confidence", async () => {
    seed(
      [{ id: "inv-2", transactionDate: daysAgoIso(45), amount: "2500.00", customerName: "Globex" }],
      [{ bucket: "1-30", total: "2500.00" }],
      { total: "2500.00" },
    );

    const schedule = await buildArAgingSchedule(mocks.ORG_ID);
    const invoice = schedule.invoices[0];

    expect(invoice?.bucket).toBe("1-30");
    expect(invoice?.confidenceLevel).toBe("high");
    expect(invoice?.projectedPaymentDate).toMatch(ISO_DATE);
  });

  it("places a 70-day-old invoice in '31-60' with medium confidence", async () => {
    seed(
      [{ id: "inv-3", transactionDate: daysAgoIso(70), amount: "700.00", customerName: "Initech" }],
      [{ bucket: "31-60", total: "700.00" }],
      { total: "700.00" },
    );

    const schedule = await buildArAgingSchedule(mocks.ORG_ID);
    const invoice = schedule.invoices[0];

    expect(invoice?.bucket).toBe("31-60");
    expect(invoice?.confidenceLevel).toBe("medium");
    expect(invoice?.projectedPaymentDate).toMatch(ISO_DATE);
  });

  it("returns a non-null valid ISO projectedPaymentDate for every invoice and bucket", async () => {
    const invoiceRows: InvoiceRow[] = [
      { id: "a", transactionDate: daysAgoIso(5), amount: "100.00", customerName: "A" },
      { id: "b", transactionDate: daysAgoIso(45), amount: "100.00", customerName: "B" },
      { id: "c", transactionDate: daysAgoIso(75), amount: "100.00", customerName: "C" },
      { id: "d", transactionDate: daysAgoIso(105), amount: "100.00", customerName: "D" },
      { id: "e", transactionDate: daysAgoIso(200), amount: "100.00", customerName: null },
    ];
    seed(
      invoiceRows,
      [
        { bucket: "current", total: "100.00" },
        { bucket: "1-30", total: "100.00" },
        { bucket: "31-60", total: "100.00" },
        { bucket: "61-90", total: "100.00" },
        { bucket: "90+", total: "100.00" },
      ],
      { total: "500.00" },
    );

    const schedule = await buildArAgingSchedule(mocks.ORG_ID);

    expect(schedule.invoices).toHaveLength(5);
    for (const invoice of schedule.invoices) {
      expect(invoice.projectedPaymentDate).toBeTruthy();
      expect(invoice.projectedPaymentDate).toMatch(ISO_DATE);
      expect(Number.isNaN(Date.parse(invoice.projectedPaymentDate))).toBe(false);
      expect(invoice.confidenceLevel).toBeTruthy();
    }

    expect(schedule.invoices.map((i) => i.bucket)).toEqual([
      "current",
      "1-30",
      "31-60",
      "61-90",
      "90+",
    ]);
    expect(schedule.totalOutstanding).toBe("500.00");
    expect(schedule.bucketTotals.current).toBe("100.00");
    expect(schedule.bucketTotals["90+"]).toBe("100.00");
  });
});
