import type { ReactNode } from "react";
import { headers } from "next/headers";

import { env } from "@/lib/env";
import { AppNavServer } from "@/components/shared/AppNavServer";
import type { ConnectionSummary } from "@/types/api";

type DashboardLayoutProps = {
  children: ReactNode;
};

export default async function DashboardLayout({
  children,
}: DashboardLayoutProps): Promise<React.JSX.Element> {
  let authExpired = false;

  try {
    const requestHeaders = await headers();
    const cookie = requestHeaders.get("cookie") ?? "";
    const host = requestHeaders.get("host");
    const proto = requestHeaders.get("x-forwarded-proto") ?? "https";
    const baseUrl = host
      ? `${proto}://${host}`
      : (env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000");

    const connectionsRes = await fetch(`${baseUrl}/api/connections`, {
      headers: { cookie },
      cache: "no-store",
    });

    if (connectionsRes.ok) {
      const json = (await connectionsRes.json()) as { data?: ConnectionSummary[] };
      authExpired = json.data?.some((c) => c.syncStatus === "auth_expired") ?? false;
    }
  } catch {
    // Non-critical display state — fail silently, banner stays hidden
  }

  return (
    <div className="flex">
      <AppNavServer />
      <div className="flex-1 flex flex-col">
        {authExpired && (
          <div
            role="alert"
            className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between gap-4 bg-[var(--warning-500)] px-4 py-2.5 text-sm font-medium text-white"
          >
            <span>QuickBooks connection expired. Reconnect to keep your data current.</span>
            <a
              href="/settings/connections"
              className="rounded border border-white px-3 py-1 text-xs font-semibold text-white hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              Reconnect →
            </a>
          </div>
        )}
        <main className="flex-1 min-h-screen bg-surface-page p-8">{children}</main>
      </div>
    </div>
  );
}
