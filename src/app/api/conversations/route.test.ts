import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/conversations/route";

/**
 * Unit tests for `POST /api/conversations` (Step 11.3 prerequisite).
 *
 * The Drizzle client and `getRequestContext` are mocked. The inserted row's
 * `orgId` and `userId` always come from the session context, never the body
 * (CLAUDE.md, Multi-tenancy Rules), so the tests assert the inserted values are
 * the session values regardless of what the body contains.
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
  return {
    RequestContextError,
    ORG_ID: "22222222-2222-2222-2222-222222222222",
    USER_ID: "11111111-1111-1111-1111-111111111111",
    CONV_ID: "33333333-3333-3333-3333-333333333333",
    CREATED_AT: new Date("2026-07-30T12:00:00.000Z"),
    getRequestContext: vi.fn(),
    insertValues: vi.fn<(values: Record<string, unknown>) => void>(),
  };
});

vi.mock("@/lib/platform/auth/session", () => ({
  getRequestContext: mocks.getRequestContext,
  RequestContextError: mocks.RequestContextError,
}));

vi.mock("@/lib/platform/db/client", () => ({
  db: {
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        mocks.insertValues(values);
        return {
          returning: () => Promise.resolve([{ id: mocks.CONV_ID, createdAt: mocks.CREATED_AT }]),
        };
      },
    }),
  },
}));

function createRequest(body?: unknown): Request {
  return new Request("https://app.example.com/api/conversations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("POST /api/conversations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestContext.mockResolvedValue({ orgId: mocks.ORG_ID, userId: mocks.USER_ID });
  });

  it("returns 201 with the created conversation on valid input", async () => {
    const res = await POST(createRequest({ title: "Q3 burn rate" }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data).toEqual({
      id: mocks.CONV_ID,
      title: "Q3 burn rate",
      createdAt: mocks.CREATED_AT.toISOString(),
    });

    const inserted = mocks.insertValues.mock.calls[0]?.[0];
    expect(inserted?.orgId).toBe(mocks.ORG_ID);
    expect(inserted?.userId).toBe(mocks.USER_ID);
    expect(inserted?.title).toBe("Q3 burn rate");
  });

  it("defaults the title to 'Q&A Session' when none is provided", async () => {
    const res = await POST(createRequest({}));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.title).toBe("Q&A Session");
    expect(mocks.insertValues.mock.calls[0]?.[0]?.title).toBe("Q&A Session");
  });

  it("returns 401 when the request is unauthenticated", async () => {
    mocks.getRequestContext.mockRejectedValue(
      new mocks.RequestContextError(401, "UNAUTHORIZED", "Authentication required."),
    );

    const res = await POST(createRequest({ title: "anything" }));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(body.error.request_id).toBeDefined();
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });

  it("returns 400 when the title exceeds the max length", async () => {
    const res = await POST(createRequest({ title: "x".repeat(201) }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });
});
