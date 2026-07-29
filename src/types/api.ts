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
