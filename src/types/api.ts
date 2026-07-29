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
