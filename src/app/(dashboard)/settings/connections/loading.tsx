/**
 * Loading skeleton for /settings/connections.
 * Matches the layout of the page: header, sovereignty badge, two provider cards.
 */

function ConnectionCardSkeleton(): React.JSX.Element {
  return (
    <div
      className="rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] p-6"
      aria-hidden="true"
    >
      {/* Header row: logo + name + status badge */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 shrink-0 animate-pulse rounded bg-[var(--gray-200)]" />
          <div>
            <div className="h-4 w-28 animate-pulse rounded bg-[var(--gray-200)]" />
            <div className="mt-1 h-3 w-20 animate-pulse rounded bg-[var(--gray-200)]" />
          </div>
        </div>
        <div className="h-5 w-24 animate-pulse rounded-full bg-[var(--gray-200)]" />
      </div>

      {/* Metadata rows */}
      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <div className="h-3 w-16 animate-pulse rounded bg-[var(--gray-200)]" />
          <div className="mt-1 h-4 w-24 animate-pulse rounded bg-[var(--gray-200)]" />
        </div>
        <div>
          <div className="h-3 w-28 animate-pulse rounded bg-[var(--gray-200)]" />
          <div className="mt-1 h-4 w-20 animate-pulse rounded bg-[var(--gray-200)]" />
        </div>
      </div>

      {/* Action row */}
      <div className="mt-5 border-t border-[var(--border-subtle)] pt-4">
        <div className="h-7 w-24 animate-pulse rounded bg-[var(--gray-200)]" />
      </div>
    </div>
  );
}

export default function Loading(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      {/* Page header skeleton */}
      <div className="border-b border-[var(--border-default)] pb-6">
        <div className="h-8 w-36 animate-pulse rounded bg-[var(--gray-200)]" />
        <div className="mt-1 h-4 w-64 animate-pulse rounded bg-[var(--gray-200)]" />
      </div>

      {/* Sovereignty badge skeleton */}
      <div className="h-9 animate-pulse rounded border border-[var(--primary-200)] bg-[var(--primary-50)]" />

      {/* Two provider card skeletons */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ConnectionCardSkeleton />
        <ConnectionCardSkeleton />
      </div>
    </div>
  );
}
