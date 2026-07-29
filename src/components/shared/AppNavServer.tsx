import { headers } from "next/headers";

import { env } from "@/lib/env";
import { AppNav } from "@/components/shared/AppNav";

/**
 * AppNavServer — Server Component wrapper for AppNav.
 *
 * Fetches the active finding count from the intelligence feed endpoint
 * server-side and passes it as a prop to the client component AppNav.
 * This avoids making AppNav async (which would break its usePathname hook)
 * while still delivering a server-rendered badge count on first paint.
 *
 * Badge count is non-critical display metadata. Any fetch failure (network
 * error, 401, 500) silently defaults to 0 — the user still sees the nav.
 */
export async function AppNavServer(): Promise<React.JSX.Element> {
  let findingCount = 0;

  try {
    const baseUrl = env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const cookie = (await headers()).get("cookie") ?? "";

    const res = await fetch(`${baseUrl}/api/intelligence/feed?limit=1`, {
      headers: { cookie },
      cache: "no-store",
    });

    if (res.ok) {
      const body = (await res.json()) as { meta?: { total?: number } };
      findingCount = body.meta?.total ?? 0;
    }
  } catch {
    // Badge count is non-critical — fail silently, show 0.
  }

  return <AppNav findingCount={findingCount} />;
}
