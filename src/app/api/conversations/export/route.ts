import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";

import { getRequestContext, RequestContextError } from "@/lib/platform/auth/session";
import { db } from "@/lib/platform/db/client";
import { conversations, messages } from "@/lib/platform/db/schema";
import type { MessageDetail } from "@/types/api";

/**
 * One export per org per hour. V1 uses an in-process Map — a full export is a
 * heavy full-table read, so this throttles abusive repeat calls without needing
 * persistence. The window is best-effort across a single server instance; it is
 * not a security control, just a courtesy rate limit.
 */
const EXPORT_WINDOW_MS = 60 * 60 * 1000;
const lastExportByOrg = new Map<string, number>();

/**
 * Narrows the DB `role` VARCHAR to the `MessageDetail` union (see the single
 * conversation route for the rationale).
 */
function narrowRole(role: string): MessageDetail["role"] {
  return role === "assistant" ? "assistant" : "user";
}

type ExportedConversation = {
  id: string;
  title: string;
  createdAt: string;
  messages: MessageDetail[];
};

/**
 * GET /api/conversations/export — download the org's entire conversation
 * history as a JSON attachment.
 *
 * Requires session. Returns 401 if unauthenticated, 403 if the user has no org
 * membership, 429 if the org already exported within the last hour, 500 on
 * unexpected error.
 *
 * Returns ALL conversations for the org (no pagination) with their full message
 * history, ordered oldest-first within each conversation. The org filter is
 * always sourced from `getRequestContext()`.
 *
 * Success response is served as `application/json` with a
 * `Content-Disposition: attachment` header so the browser downloads it.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const request_id = crypto.randomUUID();

  try {
    const { orgId } = await getRequestContext(request);

    const now = Date.now();
    const previous = lastExportByOrg.get(orgId);
    if (previous !== undefined && now - previous < EXPORT_WINDOW_MS) {
      const availableAt = new Date(previous + EXPORT_WINDOW_MS).toISOString();
      return NextResponse.json(
        {
          error: {
            code: "EXPORT_RATE_LIMITED",
            message: `Export available again at ${availableAt}`,
            request_id,
          },
        },
        { status: 429 },
      );
    }

    // Two flat queries + an in-memory group-by (no monetary arithmetic here, so
    // JS grouping is fine): all conversations, then all messages for the org.
    const conversationRows = await db
      .select({
        id: conversations.id,
        title: conversations.title,
        createdAt: conversations.createdAt,
      })
      .from(conversations)
      .where(eq(conversations.orgId, orgId))
      .orderBy(asc(conversations.createdAt));

    const messageRows = await db
      .select({
        id: messages.id,
        conversationId: messages.conversationId,
        role: messages.role,
        content: messages.content,
        createdAt: messages.createdAt,
        modelUsed: messages.modelUsed,
      })
      .from(messages)
      .where(eq(messages.orgId, orgId))
      .orderBy(asc(messages.conversationId), asc(messages.createdAt));

    const messagesByConversation = new Map<string, MessageDetail[]>();
    for (const row of messageRows) {
      const detail: MessageDetail = {
        id: row.id,
        role: narrowRole(row.role),
        content: row.content,
        createdAt: row.createdAt.toISOString(),
        modelUsed: row.modelUsed,
      };
      const existing = messagesByConversation.get(row.conversationId);
      if (existing) {
        existing.push(detail);
      } else {
        messagesByConversation.set(row.conversationId, [detail]);
      }
    }

    const exportedConversations: ExportedConversation[] = conversationRows.map((row) => ({
      id: row.id,
      title: row.title ?? "",
      createdAt: row.createdAt.toISOString(),
      messages: messagesByConversation.get(row.id) ?? [],
    }));

    const exportedAt = new Date(now).toISOString();
    const payload = { exportedAt, conversations: exportedConversations };

    // Record the export only after it has been assembled successfully, so a
    // failure mid-query does not consume the org's hourly window.
    lastExportByOrg.set(orgId, now);

    const filenameDate = exportedAt.slice(0, 10);
    return new NextResponse(JSON.stringify(payload), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="conversations-${filenameDate}.json"`,
      },
    });
  } catch (error) {
    if (error instanceof RequestContextError) {
      console.error({ event: "conversation_export_auth_failed", code: error.code, request_id });
      return NextResponse.json(
        { error: { code: error.code, message: error.message, request_id } },
        { status: error.status },
      );
    }

    console.error({
      event: "conversation_export_failed",
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
