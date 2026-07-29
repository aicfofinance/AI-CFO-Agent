import { describe, expect, it } from "vitest";

import { buildInvoiceAccelerationPrompt } from "./invoice-acceleration";

describe("buildInvoiceAccelerationPrompt", () => {
  it("includes the client name in the user prompt", () => {
    const result = buildInvoiceAccelerationPrompt({
      invoices: [
        {
          invoiceId: "INV-001",
          amount: "1250.00",
          clientName: "Acme Corp",
          daysOutstanding: 45,
        },
      ],
    });
    expect(result.user).toContain("Acme Corp");
  });

  it("includes the invoice amount", () => {
    const result = buildInvoiceAccelerationPrompt({
      invoices: [
        {
          invoiceId: "INV-001",
          amount: "1250.00",
          clientName: "Acme Corp",
          daysOutstanding: 45,
        },
      ],
    });
    expect(result.user).toContain("1250.00");
  });

  it("includes the invoice ID", () => {
    const result = buildInvoiceAccelerationPrompt({
      invoices: [
        {
          invoiceId: "INV-001",
          amount: "1250.00",
          clientName: "Acme Corp",
          daysOutstanding: 45,
        },
      ],
    });
    expect(result.user).toContain("INV-001");
  });

  it("mentions the days overdue for a single invoice", () => {
    const result = buildInvoiceAccelerationPrompt({
      invoices: [
        {
          invoiceId: "INV-001",
          amount: "1250.00",
          clientName: "Acme Corp",
          daysOutstanding: 45,
        },
      ],
    });
    expect(result.user).toContain("45 days overdue");
  });

  it("mentions multiple invoices when there are more than one", () => {
    const result = buildInvoiceAccelerationPrompt({
      invoices: [
        {
          invoiceId: "INV-001",
          amount: "500.00",
          clientName: "Acme Corp",
          daysOutstanding: 60,
        },
        {
          invoiceId: "INV-002",
          amount: "750.00",
          clientName: "Acme Corp",
          daysOutstanding: 30,
        },
      ],
    });
    expect(result.user).toContain("2");
    expect(result.user).toContain("Acme Corp");
  });

  it("reports the oldest overdue age for multiple invoices", () => {
    const result = buildInvoiceAccelerationPrompt({
      invoices: [
        {
          invoiceId: "INV-001",
          amount: "500.00",
          clientName: "Acme Corp",
          daysOutstanding: 60,
        },
        {
          invoiceId: "INV-002",
          amount: "750.00",
          clientName: "Acme Corp",
          daysOutstanding: 30,
        },
      ],
    });
    expect(result.user).toContain("60 days overdue");
    expect(result.user).toContain("INV-001, INV-002");
  });

  it("returns a non-empty system prompt", () => {
    const result = buildInvoiceAccelerationPrompt({
      invoices: [
        {
          invoiceId: "INV-001",
          amount: "100.00",
          clientName: "Test Co",
          daysOutstanding: 20,
        },
      ],
    });
    expect(result.system.length).toBeGreaterThan(20);
  });
});
