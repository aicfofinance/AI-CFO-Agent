import { beforeEach, describe, expect, it, vi } from "vitest";

import { DELETE, GET, PATCH } from "@/app/api/auth/me/route";

/**
 * Unit tests for `/api/auth/me` GET / PATCH / DELETE (Step 2.6).
 *
 * `getRequestContext` (and its `RequestContextError`), the Drizzle client, and
 * the Supabase server client are mocked. `displayName` is backed by
 * `organizations.name`, so a PATCH sets `name` and a GET reads it back.
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
    USER_ID: "11111111-1111-1111-1111-111111111111",
    ORG_ID: "22222222-2222-2222-2222-222222222222",
    getRequestContext: vi.fn(),
    orgRows: vi.fn<() => Array<{ name: string; timezone: string }>>(() => []),
    updateRows: vi.fn<() => Array<{ name: string; timezone: string }>>(() => []),
    setArg: vi.fn<(values: Record<string, unknown>) => void>(),
    deleteWhere: vi.fn<() => Promise<void>>(() => Promise.resolve()),
    getUser: vi.fn(),
  };
});

vi.mock("@/lib/platform/auth/session", () => ({
  getRequestContext: mocks.getRequestContext,
  RequestContextError: mocks.RequestContextError,
}));

vi.mock("@/lib/platform/auth/supabase", () => ({
  createServerClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser } })),
}));

vi.mock("@/lib/platform/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(mocks.orgRows()) }) }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        mocks.setArg(values);
        return { where: () => ({ returning: () => Promise.resolve(mocks.updateRows()) }) };
      },
    }),
    delete: () => ({ where: mocks.deleteWhere }),
  },
}));

const CTX = {
  userId: mocks.USER_ID,
  orgId: mocks.ORG_ID,
  role: "owner",
  planTier: "trial",
  queriesUsed: 3,
  queriesLimit: 20,
};

function meRequest(method: string, body?: unknown): Request {
  return new Request("https://app.example.com/api/auth/me", {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("/api/auth/me", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestContext.mockResolvedValue(CTX);
    mocks.orgRows.mockReturnValue([{ name: "Acme Inc", timezone: "UTC" }]);
    mocks.updateRows.mockReturnValue([{ name: "Acme Inc", timezone: "UTC" }]);
    mocks.getUser.mockResolvedValue({
      data: { user: { id: mocks.USER_ID, email: "owner@acme.test" } },
    });
  });

  describe("GET", () => {
    it("returns org context plus displayName and timezone", async () => {
      const res = await GET(meRequest("GET"));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.userId).toBe(mocks.USER_ID);
      expect(body.data.orgId).toBe(mocks.ORG_ID);
      expect(body.data.role).toBe("owner");
      expect(body.data.planTier).toBe("trial");
      expect(body.data.queriesUsed).toBe(3);
      expect(body.data.queriesLimit).toBe(20);
      expect(body.data.displayName).toBe("Acme Inc");
      expect(body.data.timezone).toBe("UTC");
    });

    it("returns 401 when unauthenticated", async () => {
      mocks.getRequestContext.mockRejectedValue(
        new mocks.RequestContextError(401, "UNAUTHORIZED", "Authentication required."),
      );

      const res = await GET(meRequest("GET"));
      const body = await res.json();

      expect(res.status).toBe(401);
      expect(body.error.code).toBe("UNAUTHORIZED");
      expect(body.error.request_id).toBeDefined();
    });
  });

  describe("PATCH", () => {
    it("updates the display name (organizations.name) and returns it", async () => {
      mocks.updateRows.mockReturnValue([{ name: "New Name", timezone: "UTC" }]);

      const res = await PATCH(meRequest("PATCH", { displayName: "New Name" }));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(mocks.setArg.mock.calls[0]?.[0]).toEqual({ name: "New Name" });
      expect(body.data.displayName).toBe("New Name");
    });

    it("updates only the timezone when displayName is omitted", async () => {
      mocks.updateRows.mockReturnValue([{ name: "Acme Inc", timezone: "America/New_York" }]);

      const res = await PATCH(meRequest("PATCH", { timezone: "America/New_York" }));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(mocks.setArg.mock.calls[0]?.[0]).toEqual({ timezone: "America/New_York" });
      expect(body.data.timezone).toBe("America/New_York");
    });

    it("returns 400 when neither field is provided", async () => {
      const res = await PATCH(meRequest("PATCH", {}));
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(mocks.setArg).not.toHaveBeenCalled();
    });
  });

  describe("DELETE", () => {
    it("deletes the org when the confirmation email matches the session", async () => {
      const res = await DELETE(meRequest("DELETE", { confirmationEmail: "owner@acme.test" }));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.message).toBeDefined();
      expect(mocks.deleteWhere).toHaveBeenCalledTimes(1);
    });

    it("returns 422 when the confirmation email does not match", async () => {
      const res = await DELETE(meRequest("DELETE", { confirmationEmail: "someone@else.test" }));
      const body = await res.json();

      expect(res.status).toBe(422);
      expect(body.error.code).toBe("CONFIRMATION_MISMATCH");
      expect(mocks.deleteWhere).not.toHaveBeenCalled();
    });

    it("returns 403 when the caller is not an owner", async () => {
      mocks.getRequestContext.mockResolvedValue({ ...CTX, role: "member" });

      const res = await DELETE(meRequest("DELETE", { confirmationEmail: "owner@acme.test" }));
      const body = await res.json();

      expect(res.status).toBe(403);
      expect(body.error.code).toBe("FORBIDDEN");
      expect(mocks.deleteWhere).not.toHaveBeenCalled();
    });
  });
});
