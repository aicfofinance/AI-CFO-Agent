import { NextResponse } from "next/server";
import { z, ZodError } from "zod";

import { getRequestContext, RequestContextError } from "@/lib/platform/auth/session";
import { db } from "@/lib/platform/db/client";
import { conversations } from "@/lib/platform/db/schema";

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

/**
 * GET /api/conversations — list the caller's conversations.
 *
 * Minimal stub for now: the full cursor-paginated list is implemented in Step
 * 11.4. Returns an empty list under the standard envelope so callers have a
 * stable shape to consume in the meantime.
 */
export function GET(): NextResponse {
  return NextResponse.json({ data: [] });
}
