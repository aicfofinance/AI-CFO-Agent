import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadConversationHistory } from "@/lib/ai/context/history";

/**
 * Unit tests for `loadConversationHistory` (Step 11.3).
 *
 * The Drizzle client is mocked. The query fetches the newest `limit` rows
 * (`ORDER BY created_at DESC LIMIT limit`), so the mocked `.limit(n)` slices the
 * seeded rows to `n` to emulate the SQL LIMIT; the function then reverses them to
 * chronological order and maps `role` → `CoreMessage`.
 */

type MessageRow = { role: string; content: string };

const mocks = vi.hoisted(() => ({
  // Seeded rows in newest-first order (as the DESC query would return them).
  rows: [] as MessageRow[],
  limitArg: 0,
}));

vi.mock("@/lib/platform/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: (n: number) => {
              mocks.limitArg = n;
              return Promise.resolve(mocks.rows.slice(0, n));
            },
          }),
        }),
      }),
    }),
  },
}));

const CONV_ID = "44444444-4444-4444-4444-444444444444";

describe("loadConversationHistory", () => {
  beforeEach(() => {
    mocks.rows = [];
    mocks.limitArg = 0;
  });

  it("returns all messages in chronological order as CoreMessage[]", async () => {
    // DESC query returns newest-first; the function must reverse to oldest-first.
    mocks.rows = [
      { role: "assistant", content: "answer-2" },
      { role: "user", content: "question-2" },
      { role: "user", content: "question-1" },
    ];

    const history = await loadConversationHistory(CONV_ID);

    expect(history).toEqual([
      { role: "user", content: "question-1" },
      { role: "user", content: "question-2" },
      { role: "assistant", content: "answer-2" },
    ]);
  });

  it("returns only the last 20 messages when there are more than 20", async () => {
    // 25 rows newest-first; the SQL LIMIT (emulated by the mock) keeps 20.
    mocks.rows = Array.from({ length: 25 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `message-${i}`,
    }));

    const history = await loadConversationHistory(CONV_ID);

    expect(mocks.limitArg).toBe(20);
    expect(history).toHaveLength(20);
  });

  it("returns an empty array when the conversation has no messages", async () => {
    mocks.rows = [];

    const history = await loadConversationHistory(CONV_ID);

    expect(history).toEqual([]);
  });
});
