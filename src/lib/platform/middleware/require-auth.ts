import { NextResponse } from "next/server";

import {
  getRequestContext,
  RequestContextError,
  type RequestContext,
} from "@/lib/platform/auth/session";

/**
 * Discriminated result of an auth gate. Route handlers narrow on `ok`:
 *
 * ```ts
 * const result = await requireAuth(request);
 * if (!result.ok) return result.response;
 * const { orgId, role } = result.ctx;
 * ```
 *
 * This keeps the handler's happy path free of try/catch while still funnelling
 * every failure into the standard error envelope with a correlating request_id.
 */
export type AuthResult = { ok: true; ctx: RequestContext } | { ok: false; response: NextResponse };

/**
 * Establishes request context or returns a ready-to-send error response.
 *
 * A `RequestContextError` maps to its carried status/code (401 unauthenticated,
 * 403 no membership, 500 missing org/subscription context). Any other thrown
 * value is treated as an unexpected 500 and never leaked to the client as a
 * stack trace.
 */
export async function requireAuth(request: Request): Promise<AuthResult> {
  const requestId = crypto.randomUUID();

  try {
    const ctx = await getRequestContext(request);
    return { ok: true, ctx };
  } catch (error) {
    if (error instanceof RequestContextError) {
      console.error({ event: "require_auth_failed", code: error.code, requestId });
      return {
        ok: false,
        response: NextResponse.json(
          { error: { code: error.code, message: error.message, request_id: requestId } },
          { status: error.status },
        ),
      };
    }

    console.error({
      event: "require_auth_unexpected_error",
      errorMessage: error instanceof Error ? error.message : String(error),
      requestId,
    });
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "An unexpected error occurred.",
            request_id: requestId,
          },
        },
        { status: 500 },
      ),
    };
  }
}
