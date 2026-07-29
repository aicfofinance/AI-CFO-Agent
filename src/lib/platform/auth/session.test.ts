import { beforeEach, describe, expect, it, vi } from "vitest";

import { getRequestContext, RequestContextError } from "@/lib/platform/auth/session";

/**
 * Shared fixtures + mock handles, declared via `vi.hoisted` so they are
 * available inside the hoisted `vi.mock` factories below.
 */
const mocks = vi.hoisted(() => ({
  MOCK_USER_ID: "11111111-1111-1111-1111-111111111111",
  MOCK_ORG_ID: "22222222-2222-2222-2222-222222222222",
  MOCK_ROLE: "admin",
  MOCK_PLAN_TIER: "growth",
  MOCK_QUERIES_USED: 5,
  MOCK_QUERIES_LIMIT: 200,
  getUser: vi.fn(),
}));

// Mock the Supabase server client so no cookies / next/headers are touched.
vi.mock("@/lib/platform/auth/supabase", () => ({
  createServerClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
  })),
}));

// Mock the Drizzle client. The chainable builder resolves `.limit()` with the
// row set appropriate to the query: the membership select asks for `role`, the
// subscription select asks for `planTier`.
vi.mock("@/lib/platform/db/client", () => ({
  db: {
    select: vi.fn((columns: Record<string, unknown>) => {
      const rows = Object.prototype.hasOwnProperty.call(columns, "role")
        ? [{ orgId: mocks.MOCK_ORG_ID, role: mocks.MOCK_ROLE }]
        : [
            {
              planTier: mocks.MOCK_PLAN_TIER,
              queriesUsed: mocks.MOCK_QUERIES_USED,
              queriesLimit: mocks.MOCK_QUERIES_LIMIT,
            },
          ];
      return {
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve(rows),
          }),
        }),
      };
    }),
  },
}));

const mockRequest = new Request("https://app.example.com/api/auth/me");

describe("getRequestContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the correct org, role, and quota for an authenticated user", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: mocks.MOCK_USER_ID } },
      error: null,
    });

    const ctx = await getRequestContext(mockRequest);

    expect(ctx.userId).toBe(mocks.MOCK_USER_ID);
    expect(ctx.orgId).toBe(mocks.MOCK_ORG_ID);
    expect(ctx.role).toBe(mocks.MOCK_ROLE);
    expect(ctx.planTier).toBe(mocks.MOCK_PLAN_TIER);
    expect(ctx.queriesUsed).toBe(mocks.MOCK_QUERIES_USED);
    expect(ctx.queriesLimit).toBe(mocks.MOCK_QUERIES_LIMIT);
  });

  it("throws a 401 RequestContextError when there is no authenticated user", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    await expect(getRequestContext(mockRequest)).rejects.toBeInstanceOf(RequestContextError);
    await expect(getRequestContext(mockRequest)).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHORIZED",
    });
  });

  it("throws a 401 RequestContextError when getUser returns an error", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: "session expired" },
    });

    await expect(getRequestContext(mockRequest)).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHORIZED",
    });
  });
});
