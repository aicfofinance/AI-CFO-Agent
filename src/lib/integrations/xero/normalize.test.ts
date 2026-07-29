/**
 * Unit tests for Xero normalize functions.
 *
 * These tests cover the field mapping described in normalize.ts, with special
 * attention to:
 * - xero-node's runtime string enum values (not numeric as TypeScript declares)
 * - Null/missing field guards (return null = row is dropped)
 * - Amount stored as a positive decimal string regardless of invoice direction
 * - Category mapping through mapToInternalCategory
 *
 * The xero-node d.ts files use numeric enums (Invoice.TypeEnum, etc.) but the
 * JS runtime uses string values. All test fixtures cast type/status/currencyCode
 * via `unknown` to avoid TypeScript's type system fighting the test assertions.
 */

import { describe, it, expect } from "vitest";
import type { Invoice, BankTransaction } from "xero-node";

import { normalizeXeroInvoice, normalizeXeroBankTransaction } from "./normalize";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Builds a minimal valid Invoice fixture. Overrides allow setting any field
 * including ones with enum types — all casted via unknown to avoid TypeScript's
 * numeric-enum mismatch with the runtime string values.
 */
function makeInvoice(overrides: Record<string, unknown> = {}): Invoice {
  return {
    invoiceID: "inv-001",
    date: "2024-03-15",
    total: 1250.0,
    // Runtime value is string "ACCREC" even though d.ts declares numeric enum.
    type: "ACCREC",
    currencyCode: "USD",
    contact: { name: "Acme Corp" },
    invoiceNumber: "INV-2024-001",
    lineItems: [
      {
        description: "Software subscription",
        accountCode: "software",
        lineAmount: 1250.0,
      },
    ],
    status: "AUTHORISED",
    ...overrides,
  } as unknown as Invoice;
}

/**
 * Builds a minimal valid BankTransaction fixture.
 */
function makeBankTxn(overrides: Record<string, unknown> = {}): BankTransaction {
  return {
    bankTransactionID: "bt-001",
    date: "2024-03-20",
    total: 500.0,
    type: "SPEND",
    currencyCode: "USD",
    contact: { name: "Office Supply Co" },
    reference: "PO-2024-042",
    lineItems: [
      {
        description: "Office supplies",
        accountCode: "office supplies",
        lineAmount: 500.0,
      },
    ],
    isReconciled: true,
    ...overrides,
  } as unknown as BankTransaction;
}

// ─── Invoice tests ─────────────────────────────────────────────────────────────

describe("normalizeXeroInvoice", () => {
  it("maps ACCREC invoice to income with correct fields", () => {
    const result = normalizeXeroInvoice(makeInvoice());

    expect(result).not.toBeNull();
    expect(result!.externalId).toBe("invoice-inv-001");
    expect(result!.transactionDate).toBe("2024-03-15");
    expect(result!.amount).toBe("1250.00");
    expect(result!.currencyCode).toBe("USD");
    expect(result!.transactionType).toBe("income");
    expect(result!.vendorName).toBe("Acme Corp");
    expect(result!.referenceNumber).toBe("INV-2024-001");
    expect(result!.description).toBe("Software subscription");
    expect(result!.category).toBe("software_subscriptions");
    expect(result!.isReconciled).toBe(false); // status is AUTHORISED, not PAID
  });

  it("maps ACCPAY invoice to expense", () => {
    const result = normalizeXeroInvoice(makeInvoice({ type: "ACCPAY", total: 300.5 }));

    expect(result).not.toBeNull();
    expect(result!.transactionType).toBe("expense");
    expect(result!.amount).toBe("300.50");
  });

  it("returns null for unknown invoice type", () => {
    const result = normalizeXeroInvoice(makeInvoice({ type: "UNKNOWN_TYPE" }));
    expect(result).toBeNull();
  });

  it("returns null when invoice total is missing", () => {
    const result = normalizeXeroInvoice(makeInvoice({ total: undefined }));
    expect(result).toBeNull();
  });

  it("returns null when invoice date is missing", () => {
    const result = normalizeXeroInvoice(makeInvoice({ date: undefined }));
    expect(result).toBeNull();
  });

  it("returns null when invoiceID is missing", () => {
    const result = normalizeXeroInvoice(makeInvoice({ invoiceID: undefined }));
    expect(result).toBeNull();
  });

  it("stores absolute amount for negative totals", () => {
    const result = normalizeXeroInvoice(makeInvoice({ total: -750.0 }));
    expect(result).not.toBeNull();
    expect(result!.amount).toBe("750.00");
  });

  it("marks invoice as reconciled when status is PAID", () => {
    const result = normalizeXeroInvoice(makeInvoice({ status: "PAID" }));
    expect(result).not.toBeNull();
    expect(result!.isReconciled).toBe(true);
  });

  it("defaults currencyCode to USD when absent", () => {
    const result = normalizeXeroInvoice(makeInvoice({ currencyCode: undefined }));
    expect(result).not.toBeNull();
    expect(result!.currencyCode).toBe("USD");
  });

  it("maps null contact to null vendorName", () => {
    const result = normalizeXeroInvoice(makeInvoice({ contact: undefined }));
    expect(result).not.toBeNull();
    expect(result!.vendorName).toBeNull();
  });

  it("maps null invoiceNumber to null referenceNumber", () => {
    const result = normalizeXeroInvoice(makeInvoice({ invoiceNumber: undefined }));
    expect(result).not.toBeNull();
    expect(result!.referenceNumber).toBeNull();
  });
});

// ─── BankTransaction tests ────────────────────────────────────────────────────

describe("normalizeXeroBankTransaction", () => {
  it("maps SPEND bank transaction to expense", () => {
    const result = normalizeXeroBankTransaction(makeBankTxn());

    expect(result).not.toBeNull();
    expect(result!.externalId).toBe("banktxn-bt-001");
    expect(result!.transactionDate).toBe("2024-03-20");
    expect(result!.amount).toBe("500.00");
    expect(result!.currencyCode).toBe("USD");
    expect(result!.transactionType).toBe("expense");
    expect(result!.vendorName).toBe("Office Supply Co");
    expect(result!.referenceNumber).toBe("PO-2024-042");
    expect(result!.description).toBe("Office supplies");
    expect(result!.category).toBe("office_supplies");
    expect(result!.isReconciled).toBe(true);
  });

  it("maps RECEIVE bank transaction to income", () => {
    const result = normalizeXeroBankTransaction(makeBankTxn({ type: "RECEIVE", total: 800.0 }));

    expect(result).not.toBeNull();
    expect(result!.transactionType).toBe("income");
    expect(result!.amount).toBe("800.00");
  });

  it("maps RECEIVETRANSFER bank transaction to transfer", () => {
    const result = normalizeXeroBankTransaction(makeBankTxn({ type: "RECEIVETRANSFER" }));

    expect(result).not.toBeNull();
    expect(result!.transactionType).toBe("transfer");
  });

  it("maps SPENDTRANSFER to transfer type", () => {
    const result = normalizeXeroBankTransaction(makeBankTxn({ type: "SPENDTRANSFER" }));
    expect(result).not.toBeNull();
    expect(result!.transactionType).toBe("transfer");
  });

  it("returns null for unknown bank transaction type", () => {
    const result = normalizeXeroBankTransaction(makeBankTxn({ type: "UNKNOWN" }));
    expect(result).toBeNull();
  });

  it("returns null when bankTransactionID is missing", () => {
    const result = normalizeXeroBankTransaction(makeBankTxn({ bankTransactionID: undefined }));
    expect(result).toBeNull();
  });

  it("returns null when bank transaction total is missing", () => {
    const result = normalizeXeroBankTransaction(makeBankTxn({ total: undefined }));
    expect(result).toBeNull();
  });

  it("defaults isReconciled to false when absent", () => {
    const result = normalizeXeroBankTransaction(makeBankTxn({ isReconciled: undefined }));
    expect(result).not.toBeNull();
    expect(result!.isReconciled).toBe(false);
  });

  it("category falls back to other for unmapped account codes", () => {
    const result = normalizeXeroBankTransaction(
      makeBankTxn({
        lineItems: [{ description: "Miscellaneous widget cost", accountCode: "ZZZ-UNKNOWN-9999" }],
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.category).toBe("other");
    expect(result!.categorySource).toBe("ZZZ-UNKNOWN-9999");
  });
});
