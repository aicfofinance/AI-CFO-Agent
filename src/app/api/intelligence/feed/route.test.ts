import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/intelligence/feed/route";

/**
 * Unit tests for `GET /api/intelligence/feed` (Step 6.10).
 *
 * The Drizzle client and `getRequestContext` are mocked so the route's own
 * transformation logic is under test in isolation — no live database. The
 * severity ORDER BY and the expiry WHERE predicate are delegated to Postgres,
 * so at this layer we assert that the route (a) applies a filter and an
 * order-by, (b) preserves the DB row order, (c) maps rows to the response
 * shape, (d) derives `hasActionableType`, (e) computes `bySeverity` / `total`
 * over the count query, and (f) drives cursor pagination. End-to-end expiry and
 * sort behaviour is covered by the seeded intelligence integration suite.
 */

/** The selected row shape returned by the mocked page query (createdAt is a Date). */
type FindingRow = {
  id: string;
  findingType: string;
  severity: string;
  headline: string;
  detail: string;
  recommendedAction: string | null;
  relatedData: Record<string, unknown>;
  status: string;
  createdAt: Date;
  expiresAt: Date | null;
};

const mocks = vi.hoisted(() => {
  class RequestContextError extends Error {
    readonly status: number;
    readonly code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.name = "RequestContextError";
      this.status = status;
      this.code = code;
    }
  }
  return {
    RequestContextError,
    ORG_ID: "22222222-2222-2222-2222-222222222222",
    USER_ID: "11111111-1111-1111-1111-111111111111",
    getRequestContext: vi.fn(),
    pageRows: vi.fn<() => FindingRow[]>(() => []),
    countRows: vi.fn<() => Array<{ severity: string; count: number }>>(() => []),
    suppressedMediumRows: vi.fn<() => Array<{ count: number }>>(() => [{ count: 0 }]),
    whereArg: vi.fn<(predicate: unknown) => void>(),
    orderByArg: vi.fn<(...args: unknown[]) => void>(),
  };
});

vi.mock("@/lib/platform/auth/session", () => ({
  getRequestContext: mocks.getRequestContext,
  RequestContextError: mocks.RequestContextError,
}));

// Each GET runs three sequential `db.select()` chains, always in this order:
// (1) the page query (from → where → orderBy → limit), (2) the severity count
// query (from → where → groupBy), and (3) the 14-day medium-suppression
// detection query (from → where, awaited directly). `selectCallCount` increments
// across the whole test file (reset in `beforeEach`); the suppression query is
// therefore every third call, matched with `callNum % 3 === 0` so a test that
// invokes GET more than once still routes each GET's third query correctly.
let selectCallCount = 0;

vi.mock("@/lib/platform/db/client", () => ({
  db: {
    select: () => {
      selectCallCount++;
      const callNum = selectCallCount;
      return {
        from: () => ({
          where: (predicate: unknown) => {
            mocks.whereArg(predicate);
            if (callNum % 3 === 0) {
              // Suppression-detection query resolves directly from `.where()`.
              return Promise.resolve(mocks.suppressedMediumRows());
            }
            return {
              orderBy: (...args: unknown[]) => {
                mocks.orderByArg(...args);
                return { limit: () => Promise.resolve(mocks.pageRows()) };
              },
              groupBy: () => Promise.resolve(mocks.countRows()),
            };
          },
        }),
      };
    },
  },
}));

/** Builds a full page-query row with sensible defaults. */
function row(overrides: Partial<FindingRow> & { id: string }): FindingRow {
  return {
    findingType: "anomaly",
    severity: "medium",
    headline: "A finding",
    detail: "Detail text.",
    recommendedAction: null,
    relatedData: {},
    status: "active",
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    expiresAt: null,
    ...overrides,
  };
}

function feedRequest(cursor?: string): Request {
  const url = new URL("https://app.example.com/api/intelligence/feed");
  if (cursor) url.searchParams.set("cursor", cursor);
  return new Request(url);
}

describe("GET /api/intelligence/feed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectCallCount = 0;
    mocks.getRequestContext.mockResolvedValue({ orgId: mocks.ORG_ID, userId: mocks.USER_ID });
    mocks.pageRows.mockReturnValue([]);
    mocks.countRows.mockReturnValue([]);
    mocks.suppressedMediumRows.mockReturnValue([{ count: 0 }]);
  });

  it("returns active findings in the DB (critical-first) order with an order-by applied", async () => {
    mocks.pageRows.mockReturnValue([
      row({ id: "a", severity: "critical", createdAt: new Date("2026-07-04T00:00:00.000Z") }),
      row({ id: "b", severity: "high", createdAt: new Date("2026-07-03T00:00:00.000Z") }),
      row({ id: "c", severity: "medium", createdAt: new Date("2026-07-02T00:00:00.000Z") }),
      row({ id: "d", severity: "low", createdAt: new Date("2026-07-01T00:00:00.000Z") }),
    ]);

    const res = await GET(feedRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.map((f: { severity: string }) => f.severity)).toEqual([
      "critical",
      "high",
      "medium",
      "low",
    ]);
    // Sorting is delegated to Postgres — assert the route drives the ORDER BY.
    expect(mocks.orderByArg).toHaveBeenCalled();
  });

  it("applies a WHERE filter (active + non-expired) to the page, count, and suppression queries", async () => {
    await GET(feedRequest());
    // Three queries run: the page query, the count query, and the medium
    // suppression-detection query — all filtered.
    expect(mocks.whereArg).toHaveBeenCalledTimes(3);
    expect(mocks.whereArg.mock.calls.every(([predicate]) => predicate !== undefined)).toBe(true);
  });

  it("returns an empty array and zeroed meta when there are no active findings", async () => {
    const res = await GET(feedRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
    expect(body.meta.bySeverity).toEqual({ critical: 0, high: 0, medium: 0, low: 0 });
    expect(body.meta.total).toBe(0);
    expect(body.meta.nextCursor).toBeNull();
    expect(body.meta.mediumFindingsSuppressed).toBe(false);
  });

  it("returns mediumFindingsSuppressed=false when no old medium findings exist", async () => {
    mocks.suppressedMediumRows.mockReturnValue([{ count: 0 }]);

    const res = await GET(feedRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.meta.mediumFindingsSuppressed).toBe(false);
  });

  it("returns mediumFindingsSuppressed=true when the suppression query has count>0", async () => {
    mocks.suppressedMediumRows.mockReturnValue([{ count: 2 }]);

    const res = await GET(feedRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.meta.mediumFindingsSuppressed).toBe(true);
  });

  it("computes bySeverity counts and total from the count query", async () => {
    mocks.countRows.mockReturnValue([
      { severity: "critical", count: 2 },
      { severity: "high", count: 3 },
      { severity: "medium", count: 1 },
      { severity: "low", count: 4 },
    ]);

    const res = await GET(feedRequest());
    const body = await res.json();

    expect(body.meta.bySeverity).toEqual({ critical: 2, high: 3, medium: 1, low: 4 });
    expect(body.meta.total).toBe(10);
  });

  it("derives hasActionableType: true for cash_flow_risk, false for anomaly", async () => {
    mocks.pageRows.mockReturnValue([
      row({ id: "cf", findingType: "cash_flow_risk" }),
      row({ id: "an", findingType: "anomaly" }),
    ]);

    const res = await GET(feedRequest());
    const body = await res.json();

    const byId = new Map<string, boolean>(
      body.data.map((f: { id: string; hasActionableType: boolean }) => [f.id, f.hasActionableType]),
    );
    expect(byId.get("cf")).toBe(true);
    expect(byId.get("an")).toBe(false);
  });

  it("returns a nextCursor when a further page exists and null on the last page", async () => {
    // 21 rows (PAGE_SIZE + 1) → hasMore → 20 returned, nextCursor set to row 20.
    const rows: FindingRow[] = Array.from({ length: 21 }, (_, i) =>
      row({
        id: `id-${i}`,
        createdAt: new Date(Date.UTC(2026, 6, 1, 0, 0, i)),
      }),
    );
    mocks.pageRows.mockReturnValue(rows);

    const res = await GET(feedRequest());
    const body = await res.json();

    expect(body.data).toHaveLength(20);
    expect(body.meta.nextCursor).not.toBeNull();

    const decoded = JSON.parse(Buffer.from(body.meta.nextCursor, "base64").toString("utf8"));
    const twentieth = rows[19];
    expect(twentieth).toBeDefined();
    expect(decoded.id).toBe(twentieth?.id);
    expect(decoded.createdAt).toBe(twentieth?.createdAt.toISOString());

    // Last page: exactly PAGE_SIZE rows → no further page.
    mocks.pageRows.mockReturnValue(rows.slice(0, 20));
    const res2 = await GET(feedRequest());
    const body2 = await res2.json();
    expect(body2.data).toHaveLength(20);
    expect(body2.meta.nextCursor).toBeNull();
  });

  it("returns 401 when the request is unauthenticated", async () => {
    mocks.getRequestContext.mockRejectedValue(
      new mocks.RequestContextError(401, "UNAUTHORIZED", "Authentication required."),
    );

    const res = await GET(feedRequest());
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(body.error.request_id).toBeDefined();
  });

  it("returns 403 when the user has no org membership", async () => {
    mocks.getRequestContext.mockRejectedValue(
      new mocks.RequestContextError(403, "NO_ORG_MEMBERSHIP", "No organization membership found."),
    );

    const res = await GET(feedRequest());
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("NO_ORG_MEMBERSHIP");
    expect(body.error.request_id).toBeDefined();
  });
});
