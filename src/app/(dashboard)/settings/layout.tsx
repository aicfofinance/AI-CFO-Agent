"use client";

/**
 * Settings section layout — provides the left sidebar nav shared by all
 * /settings/* sub-pages.  The whole file is "use client" because the nav
 * component uses usePathname() to determine the active link.
 */

import type { ReactElement, ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Nav link definitions
// ---------------------------------------------------------------------------

const SETTINGS_NAV = [
  { label: "Connections", href: "/settings/connections" },
  { label: "Account", href: "/settings/account" },
  { label: "Notifications", href: "/settings/notifications" },
  { label: "Billing", href: "/settings/billing" },
] as const;

// ---------------------------------------------------------------------------
// SettingsNav — sidebar navigation; uses usePathname to highlight active link
// ---------------------------------------------------------------------------

function SettingsNav(): ReactElement {
  const pathname = usePathname();

  return (
    <nav className="flex w-[200px] shrink-0 flex-col gap-1" aria-label="Settings navigation">
      {SETTINGS_NAV.map(({ label, href }) => {
        const isActive = pathname.startsWith(href);

        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "rounded-md px-3 py-2 text-sm",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary-500)]",
              isActive
                ? "bg-[var(--primary-50)] font-medium text-[var(--primary-600)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--gray-100)]",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

type SettingsLayoutProps = {
  children: ReactNode;
};

export default function SettingsLayout({ children }: SettingsLayoutProps): ReactElement {
  return (
    <div className="flex gap-8">
      <SettingsNav />
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
