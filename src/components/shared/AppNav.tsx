"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Zap, TrendingUp, MessageCircle, FileText, Settings } from "lucide-react";
import { AlertBadge } from "@/components/shared/AlertBadge";

type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean }>;
  showAlertBadge?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { label: "Intelligence", href: "/dashboard", icon: Zap, showAlertBadge: true },
  { label: "Cash Flow", href: "/cashflow", icon: TrendingUp },
  { label: "Ask", href: "/ask", icon: MessageCircle },
  { label: "Reports", href: "/reports", icon: FileText },
];

function navItemClass(active: boolean): string {
  const base =
    "flex h-10 items-center gap-3 rounded-md px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500";
  if (active) {
    return `${base} bg-primary-50 text-primary-600 font-medium`;
  }
  return `${base} text-gray-600 hover:bg-gray-100`;
}

type AppNavProps = {
  findingCount?: number;
};

export function AppNav({ findingCount = 0 }: AppNavProps): React.JSX.Element {
  const pathname = usePathname();

  function isActive(href: string): boolean {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  const settingsActive = isActive("/settings");

  return (
    <nav
      className="flex h-screen w-60 shrink-0 flex-col bg-surface-sidebar px-3 py-4"
      aria-label="Main navigation"
    >
      {/* Product name */}
      <div className="mb-6 px-2">
        <span className="text-lg font-semibold text-gray-900">CFO Lens</span>
      </div>

      {/* Primary nav items */}
      <ul className="flex flex-1 flex-col gap-1" role="list">
        {NAV_ITEMS.map(({ label, href, icon: Icon, showAlertBadge }) => {
          const active = isActive(href);
          return (
            <li key={href}>
              <Link
                href={href}
                className={navItemClass(active)}
                aria-current={active ? "page" : undefined}
              >
                <span className="relative shrink-0">
                  <Icon size={18} aria-hidden={true} />
                  {showAlertBadge === true && <AlertBadge count={findingCount} />}
                </span>
                {label}
              </Link>
            </li>
          );
        })}
      </ul>

      {/* Settings — icon only, no text label */}
      <div className="mt-2 border-t border-gray-200 pt-2">
        <Link
          href="/settings"
          className={navItemClass(settingsActive)}
          aria-label="Settings"
          aria-current={settingsActive ? "page" : undefined}
        >
          <Settings size={18} aria-hidden={true} />
        </Link>
      </div>
    </nav>
  );
}
