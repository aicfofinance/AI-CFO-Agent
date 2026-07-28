import { createBrowserClient, createServerClient as createSSRServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";

/**
 * Supabase client factories for the AI CFO platform.
 *
 * Three clients, each with a distinct auth posture:
 *
 * - `createServerClient()` — cookie-bound client for Server Components, Route
 *   Handlers, and Server Actions. The user's auth session flows through the
 *   request via Next.js cookies. This is the client `getRequestContext()`
 *   builds on.
 * - `createClientClient()` — browser client. Persists the session in the
 *   browser and keeps it in sync with the server cookies via `@supabase/ssr`.
 * - `createAdminClient()` — service-role client for privileged, server-only
 *   operations. It BYPASSES Row Level Security, so it must never be imported
 *   into client code, and any user-scoped query made through it must still
 *   carry an explicit `org_id` filter (RLS is not a backstop here).
 *
 * `next/headers` is imported dynamically inside `createServerClient()` rather
 * than at module scope: a static `next/headers` import is server-only and
 * would poison the browser bundle for any client component that imports
 * `createClientClient()` from this module.
 */

export async function createServerClient(): Promise<SupabaseClient> {
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();

  return createSSRServerClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // `setAll` is called from a Server Component, where the cookie store
          // is read-only. Session refresh is handled by middleware instead, so
          // this write can be safely ignored here.
        }
      },
    },
  });
}

export function createClientClient(): SupabaseClient {
  return createBrowserClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
}

export function createAdminClient(): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
