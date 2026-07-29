import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ArAgingSchedule } from "@/lib/financial/intelligence/ar-aging";
import {
  generateCollectionsOpportunityFinding,
  hasOverdueInvoices,
  severityForPastDue,
  type OverdueInvoice,
} from "@/lib/financial/intelligence/ar-aging-intelligence";

/**
 * Unit tests for the Step 6.5 AR aging collections-opportunity logic.
 *
 * The deterministic decision helpers (`hasOverdueInvoices`, `severityForPastDue`)
 * are pure and tested directly. The finding-generation function is tested with
 * `generateText` and the Drizzle client mocked — the same pattern as
 * `anomaly.test.ts` / `cash-flow-risk-finding.test.ts` — so finding storage, the
 * per-invoice `related_data` shape, and the 429 rate-limit skip are exercised
 * without an Inngest harness or a live database.
 *
 * `detectRateLimitError` is kept REAL (via importOriginal); only `getModel` is
 * stubbed.
 */
const mocks = vi.hoisted(() => {
  const updateWhere = vi.fn<(predicate?: unknown) => Promise<void>>();
  return {
    generateText: vi.fn<(options: Record<string, unknown>) => Promise<{ text: string }>>(),
    insertValues: vi.fn<(values: Record<string, unknown>) => Promise<void>>(),
    updateWhere,
    updateSet: vi.fn<(values: Record<string, unknown>) => { where: typeof updateWhere }>(() => ({
      where: updateWhere,
    })),
  };
});

vi.mock("ai", () => ({
  generateText: mocks.generateText,
}));

vi.mock("@/lib/platform/db/client", () => ({
  db: {
    insert: () => ({ values: mocks.insertValues }),
    update: () => ({ set: mocks.updateSet }),
  },
}));

vi.mock("@/lib/env", () => ({
  env: { AI_PROVIDER: "google" as const },
}));

vi.mock("@/lib/ai/models/router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/models/router")>();
  return {
    ...actual,
    // Stub only the model factory; keep the real detectRateLimitError.
    getModel: vi.fn(() => ({}) as never),
  };
});

const ORG_ID = "22222222-2222-2222-2222-222222222222";
const RUN_ID = "33333333-3333-3333-3333-333333333333";

/** Arms both `generateText` calls (headline + detail) with trivial text. */
function armSuccessfulPhrasing(): void {
  mocks.generateText
    .mockResolvedValueOnce({ text: "  Collect overdue invoices  " })
    .mockResolvedValueOnce({ text: "  You have overdue receivables.  " });
}

/** Builds an aging schedule fixture with the given per-bucket totals. */
function scheduleWith(bucketTotals: Partial<ArAgingSchedule["bucketTotals"]>): ArAgingSchedule {
  return {
    invoices: [],
    bucketTotals: {
      current: "0.00",
      "1-30": "0.00",
      "31-60": "0.00",
      "61-90": "0.00",
      "90+": "0.00",
      ...bucketTotals,
    },
    totalOutstanding: "0.00",
  };
}

const SAMPLE_INVOICES: OverdueInvoice[] = [
  { invoiceId: "inv-1", amount: "1200.00", clientName: "Acme Corp", daysOutstanding: 47 },
  { invoiceId: "inv-2", amount: "800.00", clientName: "Globex", daysOutstanding: 33 },
];

describe("hasOverdueInvoices (pure)", () => {
  it("case 1: is true when a 31+ day (non-current) bucket carries a non-zero total", () => {
    expect(hasOverdueInvoices(scheduleWith({ "31-60": "1500.00" }))).toBe(true);
    expect(hasOverdueInvoices(scheduleWith({ "90+": "50.00" }))).toBe(true);
    expect(hasOverdueInvoices(scheduleWith({ "1-30": "10.00" }))).toBe(true);
  });

  it("case 2: is false when only the current bucket carries a total", () => {
    expect(hasOverdueInvoices(scheduleWith({ current: "9999.00" }))).toBe(false);
    // Fully empty schedule → no overdue invoices.
    expect(hasOverdueInvoices(scheduleWith({}))).toBe(false);
  });
});

describe("severityForPastDue (pure)", () => {
  it("case 4: is high when the total past due is at or above $5,000", () => {
    expect(severityForPastDue("5000.00")).toBe("high");
    expect(severityForPastDue("12000.00")).toBe("high");
  });

  it("is medium when the total past due is below $5,000", () => {
    expect(severityForPastDue("4999.99")).toBe("medium");
    expect(severityForPastDue("100.00")).toBe("medium");
  });
});

describe("generateCollectionsOpportunityFinding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
  });

  it("case 1: writes a collections_opportunity finding with per-invoice related_data", async () => {
    armSuccessfulPhrasing();

    const result = await generateCollectionsOpportunityFinding(ORG_ID, RUN_ID, {
      severity: "medium",
      totalPastDue: "2000.00",
      invoices: SAMPLE_INVOICES,
    });

    expect(result).toEqual({ status: "created" });
    expect(mocks.generateText).toHaveBeenCalledTimes(2); // headline + detail
    expect(mocks.insertValues).toHaveBeenCalledTimes(1);
    expect(mocks.updateSet).not.toHaveBeenCalled(); // no rate-limit skip

    const inserted = mocks.insertValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(inserted.orgId).toBe(ORG_ID);
    expect(inserted.intelligenceRunId).toBe(RUN_ID);
    expect(inserted.findingType).toBe("collections_opportunity");
    expect(inserted.severity).toBe("medium");
    expect(inserted.status).toBe("active");
    // collections_opportunity never expires (CLAUDE.md selective expiry).
    expect(inserted.expiresAt).toBeNull();
    // Model text is trimmed before storage.
    expect(inserted.headline).toBe("Collect overdue invoices");

    // related_data carries the per-invoice bag consumed by the Phase 9 agentic
    // layer — invoiceId, amount, clientName, daysOutstanding must all be present.
    const relatedData = inserted.relatedData as {
      invoices: OverdueInvoice[];
      totalPastDue: string;
    };
    expect(relatedData.totalPastDue).toBe("2000.00");
    expect(relatedData.invoices[0]?.invoiceId).toBe("inv-1");
    expect(relatedData.invoices[0]?.amount).toBe("1200.00");
    expect(relatedData.invoices[0]?.clientName).toBe("Acme Corp");
    expect(relatedData.invoices[0]?.daysOutstanding).toBe(47);
  });

  it("case 4: stores high severity when passed high severity", async () => {
    armSuccessfulPhrasing();

    await generateCollectionsOpportunityFinding(ORG_ID, RUN_ID, {
      severity: severityForPastDue("7500.00"),
      totalPastDue: "7500.00",
      invoices: SAMPLE_INVOICES,
    });

    const inserted = mocks.insertValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(inserted.severity).toBe("high");
  });

  it("case 3: a 429 marks the run skipped with reason rate_limit and writes no finding", async () => {
    const rateLimitError = Object.assign(new Error("Too Many Requests"), { statusCode: 429 });
    mocks.generateText.mockRejectedValueOnce(rateLimitError);

    const result = await generateCollectionsOpportunityFinding(ORG_ID, RUN_ID, {
      severity: "medium",
      totalPastDue: "2000.00",
      invoices: SAMPLE_INVOICES,
    });

    expect(result).toEqual({ status: "skipped", reason: "rate_limit" });
    expect(mocks.updateSet).toHaveBeenCalledTimes(1);
    expect(mocks.updateSet).toHaveBeenCalledWith({
      status: "skipped",
      skippedReason: "rate_limit",
    });
    expect(mocks.updateWhere).toHaveBeenCalledTimes(1);
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });

  it("rethrows a non-429 error rather than swallowing it", async () => {
    const boom = Object.assign(new Error("upstream exploded"), { statusCode: 500 });
    mocks.generateText.mockRejectedValueOnce(boom);

    await expect(
      generateCollectionsOpportunityFinding(ORG_ID, RUN_ID, {
        severity: "medium",
        totalPastDue: "2000.00",
        invoices: SAMPLE_INVOICES,
      }),
    ).rejects.toThrow("upstream exploded");

    expect(mocks.updateSet).not.toHaveBeenCalled();
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });
});
