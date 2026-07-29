import { NextResponse } from "next/server";

import { createServerClient } from "@/lib/platform/auth/supabase";

/**
 * POST /api/auth/logout — clears the current Supabase session.
 *
 * `signOut()` on the cookie-bound server client revokes the session and removes
 * the auth cookies (written back via the client's `setAll` cookie adapter). The
 * response uses the standard success envelope. Any unexpected failure is
 * surfaced as a 500 in the standard error envelope — never a raw error.
 */
export async function POST(): Promise<NextResponse> {
  const request_id = crypto.randomUUID();

  try {
    const supabase = await createServerClient();
    await supabase.auth.signOut();

    return NextResponse.json({ data: { message: "Logged out" } }, { status: 200 });
  } catch (error) {
    console.error({
      event: "auth_logout_failed",
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
