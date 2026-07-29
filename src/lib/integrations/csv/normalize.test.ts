/**
 * Unit tests for the CSV normalizer (`normalizeCSVRow`).
 *
 * Test coverage:
 *  1. Income row — QB 'Invoice' → transactionType 'income'
 *  2. Expense row — QB 'Check' → transactionType 'expense'
 *  3. Transfer row — QB 'Transfer' → transactionType 'transfer'
 *  4. Unknown QB type → transactionType 'other' (not dropped)
 *  5. Empty amount → return null (required field guard)
 *  6. Empty transactionDate → return null (required field guard)
 *  7. externalId uniqueness — two different rows produce different externalIds
 *  8. externalId determinism — same input produces the same externalId
 *  9. Category mapping from categorySource
 * 10. Null categorySource → category 'other', not logged (no source name available)
 */

import { describe, it, expect } from "vitest";
import type { ParsedCSVRow } from "./parser";
import { normalizeCSVRow } from "./normalize";

// ─── Fixture factory ──────────────────────────────────────────────────────────

/**
 * Returns a minimal valid ParsedCSVRow. Individual fields can be overridden via
 * the `overrides` parameter to exercise guards and mapping paths.
 */
function makeRow(overrides: Partial<ParsedCSVRow> = {}): ParsedCSVRow {
  return {
    transactionDate: "2024-03-15",
    transactionType: "Invoice",
    referenceNumber: "INV-2024-001",
    vendorName: "Acme Corp",
    description: "Consulting services",
    amount: "1250.00",
    categorySource: "professional services",
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("normalizeCSVRow", () => {
  // 1. Income row
  it("maps Invoice QB type to income with correct fields", () => {
    const result = normalizeCSVRow(makeRow());

    expect(result).not.toBeNull();
    expect(result!.transactionType).toBe("income");
    expect(result!.transactionDate).toBe("2024-03-15");
    expect(result!.amount).toBe("1250.00");
    expect(result!.currencyCode).toBe("USD");
    expect(result!.vendorName).toBe("Acme Corp");
    expect(result!.referenceNumber).toBe("INV-2024-001");
    expect(result!.description).toBe("Consulting services");
    expect(result!.isReconciled).toBe(false);
    expect(result!.externalId).toMatch(/^csv-[0-9a-f]{16}$/);
  });

  it("maps Sales Receipt QB type to income", () => {
    const result = normalizeCSVRow(makeRow({ transactionType: "Sales Receipt" }));
    expect(result).not.toBeNull();
    expect(result!.transactionType).toBe("income");
  });

  it("maps Credit Memo QB type to income", () => {
    const result = normalizeCSVRow(makeRow({ transactionType: "Credit Memo" }));
    expect(result).not.toBeNull();
    expect(result!.transactionType).toBe("income");
  });

  // 2. Expense row
  it("maps Check QB type to expense", () => {
    const result = normalizeCSVRow(
      makeRow({ transactionType: "Check", amount: "500.00", vendorName: "Office Supply Co" }),
    );

    expect(result).not.toBeNull();
    expect(result!.transactionType).toBe("expense");
    expect(result!.amount).toBe("500.00");
  });

  it("maps Bill QB type to expense", () => {
    const result = normalizeCSVRow(makeRow({ transactionType: "Bill" }));
    expect(result).not.toBeNull();
    expect(result!.transactionType).toBe("expense");
  });

  it("maps Expense QB type to expense", () => {
    const result = normalizeCSVRow(makeRow({ transactionType: "Expense" }));
    expect(result).not.toBeNull();
    expect(result!.transactionType).toBe("expense");
  });

  it("maps Credit Card Expense QB type to expense", () => {
    const result = normalizeCSVRow(makeRow({ transactionType: "Credit Card Expense" }));
    expect(result).not.toBeNull();
    expect(result!.transactionType).toBe("expense");
  });

  it("maps Bill Payment (Check) QB type to expense", () => {
    const result = normalizeCSVRow(makeRow({ transactionType: "Bill Payment (Check)" }));
    expect(result).not.toBeNull();
    expect(result!.transactionType).toBe("expense");
  });

  it("maps Bill Payment (Credit Card) QB type to expense", () => {
    const result = normalizeCSVRow(makeRow({ transactionType: "Bill Payment (Credit Card)" }));
    expect(result).not.toBeNull();
    expect(result!.transactionType).toBe("expense");
  });

  // 3. Transfer type
  it("maps Transfer QB type to transfer", () => {
    const result = normalizeCSVRow(makeRow({ transactionType: "Transfer" }));
    expect(result).not.toBeNull();
    expect(result!.transactionType).toBe("transfer");
  });

  // 4. Unknown type → 'other' (not dropped)
  it("maps unknown QB type to 'other' transactionType rather than returning null", () => {
    const result = normalizeCSVRow(makeRow({ transactionType: "Journal Entry" }));
    expect(result).not.toBeNull();
    expect(result!.transactionType).toBe("other");
  });

  it("maps completely unknown type string to 'other'", () => {
    const result = normalizeCSVRow(makeRow({ transactionType: "UNKNOWN_QB_TYPE_XYZ" }));
    expect(result).not.toBeNull();
    expect(result!.transactionType).toBe("other");
  });

  // 5. Empty amount → null
  it("returns null when amount is an empty string", () => {
    // ParsedCSVRow.amount is typed as string; an empty string triggers the guard.
    const row: ParsedCSVRow = {
      ...makeRow(),
      amount: "",
    };
    expect(normalizeCSVRow(row)).toBeNull();
  });

  // 6. Empty date → null
  it("returns null when transactionDate is empty", () => {
    const row: ParsedCSVRow = {
      ...makeRow(),
      transactionDate: "",
    };
    expect(normalizeCSVRow(row)).toBeNull();
  });

  it("returns null when transactionType is empty", () => {
    const row: ParsedCSVRow = {
      ...makeRow(),
      transactionType: "",
    };
    expect(normalizeCSVRow(row)).toBeNull();
  });

  // 7. externalId uniqueness
  it("produces different externalIds for rows with different identity fields", () => {
    const rowA = normalizeCSVRow(
      makeRow({ vendorName: "Vendor A", amount: "100.00", transactionDate: "2024-01-01" }),
    );
    const rowB = normalizeCSVRow(
      makeRow({ vendorName: "Vendor B", amount: "200.00", transactionDate: "2024-01-02" }),
    );

    expect(rowA).not.toBeNull();
    expect(rowB).not.toBeNull();
    expect(rowA!.externalId).not.toBe(rowB!.externalId);
  });

  it("produces different externalIds for rows with different amounts", () => {
    const rowA = normalizeCSVRow(makeRow({ amount: "100.00" }));
    const rowB = normalizeCSVRow(makeRow({ amount: "101.00" }));

    expect(rowA).not.toBeNull();
    expect(rowB).not.toBeNull();
    expect(rowA!.externalId).not.toBe(rowB!.externalId);
  });

  // 8. externalId determinism
  it("produces the same externalId when called twice with identical input", () => {
    const row = makeRow();
    const resultA = normalizeCSVRow(row);
    const resultB = normalizeCSVRow(row);

    expect(resultA).not.toBeNull();
    expect(resultB).not.toBeNull();
    expect(resultA!.externalId).toBe(resultB!.externalId);
  });

  it("externalId has the expected 'csv-' prefix and 16 hex character suffix", () => {
    const result = normalizeCSVRow(makeRow());
    expect(result).not.toBeNull();
    expect(result!.externalId).toMatch(/^csv-[0-9a-f]{16}$/);
  });

  // 9. Category mapping
  it("maps categorySource 'advertising' to advertising_marketing category", () => {
    const result = normalizeCSVRow(makeRow({ categorySource: "advertising" }));
    expect(result).not.toBeNull();
    expect(result!.category).toBe("advertising_marketing");
  });

  it("maps categorySource 'payroll' to payroll category", () => {
    const result = normalizeCSVRow(makeRow({ categorySource: "payroll" }));
    expect(result).not.toBeNull();
    expect(result!.category).toBe("payroll");
  });

  it("preserves the raw categorySource value alongside the mapped category", () => {
    const result = normalizeCSVRow(makeRow({ categorySource: "software subscription" }));
    expect(result).not.toBeNull();
    expect(result!.category).toBe("software_subscriptions");
    expect(result!.categorySource).toBe("software subscription");
  });

  // 10. Null categorySource
  it("maps null categorySource to category 'other' with null categorySource", () => {
    const result = normalizeCSVRow(makeRow({ categorySource: null }));
    expect(result).not.toBeNull();
    expect(result!.category).toBe("other");
    expect(result!.categorySource).toBeNull();
  });

  it("maps unknown categorySource to category 'other', preserving the source string", () => {
    const result = normalizeCSVRow(makeRow({ categorySource: "ZZZ-UNKNOWN-ACCOUNT-9999" }));
    expect(result).not.toBeNull();
    expect(result!.category).toBe("other");
    expect(result!.categorySource).toBe("ZZZ-UNKNOWN-ACCOUNT-9999");
  });

  // Null propagation
  it("passes through null optional fields (description, vendorName, referenceNumber)", () => {
    const result = normalizeCSVRow(
      makeRow({ description: null, vendorName: null, referenceNumber: null }),
    );
    expect(result).not.toBeNull();
    expect(result!.description).toBeNull();
    expect(result!.vendorName).toBeNull();
    expect(result!.referenceNumber).toBeNull();
  });
});
