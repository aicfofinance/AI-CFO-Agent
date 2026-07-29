import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildCashFlowProjection,
  generateCashFlowRiskFinding,
  type CashFlowProjection,
} from "@/lib/financial/intelligence/cash-flow";
import { runAnomalyDetection } from "@/lib/financial/intelligence/anomaly";
import { runArAgingAnalysis } from "@/lib/financial/intelligence/ar-aging-intelligence";
import { runDuplicateSubscriptionScan } from "@/lib/financial/intelligence/duplicates";

/**
 * Step 15.3 (timing portion) — step timing compliance test.
 *
 * Vercel Hobby imposes a 10-second function timeout per invocation, and each
 * intelligence analysis type runs as its own isolated `step.run()` in
 * `jobs/intelligence/run.ts`. CLAUDE.md (Intelligence Engine Rules) therefore
 * requires every step to complete in under 8 seconds in isolation. This test
 * runs each of the five step functions end-to-end with mocked DB + AI and
 * asserts the wall-clock elapsed time stays under the 8-second budget.
 *
 * The functions are called for real — only their two external dependencies are
 * mocked, so the deterministic computation inside each step (grouping, gap and
 * median math, bucketing, cross-account pairing, day-by-day balance walk) is
 * genuinely exercised. The 8-second threshold is generous; with mocked I/O each
 * step completes in well under 100ms. The point is to catch a regression that
 * makes the pure computation itself slow, not to benchmark the network.
 *
 * The mock harness mirrors `full-run.test.ts`: the `ai` package, the Drizzle
 * client, the env schema and the model router are all mocked (the corporate
 * firewall blocks DB ports, and no test may reach a live AI provider). `db.select()`
 * returns a thenable query-builder whose terminal `await` dequeues the next canned
 * result from a FIFO queue, so each step's SQL reads pull their rows in call order.
 * `insertFindingDeduped` is stubbed so a finding write is a single resolved call
 * rather than a dedup SELECT + INSERT chain.
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
  // dequeues exactly one entry (the step reads run their queries sequentially).
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
    // Stub only the model factory (never a direct provider import — CLAUDE.md);
    // keep the real detectRateLimitError so the 429-skip contract stays wired.
    getModel: vi.fn(() => ({}) as never),
  };
});

// The alias path resolves to the same module the step files import relatively as
// `./findings-writer`, so this interception applies to all four step modules.
vi.mock("@/lib/financial/intelligence/findings-writer", () => ({
  insertFindingDeduped: mocks.insertFindingDeduped,
}));

const TEST_ORG_ID = "22222222-2222-2222-2222-222222222222";
const TEST_RUN_ID = "33333333-3333-3333-3333-333333333333";

/** Every step must finish in under this many milliseconds in isolation. */
const STEP_TIMEOUT_MS = 8000;
const MS_PER_DAY = 86_400_000;

/** Format epoch ms as an ISO `YYYY-MM-DD` date string (UTC). */
function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * 90 days of expense transactions across ten vendors, the shape
 * `detectRecurringExpenses` reads. This gives `buildCashFlowProjection` a
 * realistic volume to group, sort, and gap-analyse rather than an empty list,
 * so the timing assertion exercises the real per-vendor computation.
 */
function ninetyDaysOfCharges(): Array<{
  vendorName: string;
  transactionDate: string;
  amount: string;
}> {
  const today = Date.now();
  const rows: Array<{ vendorName: string; transactionDate: string; amount: string }> = [];
  for (let dayAgo = 0; dayAgo < 90; dayAgo += 1) {
    rows.push({
      vendorName: `Vendor ${dayAgo % 10}`,
      transactionDate: isoDate(today - dayAgo * MS_PER_DAY),
      amount: (100 + dayAgo).toFixed(2),
    });
  }
  return rows;
}

/**
 * Queue the six SELECT results `buildCashFlowProjection` reads in order:
 *   1. getCashPosition               → starting cash balance
 *   2. buildArAgingSchedule invoices → (empty; no projected inflows)
 *   3. buildArAgingSchedule buckets  → (empty)
 *   4. buildArAgingSchedule total    → grand total
 *   5. detectRecurringExpenses       → 90 days of vendor charges
 *   6. MIN(transaction_date)         → history start (90 days → 'medium')
 */
function queueCashFlowProjectionReads(): void {
  mocks.selectResults.push(
    [{ cashPosition: "50000.00" }],
    [],
    [],
    [{ total: "0.00" }],
    ninetyDaysOfCharges(),
    [{ minDate: isoDate(Date.now() - 90 * MS_PER_DAY) }],
  );
}

/**
 * Queue the SELECT results for `runAnomalyDetection`:
 *   1. expense-spike threshold (empty → default 25%)
 *   2. 7-day vs 30-day average → a spike (500 > 200 * 1.25) → one AI-phrased finding
 *   3. collections-slippage count → 0 (no slippage finding)
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
 *   1. outstanding invoice detail (schedule build) → empty
 *   2. bucket totals → a non-empty 31-60 bucket → overdue present
 *   3. schedule grand total
 *   4. overdue invoice detail (drives related_data.invoices)
 *   5. overdue total past due → one AI-phrased finding
 */
function queueArAgingReads(): void {
  mocks.selectResults.push(
    [],
    [{ bucket: "31-60", total: "8000.00" }],
    [{ total: "8000.00" }],
    [
      {
        id: "44444444-4444-4444-4444-444444444444",
        amount: "8000.00",
        description: "Acme Corp",
        daysOutstanding: 75,
      },
    ],
    [{ total: "8000.00" }],
  );
}

/**
 * Queue the single SELECT result for `runDuplicateSubscriptionScan`: the same
 * vendor billed on two different accounts within 10% → one AI-phrased finding.
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

describe("Intelligence step timing — all steps must complete in under 8 seconds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectResults.length = 0;
    mocks.select.mockImplementation(() => mocks.makeBuilder());
    mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
    // Phrasing is not under test — every headline/detail call resolves instantly
    // with a non-empty string so each finding carries a real headline.
    mocks.generateText.mockResolvedValue({ text: "AI-phrased finding copy" });
    mocks.insertFindingDeduped.mockResolvedValue(true);
  });

  it("buildCashFlowProjection completes in under 8 seconds", async () => {
    queueCashFlowProjectionReads();

    const start = performance.now();
    const result = await buildCashFlowProjection(TEST_ORG_ID, 30);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(STEP_TIMEOUT_MS);
    // Verify the real result shape (a projection is never returned without a
    // confidence level — CLAUDE.md) and that the day-by-day walk produced the
    // requested 30 entries.
    expect(result.projectedDays).toHaveLength(30);
    expect(result.confidenceLevel).toBe("medium");
    expect(result).toHaveProperty("minimumProjectedBalance");
    expect(result).toHaveProperty("riskDate");
  });

  it("generateCashFlowRiskFinding completes in under 8 seconds", async () => {
    const riskDate = isoDate(Date.now() + 10 * MS_PER_DAY);
    const mockProjection: CashFlowProjection = {
      orgId: TEST_ORG_ID,
      projectedDays: [
        { date: riskDate, projectedBalance: "-5000.00", inflows: "0.00", outflows: "5000.00" },
      ],
      minimumProjectedBalance: "-5000.00",
      riskDate,
      confidenceLevel: "medium",
      generatedAt: new Date().toISOString(),
    };

    const start = performance.now();
    const result = await generateCashFlowRiskFinding(TEST_ORG_ID, TEST_RUN_ID, mockProjection);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(STEP_TIMEOUT_MS);
    expect(result.status).toBe("created");
    expect(mocks.insertFindingDeduped).toHaveBeenCalledTimes(1);
  });

  it("runAnomalyDetection completes in under 8 seconds", async () => {
    queueAnomalyReads();

    const start = performance.now();
    const result = await runAnomalyDetection(TEST_ORG_ID, TEST_RUN_ID);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(STEP_TIMEOUT_MS);
    expect(result).toEqual({ status: "completed", findingsCreated: 1 });
  });

  it("runArAgingAnalysis completes in under 8 seconds", async () => {
    queueArAgingReads();

    const start = performance.now();
    const result = await runArAgingAnalysis(TEST_ORG_ID, TEST_RUN_ID);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(STEP_TIMEOUT_MS);
    expect(result).toEqual({ status: "completed", findingsCreated: 1 });
  });

  it("runDuplicateSubscriptionScan completes in under 8 seconds", async () => {
    queueDuplicateReads();

    const start = performance.now();
    const result = await runDuplicateSubscriptionScan(TEST_ORG_ID, TEST_RUN_ID);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(STEP_TIMEOUT_MS);
    expect(result).toEqual({ status: "completed", findingsCreated: 1 });
  });
});
