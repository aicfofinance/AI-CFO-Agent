import { type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/intelligence/findings/route";

/**
 * Unit tests for `GET /api/intelligence/findings` (Step 14.0) — the multi-status
 * finding archive backing `/alerts`, distinct from the active-only
 * `GET /api/intelligence/feed`.
 *
 * The Drizzle client and `getRequestContext` are mocked so the route's own
 * logic is under test in isolation — no live database. Actual row filtering is
 * delegated to Postgres, so we assert the SHAPE of the WHERE predicate the
 * route builds (rendered to SQL via `PgDialect`): `status=active` must carry
 * the expiry guard (reproducing the feed), while `status=all` must NOT filter
 * by expiry (the archive is historical). Row mapping, dismissal-field exposure,
 * cursor pagination, and auth codes are asserted directly. End-to-end DB
 * behaviour is covered by the seeded intelligence integration suite.
 */

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
  dismissedAt: Date | null;
  dismissReason: string | null;
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
    countRows: vi.fn<() => Array<{ total: number }>>(() => [{ total: 0 }]),
    whereArgs: [] as unknown[],
  };
});

vi.mock("@/lib/platform/auth/session", () => ({
  getRequestContext: mocks.getRequestContext,
  RequestContextError: mocks.RequestContextError,
}));

vi.mock("@/lib/platform/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        // where() serves both the page query (.orderBy().limit()) and the
        // count query (awaited directly — the returned object is thenable).
        where: (predicate: unknown) => {
          mocks.whereArgs.push(predicate);
          return {
            orderBy: () => ({ limit: () => Promise.resolve(mocks.pageRows()) }),
            then: (
              resolve: (v: Array<{ total: number }>) => unknown,
              reject: (e: unknown) => unknown,
            ) => Promise.resolve(mocks.countRows()).then(resolve, reject),
          };
        },
      }),
    }),
  },
}));

const dialect = new PgDialect();

/** Renders a captured Drizzle WHERE predicate to its SQL text for assertions. */
function renderSql(predicate: unknown): string {
  return dialect.sqlToQuery(predicate as SQL).sql;
}

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
    dismissedAt: null,
    dismissReason: null,
    ...overrides,
  };
}

function archiveRequest(params: Record<string, string> = {}): Request {
  const url = new URL("https://app.example.com/api/intelligence/findings");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url);
}

describe("GET /api/intelligence/findings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.whereArgs.length = 0;
    mocks.getRequestContext.mockResolvedValue({ orgId: mocks.ORG_ID, userId: mocks.USER_ID });
    mocks.pageRows.mockReturnValue([]);
    mocks.countRows.mockReturnValue([{ total: 0 }]);
  });

  it("returns 401 when the request is unauthenticated", async () => {
    mocks.getRequestContext.mockRejectedValue(
      new mocks.RequestContextError(401, "UNAUTHORIZED", "Authentication required."),
    );

    const res = await GET(archiveRequest());
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(body.error.request_id).toBeDefined();
  });

  it("returns 403 when the user has no org membership", async () => {
    mocks.getRequestContext.mockRejectedValue(
      new mocks.RequestContextError(403, "NO_ORG_MEMBERSHIP", "No organization membership found."),
    );

    const res = await GET(archiveRequest());
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("NO_ORG_MEMBERSHIP");
  });

  it("status=dismissed filters by dismissed status and exposes dismissal fields", async () => {
    mocks.pageRows.mockReturnValue([
      row({
        id: "d1",
        status: "dismissed",
        dismissedAt: new Date("2026-07-05T00:00:00.000Z"),
        dismissReason: "not_relevant",
      }),
    ]);
    mocks.countRows.mockReturnValue([{ total: 1 }]);

    const res = await GET(archiveRequest({ status: "dismissed" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].status).toBe("dismissed");
    expect(body.data[0].dismissedAt).toBe("2026-07-05T00:00:00.000Z");
    expect(body.data[0].dismissReason).toBe("not_relevant");
    expect(body.meta.total).toBe(1);

    // The predicate must constrain by status and must NOT apply an expiry guard.
    const sql = renderSql(mocks.whereArgs[0]);
    expect(sql).toContain('"status"');
    expect(sql).not.toContain("expires_at");
  });

  it("status=active reproduces the feed filter (active AND non-expired)", async () => {
    await GET(archiveRequest({ status: "active" }));

    const sql = renderSql(mocks.whereArgs[0]);
    expect(sql).toContain('"status"');
    // Expiry guard is present so expired active findings are excluded, matching
    // GET /api/intelligence/feed exactly.
    expect(sql).toContain("expires_at");
  });

  it("status=all does NOT apply an expiry filter (full historical archive)", async () => {
    await GET(archiveRequest({ status: "all" }));

    const sql = renderSql(mocks.whereArgs[0]);
    expect(sql).not.toContain("expires_at");
    // Always org-scoped (CLAUDE.md, Multi-tenancy Rules).
    expect(sql).toContain("org_id");
  });

  it("applies finding_type and severity filters when provided", async () => {
    await GET(archiveRequest({ finding_type: "cash_flow_risk", severity: "critical" }));

    const sql = renderSql(mocks.whereArgs[0]);
    expect(sql).toContain("finding_type");
    expect(sql).toContain('"severity"');
  });

  it("derives hasActionableType: true for cash_flow_risk, false for anomaly", async () => {
    mocks.pageRows.mockReturnValue([
      row({ id: "cf", findingType: "cash_flow_risk" }),
      row({ id: "an", findingType: "anomaly" }),
    ]);

    const res = await GET(archiveRequest());
    const body = await res.json();

    const byId = new Map<string, boolean>(
      body.data.map((f: { id: string; hasActionableType: boolean }) => [f.id, f.hasActionableType]),
    );
    expect(byId.get("cf")).toBe(true);
    expect(byId.get("an")).toBe(false);
  });

  it("paginates: returns a nextCursor when a further page exists, null otherwise", async () => {
    // limit=20 default; 21 rows → hasMore → 20 returned + cursor.
    const rows: FindingRow[] = Array.from({ length: 21 }, (_, i) =>
      row({ id: `id-${i}`, createdAt: new Date(Date.UTC(2026, 6, 1, 0, 0, i)) }),
    );
    mocks.pageRows.mockReturnValue(rows);

    const res = await GET(archiveRequest());
    const body = await res.json();

    expect(body.data).toHaveLength(20);
    expect(body.meta.nextCursor).not.toBeNull();

    const decoded = JSON.parse(Buffer.from(body.meta.nextCursor, "base64").toString("utf8"));
    const twentieth = rows[19];
    expect(twentieth).toBeDefined();
    expect(decoded.id).toBe(twentieth?.id);

    // Exactly limit rows → no further page.
    mocks.pageRows.mockReturnValue(rows.slice(0, 20));
    const res2 = await GET(archiveRequest());
    const body2 = await res2.json();
    expect(body2.meta.nextCursor).toBeNull();
  });

  it("returns 400 for an invalid limit", async () => {
    const res = await GET(archiveRequest({ limit: "0" }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("INVALID_QUERY");
    expect(body.error.request_id).toBeDefined();
  });

  it("returns 400 for an invalid startDate", async () => {
    const res = await GET(archiveRequest({ startDate: "not-a-date" }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("INVALID_QUERY");
  });
});
