import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/data/export/route";

/**
 * Unit tests for `GET /api/data/export` (Step 10.5).
 *
 * `getRequestContext`, the Drizzle client, the schema table sentinels, and `env`
 * are mocked. `env` is mocked without Upstash credentials so the in-process
 * window fallback is exercised — this lets the "second click within an hour →
 * 429" rule be verified deterministically without a live Redis (DoD).
 *
 * The org is always sourced from the session context; each test uses a distinct
 * org id because the fallback window Map is module-level and persists between
 * tests.
 */

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
  const createdAt = new Date("2026-07-30T12:00:00.000Z");
  return {
    RequestContextError,
    createdAt,
    getRequestContext: vi.fn(),
    rowsByTable: {
      organizations: [{ slug: "acme-co" }] as unknown[],
      conversations: [{ id: "conv-1", title: "Burn rate", createdAt }] as unknown[],
      messages: [
        {
          id: "msg-1",
          conversationId: "conv-1",
          role: "user",
          content: "What is my burn rate?",
          createdAt,
          modelUsed: null,
        },
        {
          id: "msg-2",
          conversationId: "conv-1",
          role: "assistant",
          content: "Your burn rate is...",
          createdAt,
          modelUsed: "claude",
        },
      ] as unknown[],
      findings: [
        {
          id: "find-1",
          findingType: "anomaly",
          severity: "high",
          headline: "Expense spike",
          detail: "Marketing spend doubled.",
          recommendedAction: "Review vendor invoices.",
          status: "active",
          relatedData: { vendor: "AdCo" },
          createdAt,
          expiresAt: null,
        },
      ] as unknown[],
      actionDrafts: [
        {
          id: "draft-1",
          findingId: "find-1",
          actionType: "vendor_negotiation",
          subjectLine: "Invoice question",
          draftContent: "Hello, ...",
          status: "draft",
          createdAt,
        },
      ] as unknown[],
      reports: [
        {
          id: "report-1",
          reportType: "monthly",
          periodStart: "2026-06-01",
          periodEnd: "2026-06-30",
          status: "completed",
          content: { summary: "June was solid." },
          createdAt,
        },
      ] as unknown[],
    } as Record<string, unknown[]>,
  };
});

vi.mock("@/lib/env", () => ({
  env: { UPSTASH_REDIS_REST_URL: undefined, UPSTASH_REDIS_REST_TOKEN: undefined },
}));

vi.mock("@/lib/platform/auth/session", () => ({
  getRequestContext: mocks.getRequestContext,
  RequestContextError: mocks.RequestContextError,
}));

vi.mock("@/lib/platform/db/schema", () => ({
  organizations: { _t: "organizations" },
  conversations: { _t: "conversations" },
  messages: { _t: "messages" },
  findings: { _t: "findings" },
  actionDrafts: { _t: "actionDrafts" },
  reports: { _t: "reports" },
}));

type Chain = {
  where: () => Chain;
  orderBy: () => Promise<unknown[]>;
  limit: () => Promise<unknown[]>;
};

function makeChain(rows: unknown[]): Chain {
  return {
    where: () => makeChain(rows),
    orderBy: () => Promise.resolve(rows),
    limit: () => Promise.resolve(rows),
  };
}

vi.mock("@/lib/platform/db/client", () => ({
  db: {
    select: () => ({
      from: (table: { _t: string }) => makeChain(mocks.rowsByTable[table._t] ?? []),
    }),
  },
}));

function createRequest(): Request {
  return new Request("https://app.example.com/api/data/export", { method: "GET" });
}

describe("GET /api/data/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with a zip containing all expected files", async () => {
    mocks.getRequestContext.mockResolvedValue({ orgId: "org-200", userId: "user-1" });

    const res = await GET(createRequest());

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/zip");
    expect(res.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="acme-co_data-export_\d{4}-\d{2}-\d{2}\.zip"$/,
    );

    const zip = await JSZip.loadAsync(await res.arrayBuffer());
    expect(zip.file("README.txt")).not.toBeNull();
    expect(zip.file("conversations/conversations.json")).not.toBeNull();
    expect(zip.file("findings/findings.json")).not.toBeNull();
    expect(zip.file("action_drafts/drafts.json")).not.toBeNull();
    expect(zip.file("reports/index.json")).not.toBeNull();
    expect(zip.file("reports/report-1.json")).not.toBeNull();

    const conversationsJson = JSON.parse(
      await zip.file("conversations/conversations.json")!.async("string"),
    );
    expect(conversationsJson.conversations).toHaveLength(1);
    expect(conversationsJson.conversations[0].messages).toHaveLength(2);
  });

  it("returns 429 with a Retry-After header on a second export within the hour", async () => {
    mocks.getRequestContext.mockResolvedValue({ orgId: "org-429", userId: "user-1" });

    const first = await GET(createRequest());
    expect(first.status).toBe(200);

    const second = await GET(createRequest());
    const body = await second.json();

    expect(second.status).toBe(429);
    expect(body.error.code).toBe("EXPORT_RATE_LIMITED");
    expect(body.error.request_id).toBeDefined();
    expect(Number(second.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("returns 401 when the request is unauthenticated", async () => {
    mocks.getRequestContext.mockRejectedValue(
      new mocks.RequestContextError(401, "UNAUTHORIZED", "Authentication required."),
    );

    const res = await GET(createRequest());
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(body.error.request_id).toBeDefined();
  });

  it("returns 403 when the user has no org membership", async () => {
    mocks.getRequestContext.mockRejectedValue(
      new mocks.RequestContextError(403, "FORBIDDEN", "No organization membership."),
    );

    const res = await GET(createRequest());
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });
});
