/**
 * User-turn prompt builder for the financial Q&A interface (Step 11.3).
 *
 * The org's live financial context (revenue/expense/cash/AR numbers) is injected
 * ONCE, into the SYSTEM prompt via `buildSystemPrompt(orgId)` — which itself
 * wraps `buildFinancialContext(orgId)`. This builder therefore does NOT re-fetch
 * that context: doing so would run the full aggregation twice per turn and
 * duplicate several thousand tokens in the request. It is a thin formatter that
 * labels the raw question so the model can distinguish the current turn from the
 * surrounding system context and conversation history.
 *
 * `orgId` is part of the call contract — every prompt builder in this layer is
 * org-scoped, and the messages route passes the session org (never user input) —
 * even though the org-scoped lookup lives in `buildSystemPrompt`.
 *
 * This function makes NO AI model call and imports no provider; the only entry
 * point to a model is `getModel()` in `src/lib/ai/models/router.ts`.
 *
 * @param orgId    Current org id from `getRequestContext()`.
 * @param question Raw user question text (already length-validated by the route).
 * @returns The formatted user-turn content.
 */
export async function buildFinancialQAPrompt(orgId: string, question: string): Promise<string> {
  void orgId;
  return `[User Question]\n${question}`;
}
