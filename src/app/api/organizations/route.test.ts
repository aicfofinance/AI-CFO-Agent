import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/organizations/route";

/**
 * Unit tests for `POST /api/organizations` (Step 2.3).
 *
 * The Supabase server client and the Drizzle client are mocked. The four-row
 * insert runs inside `db.transaction`, so the mock `tx` records every
 * `insert().values(...)` payload for assertion. The org insert additionally
 * chains `.returning()`; the other three inserts are awaited directly.
 */

type MembershipRow = { orgId: string };

const mocks = vi.hoisted(() => ({
  USER_ID: "11111111-1111-1111-1111-111111111111",
  ORG_ID: "22222222-2222-2222-2222-222222222222",
  getUser: vi.fn(),
  existingRows: vi.fn<() => MembershipRow[]>(() => []),
  insertValues: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/platform/auth/supabase", () => ({
  createServerClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
  })),
}));

vi.mock("@/lib/platform/db/client", () => {
  const orgRow = {
    id: mocks.ORG_ID,
    name: "Acme Inc",
    slug: "acme-inc-abcd1234",
    industry: "saas",
    annualRevenueBand: "1m_5m",
  };
  const tx = {
    insert: () => ({
      values: (vals: Record<string, unknown>) => {
        mocks.insertValues.push(vals);
        return { returning: () => Promise.resolve([orgRow]) };
      },
    }),
  };
  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => ({ limit: () => Promise.resolve(mocks.existingRows()) }),
        }),
      }),
      transaction: (cb: (t: typeof tx) => Promise<unknown>) => cb(tx),
    },
  };
});

function createOrgRequest(body: unknown): Request {
  return new Request("https://app.example.com/api/organizations", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  name: "Acme Inc",
  industry: "saas",
  revenueBand: "1m_5m",
  consentGiven: true,
};

describe("POST /api/organizations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insertValues.length = 0;
    mocks.getUser.mockResolvedValue({ data: { user: { id: mocks.USER_ID } }, error: null });
    mocks.existingRows.mockReturnValue([]);
  });

  it("creates the org and returns 201 with the org object", async () => {
    const res = await POST(createOrgRequest(VALID_BODY));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.id).toBe(mocks.ORG_ID);
    expect(body.data.name).toBe("Acme Inc");
    expect(body.data.revenueBand).toBe("1m_5m");
  });

  it("inserts owner membership, consent, and a trial subscription with a 20-query quota", async () => {
    await POST(createOrgRequest(VALID_BODY));

    const member = mocks.insertValues.find((v) => v.role !== undefined);
    expect(member?.role).toBe("owner");
    expect(member?.userId).toBe(mocks.USER_ID);

    const consent = mocks.insertValues.find((v) => v.consentType !== undefined);
    expect(consent?.consentType).toBe("not_financial_advice");
    expect(consent?.ipAddress).toBe("203.0.113.7");

    const sub = mocks.insertValues.find((v) => v.queriesLimit !== undefined);
    expect(sub?.planTier).toBe("trial");
    expect(sub?.queriesLimit).toBe(20);
  });

  it("returns 401 when there is no session", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const res = await POST(createOrgRequest(VALID_BODY));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(body.error.request_id).toBeDefined();
  });

  it("returns 409 when the user already belongs to an organization", async () => {
    mocks.existingRows.mockReturnValue([{ orgId: mocks.ORG_ID }]);

    const res = await POST(createOrgRequest(VALID_BODY));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error.code).toBe("ORGANIZATION_EXISTS");
    expect(mocks.insertValues).toHaveLength(0);
  });

  it("returns 400 when consent is not exactly true", async () => {
    const res = await POST(createOrgRequest({ ...VALID_BODY, consentGiven: false }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(mocks.insertValues).toHaveLength(0);
  });

  it("returns 400 when a required field is missing", async () => {
    const res = await POST(createOrgRequest({ industry: "saas", consentGiven: true }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});
