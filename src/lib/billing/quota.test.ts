import { describe, expect, it, vi } from "vitest";

import { checkAndIncrementQuota } from "@/lib/billing/quota";

/**
 * Unit tests for `checkAndIncrementQuota` (Step 11.3 prerequisite).
 *
 * The Drizzle handle is a hand-rolled mock: `transaction` invokes the callback
 * with a `tx` whose locked SELECT (`.for("update")`) returns the seeded row and
 * whose UPDATE records the value it was asked to set. This lets the tests assert
 * both the returned result and whether an increment was actually written — the
 * "does NOT increment when denied" case is the one that matters most.
 */

const ORG_ID = "22222222-2222-2222-2222-222222222222";

type Row = { used: number; limit: number };

function makeDb(row: Row | null): {
  db: Parameters<typeof checkAndIncrementQuota>[1];
  setSpy: ReturnType<typeof vi.fn>;
} {
  const setSpy = vi.fn<(values: Record<string, unknown>) => void>();

  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({
          for: () => ({
            limit: () => Promise.resolve(row ? [row] : []),
          }),
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        setSpy(values);
        return { where: () => Promise.resolve() };
      },
    }),
  };

  const db = {
    transaction: (cb: (tx: unknown) => unknown) => cb(tx),
  } as unknown as Parameters<typeof checkAndIncrementQuota>[1];

  return { db, setSpy };
}

describe("checkAndIncrementQuota", () => {
  it("allows and returns 19 remaining when used=0, limit=20", async () => {
    const { db, setSpy } = makeDb({ used: 0, limit: 20 });

    const result = await checkAndIncrementQuota(ORG_ID, db);

    expect(result).toEqual({ allowed: true, queriesRemaining: 19 });
    expect(setSpy).toHaveBeenCalledWith({ queriesUsedThisPeriod: 1 });
  });

  it("denies and returns 0 remaining when used=20, limit=20", async () => {
    const { db } = makeDb({ used: 20, limit: 20 });

    const result = await checkAndIncrementQuota(ORG_ID, db);

    expect(result).toEqual({ allowed: false, queriesRemaining: 0 });
  });

  it("does NOT increment when the quota is exhausted", async () => {
    const { db, setSpy } = makeDb({ used: 20, limit: 20 });

    await checkAndIncrementQuota(ORG_ID, db);

    expect(setSpy).not.toHaveBeenCalled();
  });

  it("returns 0 remaining on the last available query (used=19, limit=20)", async () => {
    const { db, setSpy } = makeDb({ used: 19, limit: 20 });

    const result = await checkAndIncrementQuota(ORG_ID, db);

    expect(result).toEqual({ allowed: true, queriesRemaining: 0 });
    expect(setSpy).toHaveBeenCalledWith({ queriesUsedThisPeriod: 20 });
  });

  it("throws when the org has no subscription row", async () => {
    const { db, setSpy } = makeDb(null);

    await expect(checkAndIncrementQuota(ORG_ID, db)).rejects.toThrow(/No subscription row/);
    expect(setSpy).not.toHaveBeenCalled();
  });
});
