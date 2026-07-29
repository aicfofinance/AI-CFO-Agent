import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
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
 * "New" vs "returning" is decided by whether the user has an
 * `organization_members` row. The connection check is org-scoped
 * (`org_id = membership.orgId`), sourced only from the exchanged session — never
 * from a query param.
 *
 * `redirect()` throws the framework `NEXT_REDIRECT` control-flow signal, so it
 * is called exactly once at the top level, outside the try/catch in
 * `resolveTarget`. Wrapping it in the catch would swallow the redirect. All
 * fallible work (token exchange, DB lookups) happens inside `resolveTarget`,
 * which degrades every failure to the `link_expired` login redirect.
 */

const LINK_EXPIRED = "/login?error=link_expired";

/**
 * The Supabase `EmailOtpType` values accepted on the callback. Declared as a
 * `const` tuple (enums are forbidden by CLAUDE.md) and validated with Zod
 * because `type` is untrusted query-param input.
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

async function resolveTarget(request: NextRequest): Promise<string> {
  const requestId = crypto.randomUUID();

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
        return LINK_EXPIRED;
      }
      const { error } = await supabase.auth.verifyOtp({
        type: parsedType.data,
        token_hash: tokenHash,
      });
      if (error) {
        return LINK_EXPIRED;
      }
    } else if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        return LINK_EXPIRED;
      }
    } else {
      return LINK_EXPIRED;
    }

    // 2. Confirm the session resolves to a user (validated against the server).
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return LINK_EXPIRED;
    }

    // 3. New vs returning: does the user belong to an organization yet?
    const [membership] = await db
      .select({ orgId: organizationMembers.orgId })
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, user.id))
      .limit(1);

    if (!membership) {
      return source === "bench" ? "/onboarding/migration?source=bench" : "/onboarding/migration";
    }

    // 4. Returning with an org: route by whether a data source is connected.
    //    Org-scoped — the orgId comes from the membership row, not user input.
    const [connection] = await db
      .select({ id: connections.id })
      .from(connections)
      .where(and(eq(connections.orgId, membership.orgId), eq(connections.isActive, true)))
      .limit(1);

    return connection ? "/dashboard" : "/onboarding/connect";
  } catch (error) {
    console.error({
      event: "auth_callback_failed",
      errorMessage: error instanceof Error ? error.message : String(error),
      requestId,
    });
    return LINK_EXPIRED;
  }
}

export async function GET(request: NextRequest): Promise<never> {
  const target = await resolveTarget(request);
  redirect(target);
}
