import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { middleware } from "@/middleware";

/**
 * Unit tests for the route-protection middleware (Step 2.2).
 *
 * `@/lib/env` and `@supabase/ssr` are mocked so the middleware runs without a
 * real Supabase project or validated env. `getUser` is toggled per test to
 * simulate an authenticated vs anonymous request.
 */

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  env: { SUPABASE_URL: "https://project.supabase.co", SUPABASE_ANON_KEY: "anon-key" },
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: { getUser: mocks.getUser },
  })),
}));

function requestFor(path: string): NextRequest {
  return new NextRequest(new URL(`https://app.example.com${path}`));
}

function noSession(): void {
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
}

function withSession(): void {
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "11111111-1111-1111-1111-111111111111" } },
    error: null,
  });
}

describe("middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects an unauthenticated request to /dashboard → /login?next=/dashboard", async () => {
    noSession();

    const res = await middleware(requestFor("/dashboard"));

    expect(res.status).toBe(307);
    const location = res.headers.get("location");
    expect(location).not.toBeNull();
    const url = new URL(location as string);
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("next")).toBe("/dashboard");
  });

  it("preserves a nested protected path in the next param", async () => {
    noSession();

    const res = await middleware(requestFor("/settings/billing"));

    const url = new URL(res.headers.get("location") as string);
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("next")).toBe("/settings/billing");
  });

  it("redirects an authenticated request to /login → /dashboard", async () => {
    withSession();

    const res = await middleware(requestFor("/login"));

    expect(res.status).toBe(307);
    const url = new URL(res.headers.get("location") as string);
    expect(url.pathname).toBe("/dashboard");
  });

  it("redirects an authenticated request to /register → /dashboard", async () => {
    withSession();

    const res = await middleware(requestFor("/register"));

    const url = new URL(res.headers.get("location") as string);
    expect(url.pathname).toBe("/dashboard");
  });

  it("lets an authenticated request to a protected route pass through", async () => {
    withSession();

    const res = await middleware(requestFor("/dashboard"));

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("lets an unauthenticated request to a public page pass through", async () => {
    noSession();

    const res = await middleware(requestFor("/login"));

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
});
