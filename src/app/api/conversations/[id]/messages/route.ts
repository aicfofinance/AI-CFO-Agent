import { createDataStreamResponse, formatDataStreamPart, streamText } from "ai";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z, ZodError } from "zod";

import { loadConversationHistory } from "@/lib/ai/context/history";
import { checkGuardrails } from "@/lib/ai/guardrails/financial-advice";
import { detectRateLimitError, getModel } from "@/lib/ai/models/router";
import { buildFinancialQAPrompt } from "@/lib/ai/prompts/financial-qa";
import { buildSystemPrompt } from "@/lib/ai/prompts/system";
import { FINANCIAL_DISCLAIMER } from "@/lib/ai/streaming/handler";
import { checkAndIncrementQuota } from "@/lib/billing/quota";
import { env } from "@/lib/env";
import { getRequestContext, RequestContextError } from "@/lib/platform/auth/session";
import { db } from "@/lib/platform/db/client";
import { conversations, messages, queryLog } from "@/lib/platform/db/schema";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * POST /api/conversations/:id/messages — streaming financial Q&A (Step 11.3).
 *
 * Requires session. Processing order (each gate short-circuits before the next):
 *   1. `getRequestContext()` → org + user (401 / 403 / 500 via RequestContextError)
 *   2. Verify the conversation belongs to the session org (404 if not — a
 *      cross-org id never matches, so existence is never leaked; CLAUDE.md)
 *   3. Validate the body with Zod (`.parse` throws → 400 VALIDATION_ERROR)
 *   4. `checkAndIncrementQuota()` — atomic row-locked decrement (429 if exhausted)
 *   5. Upstash sliding-window rate limit, 10/min per org (429 if exceeded)
 *   6. `checkGuardrails()` — a flagged question streams a template refusal and the
 *      model is never called (CLAUDE.md: never bypass the guardrail)
 *   7. Load window-trimmed history + build the org-scoped system prompt
 *   8. Stream via `getModel(0.5)`, append the standard disclaimer as the final
 *      chunk, then persist the assistant turn and a `query_log` row.
 *
 * The org is always sourced from `getRequestContext()`, never from user input,
 * and every org-scoped query is filtered by it (CLAUDE.md, Multi-tenancy Rules).
 *
 * The successful response is a Vercel AI SDK data stream. `X-Queries-Remaining`
 * carries the post-decrement quota count so the client can render the exhaustion
 * state without a second request.
 */

/** Request body: a single free-text question, length-bounded. */
const messageBodySchema = z.object({
  question: z.string().min(1).max(2000),
});

/**
 * Upstash rate limiter, lazily constructed from the validated `env` (never
 * `process.env` / `Redis.fromEnv()` — CLAUDE.md forbids direct `process.env`
 * access outside `src/lib/env.ts`). Returns `null` when Upstash is not
 * configured (e.g. local dev without credentials); the route then skips rate
 * limiting rather than failing the request.
 */
let ratelimit: Ratelimit | null = null;
function getRatelimit(): Ratelimit | null {
  if (ratelimit) {
    return ratelimit;
  }
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }
  ratelimit = new Ratelimit({
    redis: new Redis({
      url: env.UPSTASH_REDIS_REST_URL,
      token: env.UPSTASH_REDIS_REST_TOKEN,
    }),
    limiter: Ratelimit.slidingWindow(10, "1 m"),
    analytics: false,
  });
  return ratelimit;
}

/** Template refusal for a guardrail-flagged question. `reason` is a fixed
 * internal advice-category label (not user input), so it is safe to interpolate. */
function buildRefusalText(reason: string): string {
  return (
    `I can help with questions about your financial data, but I'm not able to ` +
    `provide advice on ${reason}. Try asking about your revenue trends, expenses, ` +
    `or outstanding invoices instead.`
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const request_id = crypto.randomUUID();

  try {
    // 1. Session → org context.
    const { orgId, userId } = await getRequestContext(request);
    const { id: conversationId } = await params;

    // 2. Org-scoped ownership check. A conversation in another org yields no row
    //    → 404 that does not reveal whether it exists elsewhere (CLAUDE.md).
    const [conversation] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.orgId, orgId)))
      .limit(1);

    if (!conversation) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Conversation not found.", request_id } },
        { status: 404 },
      );
    }

    // 3. Validate the body. `.parse` throws a ZodError caught below as a 400.
    const { question } = messageBodySchema.parse(await request.json());

    // 4. Atomic quota check-and-decrement (row lock). Exhausted → 429.
    const quota = await checkAndIncrementQuota(orgId, db);
    if (!quota.allowed) {
      return NextResponse.json(
        {
          error: {
            code: "QUOTA_EXCEEDED",
            message: "Monthly query limit reached.",
            request_id,
          },
          data: { queriesRemaining: 0 },
        },
        { status: 429, headers: { "X-Queries-Remaining": "0" } },
      );
    }

    // 5. Per-org sliding-window rate limit (10/min). Skipped when unconfigured.
    const limiter = getRatelimit();
    if (limiter) {
      const { success } = await limiter.limit(orgId);
      if (!success) {
        return NextResponse.json(
          {
            error: {
              code: "RATE_LIMITED",
              message: "Too many requests. Please slow down and try again shortly.",
              request_id,
            },
          },
          {
            status: 429,
            headers: { "X-Queries-Remaining": String(quota.queriesRemaining) },
          },
        );
      }
    }

    // 6. Guardrail — a flagged question streams a refusal; the model is never
    //    called. The refusal shares the client's `useChat` rendering path.
    const guardrail = checkGuardrails(question);
    if (guardrail.flagged) {
      try {
        await db.insert(queryLog).values({
          orgId,
          userId,
          success: false,
          failureReason: "guardrail_triggered",
        });
      } catch (logError) {
        console.error({
          event: "messages_query_log_failed",
          orgId,
          conversationId,
          errorMessage: logError instanceof Error ? logError.message : String(logError),
        });
      }

      const refusal = buildRefusalText(guardrail.reason);
      return createDataStreamResponse({
        headers: { "X-Queries-Remaining": String(quota.queriesRemaining) },
        execute: (dataStream) => {
          dataStream.write(formatDataStreamPart("text", refusal));
        },
      });
    }

    // 7. History (window-trimmed) + org-scoped system prompt + routed model.
    //    The financial context is fetched once, inside `buildSystemPrompt`; the
    //    user-turn builder is a thin formatter that does not re-fetch it.
    const history = await loadConversationHistory(conversationId);
    const userTurn = await buildFinancialQAPrompt(orgId, question);
    const system = await buildSystemPrompt(orgId);
    const model = getModel(0.5);

    // Persist the user's turn before streaming the answer so a mid-stream failure
    // still leaves the question recorded in the conversation.
    await db.insert(messages).values({
      conversationId,
      orgId,
      role: "user",
      content: question,
    });

    const startedAt = Date.now();

    // 8. Stream the model output, append the disclaimer as the guaranteed FINAL
    //    text chunk, then persist the assistant turn and the query_log audit row.
    return createDataStreamResponse({
      headers: { "X-Queries-Remaining": String(quota.queriesRemaining) },
      execute: async (dataStream) => {
        const result = streamText({
          model,
          system,
          messages: [...history, { role: "user", content: userTurn }],
        });

        let answer = "";
        for await (const delta of result.textStream) {
          answer += delta;
          dataStream.write(formatDataStreamPart("text", delta));
        }
        dataStream.write(formatDataStreamPart("text", `\n\n${FINANCIAL_DISCLAIMER}`));

        const usage = await result.usage;
        const responseTimeMs = Date.now() - startedAt;
        // Stored content includes the disclaimer so the persisted answer matches
        // exactly what the user saw (CLAUDE.md: disclaimer is never omitted).
        const finalContent = `${answer}\n\n${FINANCIAL_DISCLAIMER}`;

        try {
          const [assistantMessage] = await db
            .insert(messages)
            .values({
              conversationId,
              orgId,
              role: "assistant",
              content: finalContent,
              modelUsed: model.modelId,
              inputTokens: usage.promptTokens ?? null,
              outputTokens: usage.completionTokens ?? null,
              responseTimeMs,
            })
            .returning({ id: messages.id });

          await db.insert(queryLog).values({
            orgId,
            userId,
            messageId: assistantMessage?.id ?? null,
            success: true,
            modelUsed: model.modelId,
            inputTokens: usage.promptTokens ?? null,
            outputTokens: usage.completionTokens ?? null,
            responseTimeMs,
          });
        } catch (persistError) {
          // The answer already streamed to the client; a persistence failure is
          // logged but must not surface as a stream error.
          console.error({
            event: "messages_persist_failed",
            orgId,
            conversationId,
            errorMessage:
              persistError instanceof Error ? persistError.message : String(persistError),
          });
        }
      },
      onError: (error) => {
        // Rate limits are surfaced, never retried and never failed over to
        // another provider (CLAUDE.md AI Integration Rules).
        if (detectRateLimitError(error)) {
          console.error({ event: "messages_rate_limited", orgId, conversationId });
          return "The AI service is busy right now. Please try again in a moment.";
        }
        console.error({
          event: "messages_stream_failed",
          orgId,
          conversationId,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        return "An unexpected error occurred while generating a response.";
      },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid request body.",
            details: error.issues,
            request_id,
          },
        },
        { status: 400 },
      );
    }

    if (error instanceof RequestContextError) {
      console.error({ event: "messages_auth_failed", code: error.code, request_id });
      return NextResponse.json(
        { error: { code: error.code, message: error.message, request_id } },
        { status: error.status },
      );
    }

    console.error({
      event: "messages_failed",
      errorMessage: error instanceof Error ? error.message : String(error),
      request_id,
    });
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred.",
          request_id,
        },
      },
      { status: 500 },
    );
  }
}
