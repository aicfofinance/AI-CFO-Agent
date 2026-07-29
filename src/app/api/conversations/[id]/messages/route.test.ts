import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/conversations/[id]/messages/route";

/**
 * Unit tests for `POST /api/conversations/:id/messages` (Step 11.3).
 *
 * `env`, `getRequestContext`, the Drizzle client, and `checkAndIncrementQuota`
 * are mocked. Streaming itself is not exercised here — the model is never
 * reached in any of these cases (each returns before step 8). The mocked `env`
 * omits Upstash credentials, so the route's rate limiter is skipped, keeping the
 * gating logic deterministic.
 *
 * The processing order under test: session → org-scoped conversation lookup →
 * Zod body validation → atomic quota decrement. A cross-org conversation id
 * yields no row and returns 404 (never leaking existence — CLAUDE.md).
 */

type ConversationRow = { id: string };

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
    CONV_ID: "44444444-4444-4444-4444-444444444444",
    getRequestContext: vi.fn(),
    conversationRows: vi.fn<() => ConversationRow[]>(() => []),
    checkAndIncrementQuota: vi.fn(),
  };
});

// No Upstash credentials → the route's lazy rate limiter returns null and is
// skipped. AI_PROVIDER is present so the imported router module loads cleanly.
vi.mock("@/lib/env", () => ({ env: { AI_PROVIDER: "google" } }));

vi.mock("@/lib/platform/auth/session", () => ({
  getRequestContext: mocks.getRequestContext,
  RequestContextError: mocks.RequestContextError,
}));

vi.mock("@/lib/billing/quota", () => ({
  checkAndIncrementQuota: mocks.checkAndIncrementQuota,
}));

vi.mock("@/lib/platform/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(mocks.conversationRows()) }),
      }),
    }),
    insert: () => ({
      values: () => ({ returning: () => Promise.resolve([{ id: "generated-id" }]) }),
    }),
  },
}));

function messagesRequest(body: unknown): Request {
  return new Request(`https://app.example.com/api/conversations/${mocks.CONV_ID}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: mocks.CONV_ID }) };

describe("POST /api/conversations/:id/messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestContext.mockResolvedValue({ orgId: mocks.ORG_ID, userId: mocks.USER_ID });
    mocks.conversationRows.mockReturnValue([{ id: mocks.CONV_ID }]);
    mocks.checkAndIncrementQuota.mockResolvedValue({ allowed: true, queriesRemaining: 41 });
  });

  it("returns 401 when the request is unauthenticated", async () => {
    mocks.getRequestContext.mockRejectedValue(
      new mocks.RequestContextError(401, "UNAUTHORIZED", "Authentication required."),
    );

    const res = await POST(messagesRequest({ question: "How much cash do I have?" }), params);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(body.error.request_id).toBeDefined();
  });

  it("returns 404 when the conversation is not in the caller's org", async () => {
    // The lookup is org-scoped, so another org's conversation returns no row.
    mocks.conversationRows.mockReturnValue([]);

    const res = await POST(messagesRequest({ question: "How much cash do I have?" }), params);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
    // A non-existent conversation is never quota-charged.
    expect(mocks.checkAndIncrementQuota).not.toHaveBeenCalled();
  });

  it("returns 400 when the question is empty (Zod validation)", async () => {
    const res = await POST(messagesRequest({ question: "" }), params);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.request_id).toBeDefined();
    // Validation fails before the quota is touched.
    expect(mocks.checkAndIncrementQuota).not.toHaveBeenCalled();
  });

  it("returns 429 with X-Queries-Remaining=0 when the quota is exhausted", async () => {
    mocks.checkAndIncrementQuota.mockResolvedValue({ allowed: false, queriesRemaining: 0 });

    const res = await POST(messagesRequest({ question: "How much cash do I have?" }), params);
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(body.error.code).toBe("QUOTA_EXCEEDED");
    expect(res.headers.get("X-Queries-Remaining")).toBe("0");
  });
});
