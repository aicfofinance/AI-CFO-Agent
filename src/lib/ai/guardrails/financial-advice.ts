/**
 * Pre-flight content guardrail for the financial Q&A interface (Step 11.1).
 *
 * `checkGuardrails(question)` runs before every AI call. If it returns
 * `{ flagged: true }`, the streaming handler returns a template refusal and the
 * model is never called (CLAUDE.md AI Integration Rules — never bypass the
 * guardrail to "get an answer anyway").
 *
 * The guardrail is intentionally CONSERVATIVE: it flags only clear requests for
 * personal financial, investment, tax, or HR advice. Analytical and diagnostic
 * questions about the user's own data ("What are my top expenses?", "Why is my
 * revenue down?") must always pass. When in doubt, do not flag — a false refusal
 * is a worse product experience than answering a borderline analytical question.
 */

export type GuardrailResult = { flagged: false } | { flagged: true; reason: string };

/**
 * A single guardrail rule: any of `patterns` (matched case-insensitively as a
 * substring of the normalized question) trips the rule and flags with `reason`.
 */
type GuardrailRule = {
  reason: string;
  patterns: readonly string[];
};

/**
 * Ordered rule set. The first matching rule wins, so more specific advice
 * categories (investment, tax, HR) are listed before the generic
 * money-movement catch-all.
 */
const GUARDRAIL_RULES: readonly GuardrailRule[] = [
  {
    reason: "investment advice",
    patterns: [
      "should i take out a loan",
      "should i invest in",
      "should i buy stocks",
      "should i sell stocks",
      "what stocks should",
      "which stocks should",
    ],
  },
  {
    reason: "tax advice",
    patterns: ["tax strategy", "tax strategies", "how to avoid taxes", "how do i avoid taxes"],
  },
  {
    reason: "HR advice",
    patterns: ["should i hire", "should i fire"],
  },
  {
    reason: "financial advice",
    patterns: ["put my money in", "move my money to"],
  },
] as const;

/**
 * Screens a user question for requests that fall outside the product's remit
 * (data analysis of the user's own accounting records).
 *
 * @param question Raw user question text.
 * @returns `{ flagged: false }` when safe to answer, or
 *   `{ flagged: true, reason }` with the advice category that tripped the rule.
 */
export function checkGuardrails(question: string): GuardrailResult {
  const normalized = question.toLowerCase();

  for (const rule of GUARDRAIL_RULES) {
    if (rule.patterns.some((pattern) => normalized.includes(pattern))) {
      return { flagged: true, reason: rule.reason };
    }
  }

  return { flagged: false };
}
