/**
 * AI prompt builder for monthly financial report narrative generation.
 *
 * Used by `jobs/reports/monthly.ts` step "generate-narrative". The prompt
 * produces a 3–4 paragraph executive summary. The standard financial disclaimer
 * is embedded as an explicit instruction so the AI includes it as the final
 * paragraph (CLAUDE.md — AI Integration Rules: every AI call in a financial
 * context appends the standard disclaimer).
 *
 * Ownership: ai-engine-engineer (AGENTS.md, File Ownership Matrix).
 */

/**
 * Structured metrics snapshot written to the `reports.content` JSONB column.
 *
 * All monetary values are DECIMAL strings exactly as they leave Postgres —
 * never parsed to a JS `number` at any point (CLAUDE.md, Financial Data Rules).
 * Percentage fields (`grossMarginPct`, `mom*Pct`) are JS numbers only when they
 * represent a computed ratio derived from two DECIMAL strings; they are never
 * stored monetary aggregates. Null indicates the value is unavailable (e.g. no
 * prior-month snapshot exists for the `mom*Pct` fields, or revenue is zero for
 * `grossMarginPct`).
 */
export type ReportContent = {
  totalRevenue: string;
  totalExpenses: string;
  netProfit: string;
  /** (revenue − expenses) / revenue × 100. Null if revenue is zero or unavailable. */
  grossMarginPct: number | null;
  /** % change in revenue vs prior month. Null if no prior-month snapshot exists. */
  momRevenuePct: number | null;
  /** % change in expenses vs prior month. Null if no prior-month snapshot exists. */
  momExpensesPct: number | null;
  /** % change in net profit vs prior month. Null if no prior-month snapshot exists. */
  momNetProfitPct: number | null;
  /** Top 5 expense categories by amount, sorted descending. */
  topExpenseCategories: Array<{ category: string; amount: string }>;
  /** Top 3 revenue categories by amount, sorted descending. */
  topRevenueCategories: Array<{ category: string; amount: string }>;
  transactionCount: number;
};

/** Format a MoM percentage change for inclusion in the prompt. */
function formatMomPct(pct: number | null): string {
  if (pct === null) return "no prior-month data available";
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}% vs prior month`;
}

/**
 * Build the system prompt for monthly report narrative generation.
 *
 * @param metrics  Structured financial metrics from the period's snapshot.
 * @param periodLabel  Human-readable period label, e.g. "July 2026".
 * @returns A prompt string ready for `generateText({ model, prompt })`.
 */
export function buildReportPrompt(metrics: ReportContent, periodLabel: string): string {
  const expenseList =
    metrics.topExpenseCategories.length > 0
      ? metrics.topExpenseCategories.map((c) => `${c.category} ($${c.amount})`).join(", ")
      : "none recorded";

  const revenueList =
    metrics.topRevenueCategories.length > 0
      ? metrics.topRevenueCategories.map((c) => `${c.category} ($${c.amount})`).join(", ")
      : "none recorded";

  const grossMarginLine =
    metrics.grossMarginPct !== null ? `${metrics.grossMarginPct.toFixed(1)}%` : "insufficient data";

  return `You are a CFO writing a monthly financial summary for a business owner.

Write a 3–4 paragraph executive summary for ${periodLabel}. Be direct and specific about the numbers — no generic statements. Structure the narrative as follows: (1) overall month performance and whether the business was profitable, (2) revenue drivers and top revenue categories, (3) expense patterns and notable categories, (4) month-over-month trends if data is available, and a brief one-sentence forward-looking note. Do not begin with a preamble such as "Here is the summary:" — start directly with the substance.

FINANCIAL METRICS FOR ${periodLabel.toUpperCase()}:
Revenue: $${metrics.totalRevenue}
Expenses: $${metrics.totalExpenses}
Net Profit: $${metrics.netProfit}
Gross Margin: ${grossMarginLine}
Revenue MoM: ${formatMomPct(metrics.momRevenuePct)}
Expenses MoM: ${formatMomPct(metrics.momExpensesPct)}
Net Profit MoM: ${formatMomPct(metrics.momNetProfitPct)}
Top expense categories: ${expenseList}
Top revenue categories: ${revenueList}
Transactions processed: ${metrics.transactionCount}

End your response with this exact paragraph, verbatim:
"This is AI-generated analysis of your accounting data. It is not financial advice. Consult a qualified financial professional for decisions requiring expert judgment."`;
}
