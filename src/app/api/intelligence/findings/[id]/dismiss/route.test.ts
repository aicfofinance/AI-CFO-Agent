import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/intelligence/findings/[id]/dismiss/route";

/**
 * Unit tests for `POST /api/intelligence/findings/:id/dismiss` (Step 6.11).
 *
 * The Drizzle client and `getRequestContext` are mocked. The finding lookup is
 * scoped to the caller's org (`id = :id AND org_id = :orgId`); a cross-org id
 * therefore returns no row and yields a 404 that never reveals existence
 * (CLAUDE.md). The dismiss reason enum is enforced by Zod at the application
 * layer since the column has no DB CHECK constraint.
 */

type FindingRow = { id: string; status: string };

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
    FINDING_ID: "33333333-3333-3333-3333-333333333333",
    getRequestContext: vi.fn(),
    selectRows: vi.fn<() => FindingRow[]>(() => []),
    setArg: vi.fn<(values: Record<string, unknown>) => void>(),
    updateWhere: vi.fn<() => Promise<void>>(() => Promise.resolve()),
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
        where: () => ({ limit: () => Promise.resolve(mocks.selectRows()) }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        mocks.setArg(values);
        return { where: mocks.updateWhere };
      },
    }),
  },
}));

function dismissRequest(body: unknown): Request {
  return new Request(
    `https://app.example.com/api/intelligence/findings/${mocks.FINDING_ID}/dismiss`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

const params = { params: Promise.resolve({ id: mocks.FINDING_ID }) };

describe("POST /api/intelligence/findings/:id/dismiss", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestContext.mockResolvedValue({ orgId: mocks.ORG_ID, userId: mocks.USER_ID });
    mocks.selectRows.mockReturnValue([]);
    mocks.updateWhere.mockResolvedValue(undefined);
  });

  it("dismisses an active finding and returns 200 with the dismissed status", async () => {
    mocks.selectRows.mockReturnValue([{ id: mocks.FINDING_ID, status: "active" }]);

    const res = await POST(dismissRequest({ reason: "not_relevant" }), params);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual({ id: mocks.FINDING_ID, status: "dismissed" });

    const setValues = mocks.setArg.mock.calls[0]?.[0];
    expect(setValues?.status).toBe("dismissed");
    expect(setValues?.dismissReason).toBe("not_relevant");
    expect(setValues?.dismissedBy).toBe(mocks.USER_ID);
    expect(setValues?.dismissedAt).toBeInstanceOf(Date);
  });

  it("returns 409 when the finding is not active", async () => {
    mocks.selectRows.mockReturnValue([{ id: mocks.FINDING_ID, status: "dismissed" }]);

    const res = await POST(dismissRequest({ reason: "acknowledged" }), params);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error.code).toBe("FINDING_NOT_ACTIVE");
    expect(body.error.request_id).toBeDefined();
    // A non-active finding is never updated.
    expect(mocks.setArg).not.toHaveBeenCalled();
  });

  it("returns 400 when the reason is not a supported enum value", async () => {
    const res = await POST(dismissRequest({ reason: "made_up_reason" }), params);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.request_id).toBeDefined();
  });

  it("returns 404 when the finding does not exist in the caller's org", async () => {
    mocks.selectRows.mockReturnValue([]);

    const res = await POST(dismissRequest({ reason: "already_handled" }), params);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
    expect(mocks.setArg).not.toHaveBeenCalled();
  });

  it("returns 404 for a finding that belongs to a different org (org-scoped lookup)", async () => {
    // The lookup is filtered by org_id, so another org's finding returns no row.
    mocks.selectRows.mockReturnValue([]);

    const res = await POST(dismissRequest({ reason: "false_positive" }), params);
    expect(res.status).toBe(404);
  });

  it("returns 401 when the request is unauthenticated", async () => {
    mocks.getRequestContext.mockRejectedValue(
      new mocks.RequestContextError(401, "UNAUTHORIZED", "Authentication required."),
    );

    const res = await POST(dismissRequest({ reason: "not_relevant" }), params);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(body.error.request_id).toBeDefined();
  });
});
