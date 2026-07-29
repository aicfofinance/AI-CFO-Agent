import { NextResponse } from "next/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { z, ZodError } from "zod";

import { getRequestContext, RequestContextError } from "@/lib/platform/auth/session";
import { db } from "@/lib/platform/db/client";
import { conversations, messages } from "@/lib/platform/db/schema";
import type { ConversationSummary } from "@/types/api";

/**
 * Default conversation title used when the client does not supply one. The
 * `/ask` page pre-creates a conversation on load before the user has typed a
 * question, so a body-less POST is the common case.
 */
const DEFAULT_TITLE = "Q&A Session";

/**
 * Request body for `POST /api/conversations`. `title` is optional — everything
 * else on the row (`orgId`, `userId`) is server-derived from the session, never
 * from the body (CLAUDE.md, Multi-tenancy Rules).
 */
const CreateConversationSchema = z.object({
  title: z.string().min(1).max(200).optional(),
});

/**
 * POST /api/conversations — create a conversation for the caller's org.
 *
 * Requires session. Returns 201 on success, 401 if unauthenticated, 403 if the
 * user has no org membership, 400 on body validation failure, 500 on unexpected
 * error. The `/ask` page calls this on load to obtain a real conversation UUID
 * before the first message is streamed (Step 11.3 uses that UUID in the messages
 * URL — never a literal `:id`).
 *
 * Response 201: `{ data: { id, title, createdAt } }`.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const request_id = crypto.randomUUID();

  try {
    const { orgId, userId } = await getRequestContext(request);

    // A body-less pre-create POST is expected, so a missing/empty body parses to
    // an empty object (all fields optional) rather than throwing.
    const body: unknown = await request.json().catch(() => ({}));
    const { title } = CreateConversationSchema.parse(body);
    const finalTitle = title ?? DEFAULT_TITLE;

    const [created] = await db
      .insert(conversations)
      .values({ orgId, userId, title: finalTitle })
      .returning({ id: conversations.id, createdAt: conversations.createdAt });

    if (!created) {
      throw new Error("Conversation insert returned no row.");
    }

    return NextResponse.json(
      {
        data: {
          id: created.id,
          title: finalTitle,
          createdAt: created.createdAt.toISOString(),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof RequestContextError) {
      console.error({ event: "conversation_create_auth_failed", code: error.code, request_id });
      return NextResponse.json(
        { error: { code: error.code, message: error.message, request_id } },
        { status: error.status },
      );
    }

    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Request body is invalid.",
            details: error.issues,
            request_id,
          },
        },
        { status: 400 },
      );
    }

    console.error({
      event: "conversation_create_failed",
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

/** Conversations per page (CLAUDE.md: cursor-based pagination, never OFFSET). */
const PAGE_SIZE = 20;

/** Opaque cursor payload — the sort key of the last item on the previous page. */
type ListCursor = {
  createdAt: string;
  id: string;
};

/**
 * Decodes the base64url cursor; returns null if malformed (treated as no
 * cursor, i.e. first page). The cursor is opaque to the client.
 */
function decodeCursor(raw: string | null): ListCursor | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "createdAt" in parsed &&
      "id" in parsed &&
      typeof (parsed as ListCursor).createdAt === "string" &&
      typeof (parsed as ListCursor).id === "string"
    ) {
      return { createdAt: (parsed as ListCursor).createdAt, id: (parsed as ListCursor).id };
    }
    return null;
  } catch {
    return null;
  }
}

/** Encodes the sort key of the last returned row as an opaque base64url cursor. */
function encodeCursor(cursor: ListCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

/**
 * GET /api/conversations?cursor=... — list the caller's conversations.
 *
 * Requires session. Returns 401 if unauthenticated, 403 if the user has no org
 * membership, 500 on unexpected error.
 *
 * Cursor-paginated (20 per page), newest first by `created_at`/`id`. The cursor
 * is a base64url-encoded `{ createdAt, id }`. `messageCount` and `lastMessageAt`
 * are aggregated in SQL via a LEFT JOIN + GROUP BY so an empty conversation
 * reports `messageCount: 0` / `lastMessageAt: null`. `meta.total` is the org's
 * full conversation count, not just the page.
 *
 * The org filter is always sourced from `getRequestContext()` — never from user
 * input (CLAUDE.md, Multi-tenancy Rules). The `messages` join is additionally
 * org-scoped for defence in depth.
 *
 * Response 200: `{ data: ConversationSummary[], meta: { total, nextCursor } }`.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const request_id = crypto.randomUUID();

  try {
    const { orgId } = await getRequestContext(request);

    const cursor = decodeCursor(new URL(request.url).searchParams.get("cursor"));

    const orgFilter = eq(conversations.orgId, orgId);
    const pageFilter = cursor
      ? and(
          orgFilter,
          sql`(${conversations.createdAt} < ${cursor.createdAt} OR (${conversations.createdAt} = ${cursor.createdAt} AND ${conversations.id} < ${cursor.id}))`,
        )
      : orgFilter;

    // Fetch one extra row to detect whether a further page exists.
    const rows = await db
      .select({
        id: conversations.id,
        title: conversations.title,
        createdAt: conversations.createdAt,
        messageCount: sql<number>`count(${messages.id})::int`,
        lastMessageAt: sql<string | null>`max(${messages.createdAt})`,
      })
      .from(conversations)
      .leftJoin(
        messages,
        and(eq(messages.conversationId, conversations.id), eq(messages.orgId, orgId)),
      )
      .where(pageFilter)
      .groupBy(conversations.id)
      .orderBy(desc(conversations.createdAt), desc(conversations.id))
      .limit(PAGE_SIZE + 1);

    const hasMore = rows.length > PAGE_SIZE;
    const pageRows = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

    const data: ConversationSummary[] = pageRows.map((row) => ({
      id: row.id,
      title: row.title ?? "",
      createdAt: row.createdAt.toISOString(),
      messageCount: row.messageCount,
      // `max()` returns an ISO-ish timestamp string (or null) from Postgres.
      lastMessageAt: row.lastMessageAt,
    }));

    const lastRow = pageRows[pageRows.length - 1];
    const nextCursor =
      hasMore && lastRow
        ? encodeCursor({ createdAt: lastRow.createdAt.toISOString(), id: lastRow.id })
        : null;

    const [totalRow] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(conversations)
      .where(orgFilter);

    const total = totalRow?.total ?? 0;

    return NextResponse.json({ data, meta: { total, nextCursor } }, { status: 200 });
  } catch (error) {
    if (error instanceof RequestContextError) {
      console.error({ event: "conversation_list_auth_failed", code: error.code, request_id });
      return NextResponse.json(
        { error: { code: error.code, message: error.message, request_id } },
        { status: error.status },
      );
    }

    console.error({
      event: "conversation_list_failed",
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
