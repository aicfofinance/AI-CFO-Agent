/**
 * MetricCardSkeleton — animated placeholder matching MetricCard dimensions.
 * Shown while the dashboard summary data is loading.
 */

export function MetricCardSkeleton(): React.JSX.Element {
  return (
    <div
      className="animate-pulse rounded-md border border-gray-200 bg-white p-6 shadow-sm"
      aria-hidden="true"
    >
      {/* Label line */}
      <div className="h-3 w-24 rounded bg-gray-200" />
      {/* Value line */}
      <div className="mt-2 h-8 w-32 rounded bg-gray-200" />
      {/* Change line */}
      <div className="mt-2 h-3 w-20 rounded bg-gray-200" />
    </div>
  );
}
