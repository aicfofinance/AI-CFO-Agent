import { buildFinancialContext } from "@/lib/ai/context/builder";

/**
 * Builds the full system prompt for a financial Q&A conversation (Step 11.1).
 *
 * The prompt is assembled from four parts, in order:
 *   1. Role + prohibition instructions — what the assistant is and is not.
 *   2. The org's live financial context from `buildFinancialContext(orgId)`
 *      (revenue/expense/cash/AR numbers, already formatted via `formatCurrency`).
 *   3. The currency-formatting instruction from FRONTEND_GUIDELINES.md §8.1.1 so
 *      AI-streamed text matches the `formatCurrency()` output the UI renders
 *      (e.g. `$45,200.00`, not `$45200` or `$45.2K`).
 *   4. A closing not-financial-advice reminder.
 *
 * The standard financial disclaimer is NOT emitted here — it is appended as the
 * guaranteed final chunk by `src/lib/ai/streaming/handler.ts`. Instructing the
 * model to also produce it would duplicate the disclaimer in the response.
 *
 * This function makes NO AI model call and imports no provider; the only entry
 * point to a model is `getModel()` in `src/lib/ai/models/router.ts`.
 *
 * Total size stays well under the 10,000-token budget: the financial context is
 * capped under 8,000 characters upstream and the static instructions below add
 * roughly another 2,000 characters.
 *
 * @param orgId Current org id from `getRequestContext()`. The underlying context
 *   query is scoped to this org — never pass a user-supplied org id.
 */
export async function buildSystemPrompt(orgId: string): Promise<string> {
  const financialContext = await buildFinancialContext(orgId);

  const roleInstructions = [
    "You are an AI financial advisor assistant for a small business. You analyze",
    "accounting data imported from QuickBooks or Xero and provide clear, concise,",
    "actionable insights grounded strictly in the financial context provided below.",
    "You are NOT a licensed financial advisor. For any decision requiring expert",
    "judgment, remind the user to consult a qualified financial professional.",
  ].join(" ");

  const prohibitions = [
    "PROHIBITED BEHAVIORS — you must never:",
    "- Provide specific investment advice or recommend particular securities.",
    "- Predict stock prices or the future value of any asset.",
    "- Recommend specific tax strategies or ways to reduce or avoid taxes.",
    "- Advise the user to take on debt, take out a loan, or move money into a",
    "  particular product or account.",
    "- Make hiring or firing recommendations.",
    "If asked for any of the above, briefly decline and redirect the user to a",
    "question you can answer about their own financial data.",
  ].join("\n");

  // FRONTEND_GUIDELINES.md §8.1.1 — verbatim intent. AI-streamed text is rendered
  // as plain markdown and is NOT passed through `formatCurrency()`, so the model
  // must format currency itself to stay consistent with the dashboard's
  // `<CurrencyAmount>` output.
  const currencyFormatting = [
    "CURRENCY FORMATTING (required):",
    "When referencing dollar amounts, always format them as currency: $1,234.56 —",
    "a US dollar sign, comma-separated thousands, and exactly two decimal places.",
    "Use the Unicode minus sign (−, U+2212) — not a hyphen (-) — for negative",
    "values: −$1,234.56. Never abbreviate amounts below $100,000 (write $45,200.00,",
    "not $45.2K). For amounts of $100,000 and above, abbreviation is acceptable",
    "($1.2M, $145K). Example: $45,000.00 + $12,500.00 = $57,500.00.",
  ].join("\n");

  const closingReminder = [
    "Remember: your analysis is based on the accounting data below and is not",
    "financial advice. Encourage the user to consult a qualified financial",
    "professional for decisions requiring expert judgment.",
  ].join(" ");

  return [
    roleInstructions,
    "",
    prohibitions,
    "",
    currencyFormatting,
    "",
    financialContext,
    "",
    closingReminder,
  ].join("\n");
}
