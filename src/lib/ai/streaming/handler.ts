import { createDataStream, formatDataStreamPart, streamText, type CoreMessage } from "ai";

import { checkGuardrails } from "@/lib/ai/guardrails/financial-advice";
import { detectRateLimitError, getModel } from "@/lib/ai/models/router";
import { buildSystemPrompt } from "@/lib/ai/prompts/system";

/**
 * Streaming handler for the financial Q&A interface (Step 11.1).
 *
 * Responsibilities, in order:
 *   1. Run `checkGuardrails()` — a flagged question returns a template refusal
 *      stream and the model is never called (CLAUDE.md: never bypass the
 *      guardrail).
 *   2. Build the org-scoped system prompt via `buildSystemPrompt(orgId)`.
 *   3. Obtain the model via `getModel(0.5)` — routine complexity. This module
 *      never imports an AI provider directly; `router.ts` is the sole exception.
 *   4. Stream the model response as a Vercel AI SDK data stream, then append the
 *      standard financial disclaimer as the guaranteed FINAL text chunk.
 *
 * The disclaimer is appended by the handler (not the model) so it can never be
 * omitted or truncated — CLAUDE.md requires it as the final response chunk of
 * every AI call in a financial context.
 */

/** Canonical financial disclaimer — the mandated final chunk of every response. */
const FINANCIAL_DISCLAIMER =
  "This is AI-generated analysis of your accounting data. It is not financial " +
  "advice. Consult a qualified financial professional for decisions requiring " +
  "expert judgment.";

type FinancialQueryInput = {
  orgId: string;
  conversationId: string;
  question: string;
  /** Window-trimmed conversation history (last 20 messages, < 8k tokens). */
  messages: CoreMessage[];
};

type FinancialQueryResult = {
  stream: ReadableStream;
};

/**
 * Builds the polite refusal message for a guardrail-flagged question. The
 * `reason` is the advice category returned by `checkGuardrails` (e.g.
 * "investment advice"), which is safe to interpolate — it is a fixed internal
 * label, not user input.
 */
function buildRefusalText(reason: string): string {
  return (
    `I can help with questions about your financial data, but I'm not able to ` +
    `provide advice on ${reason}. Try asking about your revenue trends, expenses, ` +
    `or outstanding invoices instead.`
  );
}

/**
 * Wraps a single block of plain text as a Vercel AI SDK data stream so refusals
 * and the model response share one client-side rendering path (`useChat`).
 */
function textToDataStream(text: string): ReadableStream {
  return createDataStream({
    execute: (dataStream) => {
      dataStream.write(formatDataStreamPart("text", text));
    },
  });
}

/**
 * Handles a financial Q&A turn and returns a streaming data-stream response.
 *
 * @param input Org id, conversation id, the current question, and trimmed history.
 */
export async function handleFinancialQuery(
  input: FinancialQueryInput,
): Promise<FinancialQueryResult> {
  const { orgId, conversationId, question, messages } = input;

  // 1. Guardrail — a flagged question never reaches the model.
  const guardrail = checkGuardrails(question);
  if (guardrail.flagged) {
    return { stream: textToDataStream(buildRefusalText(guardrail.reason)) };
  }

  // 2 + 3. System prompt (org-scoped) and model (routine complexity 0.5).
  const system = await buildSystemPrompt(orgId);
  const model = getModel(0.5);

  // 4. Stream the model output, then append the disclaimer as the final chunk.
  // The text deltas are written sequentially before the disclaimer, so the
  // disclaimer is always the last text the client receives.
  const stream = createDataStream({
    execute: async (dataStream) => {
      const result = streamText({ model, system, messages });

      for await (const delta of result.textStream) {
        dataStream.write(formatDataStreamPart("text", delta));
      }

      dataStream.write(formatDataStreamPart("text", `\n\n${FINANCIAL_DISCLAIMER}`));
    },
    onError: (error) => {
      // Rate limits are surfaced, never retried and never failed over to another
      // provider (CLAUDE.md AI Integration Rules). Logged with structured fields.
      if (detectRateLimitError(error)) {
        console.error({ event: "financial_query_rate_limited", orgId, conversationId });
        return "The AI service is busy right now. Please try again in a moment.";
      }

      console.error({
        event: "financial_query_stream_failed",
        orgId,
        conversationId,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      return "An unexpected error occurred while generating a response.";
    },
  });

  return { stream };
}
