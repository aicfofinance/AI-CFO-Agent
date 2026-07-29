import { beforeEach, describe, expect, it, vi } from "vitest";

import { insertFindingDeduped } from "@/lib/financial/intelligence/findings-writer";

/**
 * Unit tests for the Step 6.7 shared finding writer.
 *
 * `insertFindingDeduped` runs a same-day dedup SELECT (`org_id` + `finding_type` +
 * `created_at::date = CURRENT_DATE`) and only inserts when that query finds no
 * existing row. The Drizzle client is mocked so the SELECT result is fully under
 * test control and the INSERT can be asserted called / not called — no live
 * database or Inngest harness is involved.
 *
 * The four cases mirror the Step 6.7 spec:
 *   1. no same-day row              → INSERT called, returns true
 *   2. same-day row for (org, type) → INSERT skipped, returns false (dedup)
 *   3. same finding_type, different org_id → not deduped → INSERT called, true
 *   4. different finding_type, same org_id → not deduped → INSERT called, true
 *
 * Cases 3 and 4 model the dedup scope: because the SELECT is filtered by BOTH
 * `org_id` AND `finding_type`, a row that differs on either dimension does not
 * match, so the query returns empty and the insert proceeds. The mock captures the
 * `where` predicate to prove the query was scoped, and asserts the exact insert
 * payload carried the distinguishing org/type.
 */
const mocks = vi.hoisted(() => ({
  whereArg: vi.fn<(predicate: unknown) => void>(),
  selectLimit: vi.fn<() => Promise<Array<{ id: string }>>>(),
  insertValues: vi.fn<(values: Record<string, unknown>) => Promise<void>>(),
}));

vi.mock("@/lib/platform/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (predicate: unknown) => {
          mocks.whereArg(predicate);
          return { limit: mocks.selectLimit };
        },
      }),
    }),
    insert: () => ({ values: mocks.insertValues }),
  },
}));

const ORG_ID = "22222222-2222-2222-2222-222222222222";
const OTHER_ORG_ID = "44444444-4444-4444-4444-444444444444";
const RUN_ID = "33333333-3333-3333-3333-333333333333";

/** A complete, valid `findings` insert row for the given org + finding type. */
function findingRow(overrides: { orgId: string; findingType: string }): Record<string, unknown> {
  return {
    orgId: overrides.orgId,
    intelligenceRunId: RUN_ID,
    findingType: overrides.findingType,
    severity: "medium",
    headline: "A finding headline",
    detail: "A plain-English detail explanation.",
    status: "active",
    expiresAt: null,
    relatedData: {},
  };
}

describe("insertFindingDeduped", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("case 1: inserts when no same-day finding exists and returns true", async () => {
    mocks.selectLimit.mockResolvedValueOnce([]);

    const row = findingRow({ orgId: ORG_ID, findingType: "anomaly" });
    const inserted = await insertFindingDeduped(row as Parameters<typeof insertFindingDeduped>[0]);

    expect(inserted).toBe(true);
    expect(mocks.whereArg).toHaveBeenCalledTimes(1); // dedup query was scoped
    expect(mocks.insertValues).toHaveBeenCalledTimes(1);
    expect(mocks.insertValues).toHaveBeenCalledWith(row);
  });

  it("case 2: skips the insert when a same-day (org, type) finding exists and returns false", async () => {
    mocks.selectLimit.mockResolvedValueOnce([{ id: "existing-finding-id" }]);

    const inserted = await insertFindingDeduped(
      findingRow({ orgId: ORG_ID, findingType: "anomaly" }) as Parameters<
        typeof insertFindingDeduped
      >[0],
    );

    expect(inserted).toBe(false);
    expect(mocks.whereArg).toHaveBeenCalledTimes(1);
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });

  it("case 3: same finding_type but a different org_id is not deduped — inserts and returns true", async () => {
    // The org-scoped dedup query finds nothing for the other org.
    mocks.selectLimit.mockResolvedValueOnce([]);

    const row = findingRow({ orgId: OTHER_ORG_ID, findingType: "anomaly" });
    const inserted = await insertFindingDeduped(row as Parameters<typeof insertFindingDeduped>[0]);

    expect(inserted).toBe(true);
    expect(mocks.insertValues).toHaveBeenCalledTimes(1);
    const payload = mocks.insertValues.mock.calls[0]?.[0];
    expect(payload?.orgId).toBe(OTHER_ORG_ID);
    expect(payload?.findingType).toBe("anomaly");
  });

  it("case 4: different finding_type for the same org_id is not deduped — inserts and returns true", async () => {
    // The type-scoped dedup query finds nothing for the other finding type.
    mocks.selectLimit.mockResolvedValueOnce([]);

    const row = findingRow({ orgId: ORG_ID, findingType: "duplicate_subscription" });
    const inserted = await insertFindingDeduped(row as Parameters<typeof insertFindingDeduped>[0]);

    expect(inserted).toBe(true);
    expect(mocks.insertValues).toHaveBeenCalledTimes(1);
    const payload = mocks.insertValues.mock.calls[0]?.[0];
    expect(payload?.orgId).toBe(ORG_ID);
    expect(payload?.findingType).toBe("duplicate_subscription");
  });
});
