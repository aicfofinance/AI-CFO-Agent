import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * API authentication security tests (Step 15.1).
 *
 * Verifies that every session-gated endpoint rejects an unauthenticated request
 * with HTTP 401 in the standard error envelope. This is the "no session → 401"
 * half of the three-case auth pattern (CLAUDE.md Testing Rules); the "wrong org
 * → 403 / correct org → 200" halves live in each endpoint's own route test.
 *
 * All five new V2 endpoints are covered explicitly per the Definition of Done:
 *   - GET   /api/intelligence/feed
 *   - POST  /api/intelligence/findings/:id/dismiss
 *   - POST  /api/intelligence/findings/:id/draft-action
 *   - PATCH /api/intelligence/actions/:id
 *   - GET   /api/cashflow/projection
 *
 * How it works: `getRequestContext` is the first meaningful operation in every
 * gated handler (CLAUDE.md API Rules). Mocking it to reject with a
 * `RequestContextError(401, 'UNAUTHORIZED')` short-circuits each handler before
 * it touches the database, so a stub `db`/`env`/Supabase client is enough for the
 * route modules to import. The `RequestContextError` class is shared between the
 * mock's `getRequestContext` (which throws it) and the mock's exported class
 * (which the handlers use for `instanceof`), so the handler's error branch
 * recognises it and maps it to `error.status`.
 *
 * `POST /api/auth/logout` is intentionally NOT gated — signing out with no
 * session is an idempotent no-op that returns 200 — so it is asserted separately
 * against its true behaviour rather than forced to a false 401.
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
    getRequestContext: vi.fn(),
    checkAndIncrementQuota: vi.fn(),
    signOut: vi.fn(async () => ({ error: null })),
    getUser: vi.fn(async () => ({ data: { user: null }, error: new Error("no session") })),
  };
});

// AI_PROVIDER is present so the model router module (pulled in by the
// draft-action and messages routes) loads cleanly. Upstash / DB credentials are
// omitted — the DB client and rate limiters are never reached because
// getRequestContext throws first, and the DB client is mocked below regardless.
vi.mock("@/lib/env", () => ({ env: { AI_PROVIDER: "google" } }));

vi.mock("@/lib/platform/auth/session", () => ({
  getRequestContext: mocks.getRequestContext,
  RequestContextError: mocks.RequestContextError,
}));

vi.mock("@/lib/platform/auth/supabase", () => ({
  createServerClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser, signOut: mocks.signOut },
  })),
}));

vi.mock("@/lib/billing/quota", () => ({
  checkAndIncrementQuota: mocks.checkAndIncrementQuota,
}));

// A stub `db`: gated handlers never call it (getRequestContext throws first),
// so no query builder surface is needed for these tests.
vi.mock("@/lib/platform/db/client", () => ({ db: {} }));

import { GET as authMeGET } from "@/app/api/auth/me/route";
import { POST as authLogoutPOST } from "@/app/api/auth/logout/route";
import { GET as cashflowProjectionGET } from "@/app/api/cashflow/projection/route";
import { GET as connectionsGET } from "@/app/api/connections/route";
import { GET as conversationDetailGET } from "@/app/api/conversations/[id]/route";
import { POST as conversationMessagesPOST } from "@/app/api/conversations/[id]/messages/route";
import { GET as conversationsExportGET } from "@/app/api/conversations/export/route";
import {
  GET as conversationsListGET,
  POST as conversationsCreatePOST,
} from "@/app/api/conversations/route";
import { GET as dataExportGET } from "@/app/api/data/export/route";
import { GET as financialSummaryGET } from "@/app/api/financial/summary/route";
import { PATCH as intelligenceActionsPATCH } from "@/app/api/intelligence/actions/[id]/route";
import { GET as intelligenceFeedGET } from "@/app/api/intelligence/feed/route";
import { POST as findingDismissPOST } from "@/app/api/intelligence/findings/[id]/dismiss/route";
import { POST as findingDraftActionPOST } from "@/app/api/intelligence/findings/[id]/draft-action/route";

/** Builds a bare Request for the given path — no auth header, no session cookie. */
function req(path: string, method = "GET"): Request {
  return new Request(`http://localhost${path}`, { method });
}

/** The `{ params }` argument shape for dynamic-segment route handlers. */
const idParams = { params: Promise.resolve({ id: "test-id" }) };

/**
 * Every session-gated handler under test, keyed by its public route. Each `call`
 * invokes the handler exactly as Next.js would for an unauthenticated request.
 */
const gatedEndpoints: ReadonlyArray<{ name: string; call: () => Promise<Response> }> = [
  // Core financial
  {
    name: "GET /api/financial/summary",
    call: () => financialSummaryGET(req("/api/financial/summary")),
  },
  {
    name: "GET /api/cashflow/projection",
    call: () => cashflowProjectionGET(req("/api/cashflow/projection")),
  },

  // Conversations
  { name: "GET /api/conversations", call: () => conversationsListGET(req("/api/conversations")) },
  {
    name: "POST /api/conversations",
    call: () => conversationsCreatePOST(req("/api/conversations", "POST")),
  },
  {
    name: "GET /api/conversations/:id",
    call: () => conversationDetailGET(req("/api/conversations/test-id"), idParams),
  },
  {
    name: "POST /api/conversations/:id/messages",
    call: () =>
      conversationMessagesPOST(req("/api/conversations/test-id/messages", "POST"), idParams),
  },
  {
    name: "GET /api/conversations/export",
    call: () => conversationsExportGET(req("/api/conversations/export")),
  },

  // Intelligence (all four V2 finding/action endpoints)
  {
    name: "GET /api/intelligence/feed",
    call: () => intelligenceFeedGET(req("/api/intelligence/feed")),
  },
  {
    name: "POST /api/intelligence/findings/:id/dismiss",
    call: () =>
      findingDismissPOST(req("/api/intelligence/findings/test-id/dismiss", "POST"), idParams),
  },
  {
    name: "POST /api/intelligence/findings/:id/draft-action",
    call: () =>
      findingDraftActionPOST(
        req("/api/intelligence/findings/test-id/draft-action", "POST"),
        idParams,
      ),
  },
  {
    name: "PATCH /api/intelligence/actions/:id",
    call: () =>
      intelligenceActionsPATCH(req("/api/intelligence/actions/test-id", "PATCH"), idParams),
  },

  // Data + connections
  { name: "GET /api/data/export", call: () => dataExportGET(req("/api/data/export")) },
  { name: "GET /api/connections", call: () => connectionsGET(req("/api/connections")) },

  // Auth
  { name: "GET /api/auth/me", call: () => authMeGET(req("/api/auth/me")) },
];

describe("API auth — unauthenticated requests are rejected", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Every gated handler's first call is getRequestContext; a 401 here is the
    // canonical "no session" failure.
    mocks.getRequestContext.mockRejectedValue(
      new mocks.RequestContextError(401, "UNAUTHORIZED", "Authentication required."),
    );
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: new Error("no session") });
    mocks.signOut.mockResolvedValue({ error: null });
  });

  it.each(gatedEndpoints)("$name returns 401 without a session", async ({ call }) => {
    const res = await call();
    expect(res.status).toBe(401);

    const body = (await res.json()) as { error?: { code?: string; request_id?: string } };
    expect(body.error?.code).toBe("UNAUTHORIZED");
    expect(body.error?.request_id).toBeDefined();
  });

  it("the five new V2 endpoints are all present in the coverage set", () => {
    const covered = new Set(gatedEndpoints.map((e) => e.name));
    for (const v2 of [
      "GET /api/intelligence/feed",
      "POST /api/intelligence/findings/:id/dismiss",
      "POST /api/intelligence/findings/:id/draft-action",
      "PATCH /api/intelligence/actions/:id",
      "GET /api/cashflow/projection",
    ]) {
      expect(covered.has(v2)).toBe(true);
    }
  });

  it("POST /api/auth/logout is idempotent without a session (200, not gated)", async () => {
    // Logout deliberately does not call getRequestContext: revoking a
    // non-existent session is a safe no-op that must never error.
    const res = await authLogoutPOST();
    expect(res.status).toBe(200);
  });
});
