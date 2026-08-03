import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { createServerClient } from "@/lib/platform/auth/supabase";
import { db } from "@/lib/platform/db/client";
import { connections, organizationMembers } from "@/lib/platform/db/schema";

/**
 * GET /api/auth/callback — Supabase magic-link (and OAuth PKCE) landing route.
 *
 * The magic-link URL arrives as either:
 *   - `?token_hash=...&type=email` (email OTP / magic link), exchanged via
 *     `verifyOtp`, or
 *   - `?code=...` (PKCE / OAuth), exchanged via `exchangeCodeForSession`.
 *
 * After exchanging the token for a session, the user is routed by state:
 *   - new user + `?source=bench` → `/onboarding/migration?source=bench`
 *   - new user                   → `/onboarding/migration`
 *   - returning + org + active connection → `/dashboard`
 *   - returning + org, no connection      → `/onboarding/connect`
 *   - any failure (expired/invalid link, no session) → `/login?error=link_expired`
 *
 * Redirect targets are built on the SAME public origin that served this
 * request (`request.nextUrl.origin`, which Next.js derives from the
 * `x-forwarded-host`/`x-forwarded-proto` headers Vercel sets). This keeps the
 * post-auth redirect on the exact domain the user is browsing — production
 * alias or preview deployment alike. It must NOT be pinned to a fixed
 * `NEXT_PUBLIC_APP_URL`: a cross-domain hop would drop the session cookie
 * (cookies are per-domain) and could land on a stale alias.
 */

const EMAIL_OTP_TYPES = [
  "email",
  "magiclink",
  "signup",
  "invite",
  "recovery",
  "email_change",
] as const;

const TokenTypeSchema = z.enum(EMAIL_OTP_TYPES);

async function resolveTarget(request: NextRequest, origin: string): Promise<string> {
  const requestId = crypto.randomUUID();
  const linkExpired = `${origin}/login?error=link_expired`;

  try {
    const { searchParams } = new URL(request.url);
    const tokenHash = searchParams.get("token_hash");
    const typeParam = searchParams.get("type");
    const code = searchParams.get("code");
    const source = searchParams.get("source");

    const supabase = await createServerClient();

    // 1. Exchange the incoming credential for a session. A magic link carries a
    //    token_hash + type; an OAuth/PKCE flow carries a code. Anything else is
    //    a malformed/expired link.
    if (tokenHash && typeParam) {
      const parsedType = TokenTypeSchema.safeParse(typeParam);
      if (!parsedType.success) {
        return linkExpired;
      }
      const { error } = await supabase.auth.verifyOtp({
        type: parsedType.data,
        token_hash: tokenHash,
      });
      if (error) {
        console.error({ event: "auth_otp_verify_failed", errorMessage: error.message, requestId });
        return linkExpired;
      }
    } else if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        console.error({
          event: "auth_code_exchange_failed",
          errorMessage: error.message,
          requestId,
        });
        return linkExpired;
      }
    } else {
      return linkExpired;
    }

    // 2. Confirm the session resolves to a user (validated against the server).
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return linkExpired;
    }

    // 3. New vs returning: does the user belong to an organization yet?
    const [membership] = await db
      .select({ orgId: organizationMembers.orgId })
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, user.id))
      .limit(1);

    if (!membership) {
      return source === "bench"
        ? `${origin}/onboarding/migration?source=bench`
        : `${origin}/onboarding/migration`;
    }

    // 4. Returning with an org: route by whether a data source is connected.
    //    Org-scoped — the orgId comes from the membership row, not user input.
    const [connection] = await db
      .select({ id: connections.id })
      .from(connections)
      .where(and(eq(connections.orgId, membership.orgId), eq(connections.isActive, true)))
      .limit(1);

    return connection ? `${origin}/dashboard` : `${origin}/onboarding/connect`;
  } catch (error) {
    console.error({
      event: "auth_callback_failed",
      errorMessage: error instanceof Error ? error.message : String(error),
      requestId,
    });
    return `${origin}/login?error=link_expired`;
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Redirect on the same public origin that served this request so the flow
  // never hops domains (which would drop the just-set session cookie). On
  // Vercel, request.nextUrl.origin resolves to the public host via the
  // x-forwarded-* headers — for both the production alias and preview URLs.
  const origin = request.nextUrl.origin;
  const target = await resolveTarget(request, origin);
  return NextResponse.redirect(target);
}
