import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";

/**
 * Next.js edge middleware: route protection + Supabase session refresh.
 *
 * On every matched request it builds a request/response-bound Supabase client
 * and calls `getUser()`. `getUser()` (not `getSession()`) is used deliberately:
 * it revalidates the token against the Supabase auth server rather than trusting
 * the cookie, which is the supported way to gate auth in middleware. The call
 * also refreshes the session cookie, written back onto the response.
 *
 * Redirect rules:
 *   - Unauthenticated request to a `(dashboard)` route → `/login?next=[path]`.
 *   - Authenticated request to `/login` or `/register`  → `/dashboard`.
 *
 * The middleware never reads or trusts an `org_id`; org scoping is enforced in
 * the API layer via `getRequestContext()`. This layer only checks presence of a
 * session.
 */

/**
 * Path prefixes that make up the `(dashboard)` route group. Every one requires
 * an authenticated session (including `/onboarding`, which a session-holding
 * user without an org must still reach). A path matches if it equals the prefix
 * or is nested beneath it.
 */
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/cashflow",
  "/ask",
  "/conversations",
  "/alerts",
  "/reports",
  "/settings",
  "/onboarding",
] as const;

/**
 * Public auth pages that an already-authenticated user should be bounced away
 * from (into the dashboard).
 */
const AUTH_PAGES = ["/login", "/register"] as const;

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function isAuthPage(pathname: string): boolean {
  return (AUTH_PAGES as readonly string[]).includes(pathname);
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  // `response` is reassigned by `setAll` when Supabase rotates the session
  // cookie, so refreshed cookies ride back to the browser on the response.
  let response = NextResponse.next({ request });

  const supabase = createServerClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Unauthenticated → protected route: send to login, preserving the intended
  // destination in `next` so the app can return the user there post-login.
  if (!user && isProtectedPath(pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Authenticated → an auth page: no reason to log in again, go to dashboard.
  if (user && isAuthPage(pathname)) {
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = "/dashboard";
    dashboardUrl.search = "";
    return NextResponse.redirect(dashboardUrl);
  }

  return response;
}

/**
 * Match all paths except Next.js internals and static asset files. API routes
 * are intentionally included so their session cookies are refreshed too; the
 * redirect rules above only ever fire on page paths.
 */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
