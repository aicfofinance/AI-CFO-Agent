import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/alert-configs/route";

/**
 * Unit tests for `GET /api/alert-configs` (Step 14.1-api).
 *
 * The Drizzle client and `getRequestContext` are mocked. The endpoint always
 * returns four rows in a fixed order; missing rows are backfilled with defaults.
 * The org filter always comes from the session, never user input (CLAUDE.md,
 * Multi-tenancy Rules).
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
    selectRows: vi.fn<() => unknown[]>(),
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
        where: () => Promise.resolve(mocks.selectRows()),
      }),
    }),
  },
}));

function createRequest(): Request {
  return new Request("https://app.example.com/api/alert-configs", { method: "GET" });
}

describe("GET /api/alert-configs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestContext.mockResolvedValue({ orgId: mocks.ORG_ID, userId: mocks.USER_ID });
    mocks.selectRows.mockReturnValue([]);
  });

  it("returns four config rows mapped to the AlertConfigItem shape", async () => {
    mocks.selectRows.mockReturnValue([
      { alertType: "cash_flow_risk", isEnabled: false, emailNotifications: true },
      { alertType: "anomaly", isEnabled: true, emailNotifications: false },
      { alertType: "collections_opportunity", isEnabled: false, emailNotifications: false },
      { alertType: "duplicate_subscription", isEnabled: true, emailNotifications: true },
    ]);

    const res = await GET(createRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual([
      { alertType: "cash_flow_risk", isEnabled: false, emailNotifications: true },
      { alertType: "anomaly", isEnabled: true, emailNotifications: false },
      { alertType: "collections_opportunity", isEnabled: false, emailNotifications: false },
      { alertType: "duplicate_subscription", isEnabled: true, emailNotifications: true },
    ]);
  });

  it("backfills default values for missing rows", async () => {
    // Only one row persisted; the other three types must come back as defaults.
    mocks.selectRows.mockReturnValue([
      { alertType: "anomaly", isEnabled: false, emailNotifications: false },
    ]);

    const res = await GET(createRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual([
      { alertType: "cash_flow_risk", isEnabled: true, emailNotifications: true },
      { alertType: "anomaly", isEnabled: false, emailNotifications: false },
      { alertType: "collections_opportunity", isEnabled: true, emailNotifications: true },
      { alertType: "duplicate_subscription", isEnabled: true, emailNotifications: true },
    ]);
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
});
