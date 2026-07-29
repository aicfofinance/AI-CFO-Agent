"use client";

/**
 * DaysTabBar — client component rendering 30d/60d/90d projection period tabs.
 *
 * Uses `useSearchParams()` to read the current active period and renders Next.js
 * `<Link>` elements that update the `?days=` search param. The parent server
 * component must wrap this in `<Suspense>` to prevent de-opting the route to
 * full client-side rendering.
 */

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const VIEW_OPTIONS = ["30", "60", "90"] as const;
type ViewOption = (typeof VIEW_OPTIONS)[number];

export function DaysTabBar(): React.JSX.Element {
  const pathname = usePathname();
  const sp = useSearchParams();
  const currentDays = sp.get("days") ?? "30";

  return (
    <div
      className="flex gap-1 rounded-lg bg-[#F1F5F9] p-1"
      role="tablist"
      aria-label="Projection period"
    >
      {VIEW_OPTIONS.map((d: ViewOption) => (
        <Link
          key={d}
          href={`${pathname}?days=${d}`}
          role="tab"
          aria-selected={currentDays === d}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-500)] focus-visible:ring-offset-1 ${
            currentDays === d
              ? "bg-white text-[#1E3A8A] shadow-sm"
              : "text-[#64748B] hover:text-[#334155]"
          }`}
        >
          {d}d
        </Link>
      ))}
    </div>
  );
}
