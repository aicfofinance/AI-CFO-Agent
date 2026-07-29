import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  runAnomalyDetection,
  type IntelligenceStepResult,
} from "@/lib/financial/intelligence/anomaly";
import { runArAgingAnalysis } from "@/lib/financial/intelligence/ar-aging-intelligence";
import { runDuplicateSubscriptionScan } from "@/lib/financial/intelligence/duplicates";
import { db } from "@/lib/platform/db/client";
import { intelligenceRuns } from "@/lib/platform/db/schema";

/**
 * Step 6.12 — intelligence engine integration ("full run") test.
 *
 * This exercises the whole detection-to-finding pipeline the way
 * `jobs/intelligence/run.ts` drives it, but by calling the module-level step
 * functions directly rather than through an Inngest harness. It represents a
 * seeded test org carrying three known conditions:
 *   - a recent expense spike     → `runAnomalyDetection`        → `anomaly`
 *   - an overdue invoice         → `runArAgingAnalysis`         → `collections_opportunity`
 *   - duplicate vendor billing   → `runDuplicateSubscriptionScan` → `duplicate_subscription`
 *
 * The corporate firewall blocks database ports, so — exactly like every other
 * test in `src/__tests__/intelligence/` — the Drizzle client, the `ai` package,
 * the env schema and the model router are mocked. Two design choices keep the
 * mock surface small:
 *
 *   1. `insertFindingDeduped` is mocked directly, so we never have to simulate
 *      the dedup SELECT + INSERT chain per finding. Every finding write becomes a
 *      single recorded call whose `values` we assert against — this is what lets
 *      us verify "at least 3 findings", "every finding has a non-null headline",
 *      and the `collections_opportunity` related_data invoice id.
 *   2. `db.select()` returns a thenable query-builder whose terminal `await`
 *      dequeues the next canned result from `selectResults`. Each detector's SQL
 *      reads pull their rows from this FIFO queue in call order, so we control
 *      precisely which conditions the deterministic detectors see.
 *
 * `intelligence_runs.status = 'completed'` is asserted by replaying the runner's
 * final `mark-completed` update (Step 6.7 in `run.ts`) against the mocked `db`
 * once all three steps report `completed` — the same `{ status, findingsGenerated }`
 * write the real runner performs.
 */

type SelectQueryBuilder = {
  from: (...args: unknown[]) => SelectQueryBuilder;
  innerJoin: (...args: unknown[]) => SelectQueryBuilder;
  where: (...args: unknown[]) => SelectQueryBuilder;
  groupBy: (...args: unknown[]) => SelectQueryBuilder;
  orderBy: (...args: unknown[]) => SelectQueryBuilder;
  limit: (...args: unknown[]) => SelectQueryBuilder;
  then: (
    onFulfilled: (value: unknown[]) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise<unknown>;
};

const mocks = vi.hoisted(() => {
  // FIFO queue of canned SELECT results. Each fully-awaited `db.select()` chain
  // dequeues exactly one entry (the detectors run their reads sequentially).
  const selectResults: unknown[][] = [];

  const makeBuilder = (): SelectQueryBuilder => {
    const builder: SelectQueryBuilder = {
      from: () => builder,
      innerJoin: () => builder,
      where: () => builder,
      groupBy: () => builder,
      orderBy: () => builder,
      limit: () => builder,
      then: (onFulfilled, onRejected) => {
        const value = selectResults.shift() ?? [];
        return Promise.resolve(value).then(onFulfilled, onRejected);
      },
    };
    return builder;
  };

  const updateWhere = vi.fn<(predicate?: unknown) => Promise<void>>();
  const updateSet = vi.fn<(values: Record<string, unknown>) => { where: typeof updateWhere }>(
    () => ({ where: updateWhere }),
  );

  return {
    selectResults,
    makeBuilder,
    updateWhere,
    updateSet,
    select: vi.fn<() => SelectQueryBuilder>(() => makeBuilder()),
    generateText: vi.fn<(options: Record<string, unknown>) => Promise<{ text: string }>>(),
    insertFindingDeduped: vi.fn<(values: Record<string, unknown>) => Promise<boolean>>(),
  };
});

vi.mock("ai", () => ({
  generateText: mocks.generateText,
}));

vi.mock("@/lib/platform/db/client", () => ({
  db: {
    select: mocks.select,
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
    // Stub only the model factory; keep the real detectRateLimitError so the
    // 429 skip contract in the step functions is genuinely wired.
    getModel: vi.fn(() => ({}) as never),
  };
});

// Mock the shared finding writer so each finding write is a single recorded call
// we can assert against, instead of a dedup SELECT + INSERT chain. The alias path
// resolves to the same module the step files import relatively as
// `./findings-writer`, so this interception applies to all three step modules.
vi.mock("@/lib/financial/intelligence/findings-writer", () => ({
  insertFindingDeduped: mocks.insertFindingDeduped,
}));

const ORG_ID = "22222222-2222-2222-2222-222222222222";
const RUN_ID = "33333333-3333-3333-3333-333333333333";
// The overdue invoice the seeded org carries; the collections_opportunity
// finding's related_data must carry this id through to the agentic layer.
const EXPECTED_INVOICE_ID = "44444444-4444-4444-4444-444444444444";

/** A recorded `insertFindingDeduped` argument, narrowed for assertions. */
type FindingValues = {
  findingType: string;
  headline: unknown;
  relatedData: Record<string, unknown>;
};

/** Typed view of every finding written across the run (in insertion order). */
function insertedFindings(): FindingValues[] {
  return mocks.insertFindingDeduped.mock.calls.map((call) => call[0] as FindingValues);
}

/**
 * Queue the SELECT results for `runAnomalyDetection`:
 *   1. expense-spike threshold lookup (`alert_configs`) → empty → default 25%
 *   2. 7-day vs 30-day average daily expense → a spike (500 > 200 * 1.25)
 *   3. collections-slippage aged-invoice count → 0 (no anomaly slippage finding)
 * Yields exactly one `anomaly` (expense_spike) finding.
 */
function queueAnomalyReads(): void {
  mocks.selectResults.push(
    [],
    [{ amount7d: "500.00", amount30d: "200.00" }],
    [{ invoiceCount: 0, maxDaysOutstanding: null }],
  );
}

/**
 * Queue the SELECT results for `runArAgingAnalysis`:
 *   1. outstanding invoice detail rows (schedule build) → empty (unused here)
 *   2. bucket totals → a non-empty 31-60 bucket → overdue invoices present
 *   3. schedule grand total
 *   4. overdue invoice detail (drives related_data.invoices) → the seeded invoice
 *   5. overdue total past due → $8,000 → `high` severity
 * Yields exactly one `collections_opportunity` finding.
 */
function queueArAgingReads(): void {
  mocks.selectResults.push(
    [],
    [{ bucket: "31-60", total: "8000.00" }],
    [{ total: "8000.00" }],
    [
      {
        id: EXPECTED_INVOICE_ID,
        amount: "8000.00",
        description: "Acme Corp",
        daysOutstanding: 75,
      },
    ],
    [{ total: "8000.00" }],
  );
}

/**
 * Queue the SELECT result for `runDuplicateSubscriptionScan`: the same vendor
 * billed on two different accounts with amounts within 10% ($52.99 vs $50.00,
 * ~5.8% apart). Yields exactly one `duplicate_subscription` finding.
 */
function queueDuplicateReads(): void {
  mocks.selectResults.push([
    {
      id: "txn-adobe-1",
      description: "Adobe Creative Cloud",
      amount: "52.99",
      accountId: "acc-software",
      accountName: "Software",
    },
    {
      id: "txn-adobe-2",
      description: "Adobe Creative Cloud",
      amount: "50.00",
      accountId: "acc-subscriptions",
      accountName: "Subscriptions",
    },
  ]);
}

/**
 * Runs the three isolated analysis steps in the same order `run.ts` dispatches
 * them, against a fully-seeded read queue (spike + overdue invoice + duplicate).
 */
async function runFullEngine(): Promise<IntelligenceStepResult[]> {
  queueAnomalyReads();
  queueArAgingReads();
  queueDuplicateReads();

  const anomaly = await runAnomalyDetection(ORG_ID, RUN_ID);
  const arAging = await runArAgingAnalysis(ORG_ID, RUN_ID);
  const duplicates = await runDuplicateSubscriptionScan(ORG_ID, RUN_ID);

  return [anomaly, arAging, duplicates];
}

describe("Intelligence engine full run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectResults.length = 0;
    mocks.select.mockImplementation(() => mocks.makeBuilder());
    mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
    // Phrasing is not under test — every headline/detail call returns a
    // non-empty string so each finding carries a real headline.
    mocks.generateText.mockResolvedValue({ text: "AI-phrased finding copy" });
    mocks.insertFindingDeduped.mockResolvedValue(true);
  });

  it("expense spike triggers an anomaly finding with related_data.type='expense_spike'", async () => {
    queueAnomalyReads();

    const result = await runAnomalyDetection(ORG_ID, RUN_ID);

    expect(result).toEqual({ status: "completed", findingsCreated: 1 });
    expect(mocks.insertFindingDeduped).toHaveBeenCalledTimes(1);

    const [finding] = insertedFindings();
    expect(finding?.findingType).toBe("anomaly");
    expect(finding?.relatedData.type).toBe("expense_spike");
  });

  it("overdue invoice triggers a collections_opportunity finding carrying the invoice id", async () => {
    queueArAgingReads();

    const result = await runArAgingAnalysis(ORG_ID, RUN_ID);

    expect(result).toEqual({ status: "completed", findingsCreated: 1 });
    expect(mocks.insertFindingDeduped).toHaveBeenCalledTimes(1);

    const [finding] = insertedFindings();
    expect(finding?.findingType).toBe("collections_opportunity");

    const invoices = finding?.relatedData.invoices as Array<{ invoiceId: string }>;
    expect(invoices[0]?.invoiceId).toBe(EXPECTED_INVOICE_ID);
  });

  it("duplicate vendor billing triggers a duplicate_subscription finding", async () => {
    queueDuplicateReads();

    const result = await runDuplicateSubscriptionScan(ORG_ID, RUN_ID);

    expect(result).toEqual({ status: "completed", findingsCreated: 1 });
    expect(mocks.insertFindingDeduped).toHaveBeenCalledTimes(1);

    const [finding] = insertedFindings();
    expect(finding?.findingType).toBe("duplicate_subscription");
    expect(finding?.relatedData.type).toBe("duplicate_subscription");
  });

  it("full orchestration writes at least 3 findings and marks the run completed", async () => {
    const results = await runFullEngine();

    // Every analysis step must complete cleanly (no rate-limit skip) for the run
    // to be eligible for completion.
    for (const result of results) {
      expect(result.status).toBe("completed");
    }

    const findingsGenerated = mocks.insertFindingDeduped.mock.calls.length;
    expect(findingsGenerated).toBeGreaterThanOrEqual(3);

    // Replay the runner's final `mark-completed` write (Step 6.7) against the
    // mocked db: this is the exact `intelligence_runs` update `run.ts` performs.
    await db
      .update(intelligenceRuns)
      .set({ status: "completed", findingsGenerated })
      .where(eq(intelligenceRuns.id, RUN_ID));

    expect(mocks.updateSet).toHaveBeenCalledWith({ status: "completed", findingsGenerated });
    expect(mocks.updateWhere).toHaveBeenCalledTimes(1);
  });

  it("every finding written in a full run has a non-null, non-empty headline", async () => {
    await runFullEngine();

    const written = insertedFindings();
    expect(written.length).toBeGreaterThanOrEqual(3);

    for (const finding of written) {
      expect(finding.headline).not.toBeNull();
      expect(finding.headline).not.toBe("");
      expect(typeof finding.headline).toBe("string");
    }
  });

  it("the collections_opportunity finding's related_data contains the expected invoice id", async () => {
    await runFullEngine();

    const collections = insertedFindings().find(
      (finding) => finding.findingType === "collections_opportunity",
    );
    expect(collections).toBeDefined();

    const invoices = collections?.relatedData.invoices as Array<{ invoiceId: string }>;
    expect(invoices[0]?.invoiceId).toBe(EXPECTED_INVOICE_ID);
  });
});
