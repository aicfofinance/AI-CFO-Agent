import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildEmailHtml,
  buildSubject,
  computeEmailDispatch,
  deduplicateAgainstPriorRun,
  type EmailFinding,
  sendIntelligenceEmail,
} from "@/jobs/intelligence/email";

/**
 * Unit tests for the Step 6.8 severity-gated intelligence email.
 *
 * Two seams are exercised:
 *   1. `computeEmailDispatch` — the pure decision the intelligence runner uses to
 *      decide whether (and with what delay) to dispatch `intelligence/email.
 *      requested`. `critical` → immediate (delaySeconds 0); `high`-only → 2h
 *      (delaySeconds 7200); nothing high/critical → no dispatch. `medium`/`low`
 *      are filtered out in SQL before this runs, so they arrive here as an empty
 *      list — indistinguishable from "no findings", which is the correct
 *      "no email" outcome for both.
 *   2. The email handler's helpers — `deduplicateAgainstPriorRun` (no-resend dedup)
 *      and `sendIntelligenceEmail` (Resend dispatch + graceful skips). The Drizzle
 *      client, Resend, the Supabase admin client, and `env` are all mocked so no
 *      live database, email delivery, or real env is involved.
 *
 * The db mock is a single chainable thenable: every builder method returns the same
 * object, and awaiting it yields the next queued result from `mocks.dbResults` (in
 * call order). Actual email delivery is verified manually with a real RESEND_API_KEY.
 */
const mocks = vi.hoisted(() => ({
  resendSend: vi.fn<(payload: Record<string, unknown>) => Promise<unknown>>(),
  resendCtor: vi.fn<(apiKey: string) => void>(),
  getUserById: vi.fn<(userId: string) => Promise<unknown>>(),
  dbResults: [] as unknown[][],
  dbIndex: { value: 0 },
  resendApiKey: undefined as string | undefined,
  fromEmail: undefined as string | undefined,
}));

vi.mock("@/lib/env", () => ({
  env: {
    get RESEND_API_KEY(): string | undefined {
      return mocks.resendApiKey;
    },
    get FROM_EMAIL(): string | undefined {
      return mocks.fromEmail;
    },
    NEXT_PUBLIC_APP_URL: "https://app.cfolens.test",
  },
}));

vi.mock("resend", () => ({
  Resend: class {
    public emails = { send: mocks.resendSend };
    public constructor(apiKey: string) {
      mocks.resendCtor(apiKey);
    }
  },
}));

vi.mock("@/lib/platform/auth/supabase", () => ({
  createAdminClient: () => ({
    auth: { admin: { getUserById: mocks.getUserById } },
  }),
}));

vi.mock("@/lib/platform/db/client", () => {
  const chain: Record<string, unknown> = {};
  const ret = (): unknown => chain;
  chain.select = ret;
  chain.from = ret;
  chain.where = ret;
  chain.orderBy = ret;
  chain.limit = ret;
  // Thenable: awaiting the chain (after `.where(...)` or `.limit(1)`) resolves the
  // next queued result and advances the call cursor.
  chain.then = (resolve: (value: unknown) => void): void => {
    const result = mocks.dbResults[mocks.dbIndex.value] ?? [];
    mocks.dbIndex.value += 1;
    resolve(result);
  };
  return { db: chain };
});

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const CURRENT_RUN_ID = "22222222-2222-2222-2222-222222222222";
const PRIOR_RUN_ID = "33333333-3333-3333-3333-333333333333";

function finding(
  overrides: Partial<EmailFinding> & Pick<EmailFinding, "id" | "severity">,
): EmailFinding {
  return {
    findingType: "cash_flow_risk",
    headline: "A finding headline",
    detail: "A plain-English detail with a $12,500.00 amount.",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dbResults = [];
  mocks.dbIndex.value = 0;
  mocks.resendApiKey = "re_test_key";
  mocks.fromEmail = "alerts@cfolens.test";
});

describe("computeEmailDispatch (severity gate)", () => {
  it("case 1: a critical finding dispatches immediately (delaySeconds 0)", () => {
    expect(computeEmailDispatch(["critical"])).toEqual({ send: true, delaySeconds: 0 });
  });

  it("case 1b: a mixed high + critical run still dispatches immediately", () => {
    expect(computeEmailDispatch(["high", "critical"])).toEqual({ send: true, delaySeconds: 0 });
  });

  it("case 2: a high-only run dispatches with a 2-hour (7200s) delay", () => {
    expect(computeEmailDispatch(["high"])).toEqual({ send: true, delaySeconds: 7200 });
    expect(computeEmailDispatch(["high", "high"])).toEqual({ send: true, delaySeconds: 7200 });
  });

  it("case 3: medium-only (filtered to empty in SQL) → no dispatch", () => {
    // `medium`/`low` are removed by the SQL `IN ('high','critical')` filter, so the
    // decision function receives an empty severity list.
    expect(computeEmailDispatch([])).toEqual({ send: false });
  });

  it("case 4: no findings → no dispatch", () => {
    expect(computeEmailDispatch([])).toEqual({ send: false });
  });
});

describe("sendIntelligenceEmail (graceful skips + Resend dispatch)", () => {
  it("case 5: returns cleanly and sends nothing when RESEND_API_KEY is missing", async () => {
    mocks.resendApiKey = undefined;

    await expect(
      sendIntelligenceEmail(ORG_ID, [finding({ id: "f1", severity: "critical" })]),
    ).resolves.toBeUndefined();

    expect(mocks.resendCtor).not.toHaveBeenCalled();
    expect(mocks.resendSend).not.toHaveBeenCalled();
    expect(mocks.getUserById).not.toHaveBeenCalled();
  });

  it("returns cleanly when FROM_EMAIL is missing", async () => {
    mocks.fromEmail = undefined;

    await expect(
      sendIntelligenceEmail(ORG_ID, [finding({ id: "f1", severity: "critical" })]),
    ).resolves.toBeUndefined();

    expect(mocks.resendCtor).not.toHaveBeenCalled();
    expect(mocks.resendSend).not.toHaveBeenCalled();
  });

  it("sends a correctly-formatted brief (subject, links, footer) to the org owner", async () => {
    // resolveRecipientEmail: the owner query (with `.limit(1)`) returns a member.
    mocks.dbResults = [[{ userId: "user-owner" }]];
    mocks.getUserById.mockResolvedValue({
      data: { user: { email: "owner@company.test" } },
      error: null,
    });
    mocks.resendSend.mockResolvedValue({ data: { id: "email-1" }, error: null });

    await sendIntelligenceEmail(ORG_ID, [
      finding({
        id: "f1",
        severity: "critical",
        headline: "Cash shortfall of $12,500 projected",
        detail: "Your balance is projected to fall to −$3,200 by Oct 21.",
      }),
      finding({ id: "f2", severity: "high", headline: "Expense spike detected" }),
    ]);

    expect(mocks.resendCtor).toHaveBeenCalledWith("re_test_key");
    expect(mocks.resendSend).toHaveBeenCalledTimes(1);

    const payload = mocks.resendSend.mock.calls[0]?.[0] as {
      from: string;
      to: string;
      subject: string;
      html: string;
    };
    expect(payload.from).toBe("alerts@cfolens.test");
    expect(payload.to).toBe("owner@company.test");
    // Critical present → "urgent"; 2 findings → "(+ 1 more)".
    expect(payload.subject).toBe(
      "CFO Lens — urgent: Cash shortfall of $12,500 projected (+ 1 more)",
    );
    expect(payload.html).toContain("View full brief →");
    expect(payload.html).toContain("Ask the AI about this →");
    expect(payload.html).toContain("https://app.cfolens.test/dashboard?finding_id=f1");
    expect(payload.html).toContain("https://app.cfolens.test/ask?finding_id=f1");
    expect(payload.html).toContain("Severity: critical");
    expect(payload.html).toContain(
      "This is AI-generated financial analysis. Not financial advice.",
    );
  });

  it("falls back to a member when no owner exists, and skips when no address resolves", async () => {
    // Owner query empty, member query returns a user, but the user has no email.
    mocks.dbResults = [[], [{ userId: "user-member" }]];
    mocks.getUserById.mockResolvedValue({ data: { user: { email: null } }, error: null });

    await expect(
      sendIntelligenceEmail(ORG_ID, [finding({ id: "f1", severity: "high" })]),
    ).resolves.toBeUndefined();

    expect(mocks.getUserById).toHaveBeenCalledWith("user-member");
    expect(mocks.resendSend).not.toHaveBeenCalled();
  });
});

describe("deduplicateAgainstPriorRun (no-resend dedup)", () => {
  it("sends all findings when no prior completed run exists", async () => {
    mocks.dbResults = [[]]; // prior-run lookup returns nothing

    const current = [finding({ id: "f1", severity: "critical" })];
    const result = await deduplicateAgainstPriorRun(ORG_ID, CURRENT_RUN_ID, current);

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("f1");
  });

  it("case 6: excludes a finding already emailed in the prior run at the same severity", async () => {
    mocks.dbResults = [
      [{ id: PRIOR_RUN_ID }], // prior completed run
      [{ id: "f1", severity: "critical" }], // its findings — same id, same severity
    ];

    const current = [finding({ id: "f1", severity: "critical" })];
    const result = await deduplicateAgainstPriorRun(ORG_ID, CURRENT_RUN_ID, current);

    expect(result).toHaveLength(0);
  });

  it("case 7: re-includes a finding whose severity changed since the prior run", async () => {
    mocks.dbResults = [
      [{ id: PRIOR_RUN_ID }],
      [{ id: "f1", severity: "high" }], // prior severity was high…
    ];

    const current = [finding({ id: "f1", severity: "critical" })]; // …now critical
    const result = await deduplicateAgainstPriorRun(ORG_ID, CURRENT_RUN_ID, current);

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("f1");
  });

  it("keeps genuinely new findings absent from the prior run", async () => {
    mocks.dbResults = [
      [{ id: PRIOR_RUN_ID }],
      [{ id: "f-old", severity: "critical" }], // unrelated prior finding
    ];

    const current = [finding({ id: "f-new", severity: "high" })];
    const result = await deduplicateAgainstPriorRun(ORG_ID, CURRENT_RUN_ID, current);

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("f-new");
  });
});

describe("subject and body rendering", () => {
  it("uses 'action recommended' with no '+ more' for a single high-only finding", () => {
    const subject = buildSubject([finding({ id: "f1", severity: "high", headline: "Overdue AR" })]);
    expect(subject).toBe("CFO Lens — action recommended: Overdue AR");
  });

  it("renders the footer exactly once at the end of the body", () => {
    const html = buildEmailHtml(
      [finding({ id: "f1", severity: "critical", headline: "H", detail: "D" })],
      "https://app.cfolens.test",
    );
    const footerMatches = html.split("Not financial advice.").length - 1;
    expect(footerMatches).toBe(1);
    expect(html.trimEnd().endsWith("</div>")).toBe(true);
  });
});
