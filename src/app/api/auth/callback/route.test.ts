import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/auth/callback/route";

/**
 * Unit tests for `GET /api/auth/callback` (Step 2.1).
 *
 * `redirect` from next/navigation, the Supabase server client, and the Drizzle
 * client are mocked. `redirect` records its target instead of throwing the
 * framework `NEXT_REDIRECT` signal, so each test asserts the computed
 * destination for a given auth/state combination.
 *
 * The DB `select` is dispatched by requested columns (mirroring
 * session.test.ts): the membership lookup asks for `orgId`, the connection
 * lookup asks for `id`.
 */

const mocks = vi.hoisted(() => ({
  USER_ID: "11111111-1111-1111-1111-111111111111",
  ORG_ID: "22222222-2222-2222-2222-222222222222",
  redirect: vi.fn(),
  verifyOtp: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  getUser: vi.fn(),
  membershipRows: vi.fn<() => Array<{ orgId: string }>>(() => []),
  connectionRows: vi.fn<() => Array<{ id: string }>>(() => []),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@/lib/platform/auth/supabase", () => ({
  createServerClient: vi.fn(async () => ({
    auth: {
      verifyOtp: mocks.verifyOtp,
      exchangeCodeForSession: mocks.exchangeCodeForSession,
      getUser: mocks.getUser,
    },
  })),
}));

vi.mock("@/lib/platform/db/client", () => ({
  db: {
    select: vi.fn((columns: Record<string, unknown>) => {
      const rows = Object.prototype.hasOwnProperty.call(columns, "orgId")
        ? mocks.membershipRows()
        : mocks.connectionRows();
      return {
        from: () => ({
          where: () => ({ limit: () => Promise.resolve(rows) }),
        }),
      };
    }),
  },
}));

function callbackRequest(query: string): Request {
  return new Request(`https://app.example.com/api/auth/callback?${query}`);
}

function lastRedirect(): string | undefined {
  return mocks.redirect.mock.calls.at(-1)?.[0] as string | undefined;
}

describe("GET /api/auth/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyOtp.mockResolvedValue({ error: null });
    mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
    mocks.getUser.mockResolvedValue({ data: { user: { id: mocks.USER_ID } }, error: null });
    mocks.membershipRows.mockReturnValue([]);
    mocks.connectionRows.mockReturnValue([]);
  });

  it("routes a valid magic link for a new user to /onboarding/migration", async () => {
    await GET(callbackRequest("token_hash=abc&type=email") as never);
    expect(lastRedirect()).toBe("/onboarding/migration");
  });

  it("routes a new user with source=bench to the bench migration path", async () => {
    await GET(callbackRequest("token_hash=abc&type=email&source=bench") as never);
    expect(lastRedirect()).toBe("/onboarding/migration?source=bench");
  });

  it("routes a returning user with an active connection to /dashboard", async () => {
    mocks.membershipRows.mockReturnValue([{ orgId: mocks.ORG_ID }]);
    mocks.connectionRows.mockReturnValue([{ id: "conn-1" }]);

    await GET(callbackRequest("token_hash=abc&type=email") as never);
    expect(lastRedirect()).toBe("/dashboard");
  });

  it("routes a returning user with an org but no connection to /onboarding/connect", async () => {
    mocks.membershipRows.mockReturnValue([{ orgId: mocks.ORG_ID }]);
    mocks.connectionRows.mockReturnValue([]);

    await GET(callbackRequest("token_hash=abc&type=email") as never);
    expect(lastRedirect()).toBe("/onboarding/connect");
  });

  it("routes an expired/invalid magic link to /login?error=link_expired", async () => {
    mocks.verifyOtp.mockResolvedValue({ error: { message: "Token has expired" } });

    await GET(callbackRequest("token_hash=abc&type=email") as never);
    expect(lastRedirect()).toBe("/login?error=link_expired");
  });

  it("routes to link_expired when neither token_hash nor code is present", async () => {
    await GET(callbackRequest("") as never);
    expect(lastRedirect()).toBe("/login?error=link_expired");
  });

  it("routes to link_expired when the session resolves to no user", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    await GET(callbackRequest("token_hash=abc&type=email") as never);
    expect(lastRedirect()).toBe("/login?error=link_expired");
  });
});
