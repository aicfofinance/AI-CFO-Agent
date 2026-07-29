import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/auth/logout/route";

/**
 * Unit tests for `POST /api/auth/logout` (Step 2.6).
 *
 * The Supabase server client is mocked so `signOut()` is observed without a
 * real session. A `signOut` failure must still return the standard error
 * envelope, never a raw error.
 */

const mocks = vi.hoisted(() => ({
  signOut: vi.fn(),
}));

vi.mock("@/lib/platform/auth/supabase", () => ({
  createServerClient: vi.fn(async () => ({ auth: { signOut: mocks.signOut } })),
}));

describe("POST /api/auth/logout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signOut.mockResolvedValue({ error: null });
  });

  it("clears the session and returns 200", async () => {
    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.message).toBe("Logged out");
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });

  it("returns a 500 envelope when signOut throws", async () => {
    mocks.signOut.mockRejectedValue(new Error("network down"));

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.request_id).toBeDefined();
  });
});
