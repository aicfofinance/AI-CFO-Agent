import { beforeEach, describe, expect, it, vi } from "vitest";

import { PATCH } from "@/app/api/alert-configs/[alertType]/route";

/**
 * Unit tests for `PATCH /api/alert-configs/:alertType` (Step 14.1-api).
 *
 * The Drizzle client and `getRequestContext` are mocked. The upsert's `values`
 * and conflict `set` are captured so the tests can assert that only the provided
 * body fields are written and that `orgId` always comes from the session, never
 * the body (CLAUDE.md, Multi-tenancy Rules).
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
    getRequestContext: vi.fn(),
    insertValues: vi.fn<(values: Record<string, unknown>) => void>(),
    conflictSet: vi.fn<(arg: { set: Record<string, unknown> }) => void>(),
    returnedRow: {} as Record<string, unknown>,
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
          onConflictDoUpdate: (arg: { set: Record<string, unknown> }) => {
            mocks.conflictSet(arg);
            return {
              returning: () => Promise.resolve([mocks.returnedRow]),
            };
          },
        };
      },
    }),
  },
}));

function createRequest(alertType: string, body?: unknown): Request {
  return new Request(`https://app.example.com/api/alert-configs/${alertType}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function params(alertType: string): { params: Promise<{ alertType: string }> } {
  return { params: Promise.resolve({ alertType }) };
}

describe("PATCH /api/alert-configs/:alertType", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestContext.mockResolvedValue({ orgId: mocks.ORG_ID, userId: mocks.USER_ID });
    mocks.returnedRow = { isEnabled: true, emailNotifications: true };
  });

  it("updates isEnabled", async () => {
    mocks.returnedRow = { isEnabled: false, emailNotifications: true };

    const res = await PATCH(createRequest("anomaly", { isEnabled: false }), params("anomaly"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual({
      alertType: "anomaly",
      isEnabled: false,
      emailNotifications: true,
    });

    // Only isEnabled is written; emailNotifications is absent from the set.
    const set = mocks.conflictSet.mock.calls[0]?.[0]?.set;
    expect(set?.isEnabled).toBe(false);
    expect(set).not.toHaveProperty("emailNotifications");
    // orgId always comes from the session context.
    expect(mocks.insertValues.mock.calls[0]?.[0]?.orgId).toBe(mocks.ORG_ID);
  });

  it("updates emailNotifications", async () => {
    mocks.returnedRow = { isEnabled: true, emailNotifications: false };

    const res = await PATCH(
      createRequest("cash_flow_risk", { emailNotifications: false }),
      params("cash_flow_risk"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual({
      alertType: "cash_flow_risk",
      isEnabled: true,
      emailNotifications: false,
    });

    const set = mocks.conflictSet.mock.calls[0]?.[0]?.set;
    expect(set?.emailNotifications).toBe(false);
    expect(set).not.toHaveProperty("isEnabled");
  });

  it("returns 400 for an unknown alertType", async () => {
    const res = await PATCH(
      createRequest("not_a_real_type", { isEnabled: false }),
      params("not_a_real_type"),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.request_id).toBeDefined();
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });

  it("returns 400 when neither field is provided", async () => {
    const res = await PATCH(createRequest("anomaly", {}), params("anomaly"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });

  it("returns 401 when the request is unauthenticated", async () => {
    mocks.getRequestContext.mockRejectedValue(
      new mocks.RequestContextError(401, "UNAUTHORIZED", "Authentication required."),
    );

    const res = await PATCH(createRequest("anomaly", { isEnabled: false }), params("anomaly"));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(body.error.request_id).toBeDefined();
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });
});
