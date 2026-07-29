import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";

import { getRequestContext, RequestContextError } from "@/lib/platform/auth/session";
import { db } from "@/lib/platform/db/client";
import { conversations, messages } from "@/lib/platform/db/schema";
import type { ConversationDetail, MessageDetail } from "@/types/api";

/**
 * Narrows the DB `role` VARCHAR to the `MessageDetail` union. Only `assistant`
 * and `user` are ever written (see schema comment on `messages.role`); any other
 * value is coerced to `user` so the API never emits a role outside the union.
 */
function narrowRole(role: string): MessageDetail["role"] {
  return role === "assistant" ? "assistant" : "user";
}

/**
 * GET /api/conversations/:id — a single conversation with its full message
 * history in chronological order.
 *
 * Requires session. Returns 401 if unauthenticated, 403 if the conversation
 * belongs to a different org, 404 if it does not exist, 500 on unexpected error.
 *
 * Cross-org access returns 403 (not 404) per CLAUDE.md Multi-tenancy Rules: a
 * resource that exists but belongs to another org is an authorization failure.
 * A genuinely non-existent id is a 404. The org context is always sourced from
 * `getRequestContext()` — never from the URL or body.
 *
 * Response 200: `{ data: ConversationDetail }`.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const request_id = crypto.randomUUID();

  try {
    const { orgId } = await getRequestContext(request);
    const { id } = await params;

    // Fetch by id alone to distinguish "not found" (404) from "belongs to
    // another org" (403). Only non-sensitive columns are projected, and no
    // other org's data is ever returned — the row is used purely to decide the
    // status code.
    const [conversation] = await db
      .select({
        id: conversations.id,
        orgId: conversations.orgId,
        title: conversations.title,
        createdAt: conversations.createdAt,
      })
      .from(conversations)
      .where(eq(conversations.id, id))
      .limit(1);

    if (!conversation) {
      return NextResponse.json(
        {
          error: {
            code: "NOT_FOUND",
            message: "Conversation not found.",
            request_id,
          },
        },
        { status: 404 },
      );
    }

    if (conversation.orgId !== orgId) {
      console.error({
        event: "conversation_cross_org_access",
        conversationId: id,
        request_id,
      });
      return NextResponse.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "You do not have access to this conversation.",
            request_id,
          },
        },
        { status: 403 },
      );
    }

    const messageRows = await db
      .select({
        id: messages.id,
        role: messages.role,
        content: messages.content,
        createdAt: messages.createdAt,
        modelUsed: messages.modelUsed,
      })
      .from(messages)
      .where(and(eq(messages.conversationId, id), eq(messages.orgId, orgId)))
      .orderBy(asc(messages.createdAt));

    const messageDetails: MessageDetail[] = messageRows.map((row) => ({
      id: row.id,
      role: narrowRole(row.role),
      content: row.content,
      createdAt: row.createdAt.toISOString(),
      modelUsed: row.modelUsed,
    }));

    const data: ConversationDetail = {
      id: conversation.id,
      title: conversation.title ?? "",
      createdAt: conversation.createdAt.toISOString(),
      messages: messageDetails,
    };

    return NextResponse.json({ data }, { status: 200 });
  } catch (error) {
    if (error instanceof RequestContextError) {
      console.error({ event: "conversation_get_auth_failed", code: error.code, request_id });
      return NextResponse.json(
        { error: { code: error.code, message: error.message, request_id } },
        { status: error.status },
      );
    }

    console.error({
      event: "conversation_get_failed",
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
