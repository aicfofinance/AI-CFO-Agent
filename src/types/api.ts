/**
 * Response body of `GET /api/financial/summary`.
 *
 * Every monetary field is a DECIMAL string exactly as it leaves Postgres — no
 * field is parsed to a JS `number` at any point, because IEEE-754 floats cannot
 * represent decimal money exactly (CLAUDE.md, Financial Data Rules). `sharePct`
 * is a derived percentage string (four decimal places), not a monetary balance.
 *
 * This type describes the payload nested under the standard `{ data: T }`
 * success envelope, not the envelope itself.
 */
/**
 * Response body of `GET /api/auth/me`.
 *
 * Combines the per-request org context (`getRequestContext()`) with the two
 * mutable profile fields owned by `PATCH /api/auth/me` — `displayName` (backed
 * by `organizations.name`) and `timezone` — so a PATCH is observable via a
 * subsequent GET. `queriesUsed` / `queriesLimit` are integer counts, not money.
 *
 * This type describes the payload nested under the standard `{ data: T }`
 * success envelope, not the envelope itself.
 */
export type AuthMeResponse = {
  userId: string;
  orgId: string;
  role: string;
  planTier: string;
  queriesUsed: number;
  queriesLimit: number;
  displayName: string;
  timezone: string;
};

/**
 * Response body of `POST /api/conversations`.
 *
 * `createdAt` is an ISO-8601 string (the DECIMAL-as-string rule is about money;
 * timestamps serialize as ISO strings). This is the payload nested under the
 * standard `{ data: T }` success envelope, not the envelope itself.
 */
export type ConversationCreateResponse = {
  id: string;
  title: string;
  createdAt: string;
};

/**
 * One row in `GET /api/conversations` (the history list). `messageCount` and
 * `lastMessageAt` are aggregates over the conversation's `messages`, computed in
 * SQL — never derived in JavaScript. `lastMessageAt` is null for a conversation
 * that has no messages yet (the `/ask` page pre-creates an empty conversation).
 *
 * This is the shape nested under each element of the `{ data, meta }` envelope.
 */
export type ConversationSummary = {
  id: string;
  title: string;
  createdAt: string;
  messageCount: number;
  lastMessageAt: string | null;
};

/**
 * One turn in a conversation, as returned by `GET /api/conversations/:id` and
 * the export endpoint. `role` is narrowed to the two valid values; `modelUsed`
 * is null for `user`-role turns (only assistant turns record a model).
 */
export type MessageDetail = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  modelUsed: string | null;
};

/**
 * Response payload of `GET /api/conversations/:id` — a single conversation with
 * its full message history in chronological order. Nested under `{ data: T }`.
 */
export type ConversationDetail = {
  id: string;
  title: string;
  createdAt: string;
  messages: MessageDetail[];
};

/**
 * One row in `GET /api/connections`. Sensitive columns
 * (`access_token_encrypted`, `refresh_token_encrypted`, `token_expiry`) are
 * never included — they are stripped in the query projection, not just omitted
 * from the type (CLAUDE.md, Security Rules).
 */
export type ConnectionSummary = {
  id: string;
  provider: string;
  isActive: boolean;
  lastSyncedAt: string | null;
  lastIntelligenceRunAt: string | null;
  syncStatus: string | null;
  providerCompanyName: string | null;
  realmId: string | null;
};

/**
 * One row in `GET /api/intelligence/findings` — the multi-status finding
 * archive backing the `/alerts` page. Unlike `FindingFeedItem` (active feed),
 * this shape carries the dismissal audit fields (`dismissedAt`,
 * `dismissReason`), which are `null` unless the finding's status is
 * `dismissed`. `relatedData` monetary values remain DECIMAL strings exactly as
 * they leave Postgres — never parsed to a JS `number` (CLAUDE.md, Financial
 * Data Rules). `createdAt` / `expiresAt` / `dismissedAt` are ISO-8601 strings.
 *
 * This is the shape nested under each element of the `{ data, meta }` envelope.
 */
export type FindingArchiveItem = {
  id: string;
  findingType: string;
  severity: string;
  headline: string;
  detail: string;
  recommendedAction: string | null;
  relatedData: Record<string, unknown>;
  status: string;
  createdAt: string;
  expiresAt: string | null;
  hasActionableType: boolean;
  dismissedAt: string | null;
  dismissReason: string | null;
};

/**
 * Response payload of `GET /api/intelligence/findings`. `meta.total` counts the
 * full filtered population (all matching statuses/types/dates), not just the
 * current page. `meta.nextCursor` is the opaque Base64 cursor for the next
 * page, or `null` on the last page.
 */
export type FindingArchiveResponse = {
  data: FindingArchiveItem[];
  meta: { total: number; nextCursor: string | null };
};

export type FinancialSummaryResponse = {
  currentMonth: {
    revenue: string;
    expenses: string;
    netProfit: string;
  };
  cashPosition: string;
  topExpenseCategories: Array<{
    category: string;
    amount: string;
    sharePct: string;
  }>;
  revenueTrend: Array<{
    month: string;
    revenue: string;
    expenses: string;
    netProfit: string;
  }>;
  generatedAt: string;
};
