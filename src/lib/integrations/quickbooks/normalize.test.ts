import { describe, expect, it } from "vitest";

import {
  normalizeQBCategory,
  normalizeTransactionType,
} from "@/lib/integrations/quickbooks/normalize";

describe("normalizeTransactionType", () => {
  // ── income ──────────────────────────────────────────────────────────────────
  it("maps Invoice to income", () => {
    expect(normalizeTransactionType("Invoice")).toBe("income");
  });

  it("maps Payment to income", () => {
    expect(normalizeTransactionType("Payment")).toBe("income");
  });

  it("maps Deposit to income", () => {
    expect(normalizeTransactionType("Deposit")).toBe("income");
  });

  // ── expense ──────────────────────────────────────────────────────────────────
  it("maps Purchase to expense", () => {
    expect(normalizeTransactionType("Purchase")).toBe("expense");
  });

  it("maps Bill to expense", () => {
    expect(normalizeTransactionType("Bill")).toBe("expense");
  });

  it("maps BillPayment to expense", () => {
    expect(normalizeTransactionType("BillPayment")).toBe("expense");
  });

  it("maps Check to expense", () => {
    expect(normalizeTransactionType("Check")).toBe("expense");
  });

  // ── transfer ─────────────────────────────────────────────────────────────────
  it("maps Transfer to transfer", () => {
    expect(normalizeTransactionType("Transfer")).toBe("transfer");
  });

  // ── adjustment ───────────────────────────────────────────────────────────────
  it("maps JournalEntry to adjustment", () => {
    expect(normalizeTransactionType("JournalEntry")).toBe("adjustment");
  });

  it("maps an unknown future type to adjustment (safe fallback)", () => {
    expect(normalizeTransactionType("UnknownFutureType")).toBe("adjustment");
  });
});

describe("normalizeQBCategory", () => {
  it("maps a recognised account name to a defined category (not undefined)", () => {
    const result = normalizeQBCategory("Advertising");
    // Must be a defined string — never undefined
    expect(result).toBeDefined();
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns 'other' (never undefined) when both arguments are undefined", () => {
    const result = normalizeQBCategory(undefined, undefined);
    expect(result).toBeDefined();
    expect(result).toBe("other");
  });

  it("maps Payroll account name to 'payroll'", () => {
    const result = normalizeQBCategory("Payroll");
    expect(result).toBeDefined();
    expect(result).toBe("payroll");
  });
});
