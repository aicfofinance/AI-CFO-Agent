import { describe, expect, it } from "vitest";

import { checkGuardrails } from "./financial-advice";

describe("checkGuardrails", () => {
  it("flags a request to take out a loan (investment advice)", () => {
    const result = checkGuardrails("Should I take out a loan to grow my business?");
    expect(result.flagged).toBe(true);
    if (result.flagged) {
      expect(result.reason).toBe("investment advice");
    }
  });

  it("flags a request to invest (investment advice)", () => {
    const result = checkGuardrails("Should I invest in real estate?");
    expect(result.flagged).toBe(true);
    if (result.flagged) {
      expect(result.reason).toBe("investment advice");
    }
  });

  it("flags a request for stock picks (investment advice)", () => {
    const result = checkGuardrails("What stocks should I buy?");
    expect(result.flagged).toBe(true);
    if (result.flagged) {
      expect(result.reason).toBe("investment advice");
    }
  });

  it("flags a request for tax strategies (tax advice)", () => {
    const result = checkGuardrails("How do I avoid taxes on my profit?");
    expect(result.flagged).toBe(true);
    if (result.flagged) {
      expect(result.reason).toBe("tax advice");
    }
  });

  it("flags a hiring decision request (HR advice)", () => {
    const result = checkGuardrails("Should I hire another engineer this quarter?");
    expect(result.flagged).toBe(true);
    if (result.flagged) {
      expect(result.reason).toBe("HR advice");
    }
  });

  it("flags a money-movement request (financial advice)", () => {
    const result = checkGuardrails("Where should I put my money in for the best return?");
    expect(result.flagged).toBe(true);
    if (result.flagged) {
      expect(result.reason).toBe("financial advice");
    }
  });

  it("is case-insensitive", () => {
    const result = checkGuardrails("SHOULD I INVEST IN CRYPTO?");
    expect(result.flagged).toBe(true);
  });

  it("does not flag a top-expenses analytical question", () => {
    expect(checkGuardrails("What are my top expenses this month?")).toEqual({ flagged: false });
  });

  it("does not flag a cash flow data request", () => {
    expect(checkGuardrails("Show me cash flow for the last 30 days")).toEqual({ flagged: false });
  });

  it("does not flag a revenue diagnostic question", () => {
    expect(checkGuardrails("Why is my revenue down 20%?")).toEqual({ flagged: false });
  });

  it("does not flag an overdue-invoices data request", () => {
    expect(checkGuardrails("What invoices are overdue?")).toEqual({ flagged: false });
  });
});
