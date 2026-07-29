import { describe, expect, it, vi } from "vitest";

import { buildFinancialContext } from "@/lib/ai/context/builder";

// The financial data layer and the currency formatter are mocked so this unit
// test exercises only the assembly/formatting logic in builder.ts — not the
// database or the DECIMAL math upstream.

vi.mock("@/lib/platform/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([{ name: "Acme Widgets Inc", planTier: "growth" }]),
      }),
    }),
  },
}));

vi.mock("@/lib/format", () => ({
  // Deterministic, non-null stand-in: prefixes a "$" so assertions can confirm
  // real numeric strings flowed through without ever emitting null/undefined.
  formatCurrency: (value: string | number): string => `$${value}`,
}));

vi.mock("@/lib/financial/calculations/pnl", () => ({
  calculatePnL: vi.fn().mockResolvedValue({
    revenue: "45200.00",
    expenses: "38100.00",
    netProfit: "7100.00",
  }),
}));

vi.mock("@/lib/financial/calculations/cash-flow", () => ({
  getCashPosition: vi.fn().mockResolvedValue("12450.00"),
}));

vi.mock("@/lib/financial/aggregations/categories", () => ({
  getExpensesByCategory: vi.fn().mockResolvedValue([
    { category: "payroll", amount: "22000.00", sharePct: "58.2100" },
    { category: "software_subscriptions", amount: "3400.00", sharePct: "9.0000" },
  ]),
}));

vi.mock("@/lib/financial/intelligence/ar-aging", () => ({
  buildArAgingSchedule: vi.fn().mockResolvedValue({
    invoices: [],
    bucketTotals: {
      current: "8200.00",
      "1-30": "3100.00",
      "31-60": "0.00",
      "61-90": "900.00",
      "90+": "1400.00",
    },
    totalOutstanding: "13600.00",
  }),
}));

describe("buildFinancialContext", () => {
  it("returns a non-empty string", async () => {
    const result = await buildFinancialContext("org-123");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("contains the FINANCIAL CONTEXT header and real numbers", async () => {
    const result = await buildFinancialContext("org-123");
    expect(result).toContain("FINANCIAL CONTEXT");
    expect(result).toContain("$12450.00"); // cash position
    expect(result).toContain("$45200.00"); // P&L revenue
    expect(result).toContain("$13600.00"); // AR total outstanding
  });

  it("stays under the compact 8,000-character budget", async () => {
    const result = await buildFinancialContext("org-123");
    expect(result.length).toBeLessThan(8000);
  });

  it("never emits a null or undefined substring", async () => {
    const result = await buildFinancialContext("org-123");
    expect(result).not.toMatch(/null|undefined/);
  });
});
