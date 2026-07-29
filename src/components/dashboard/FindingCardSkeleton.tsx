/**
 * FindingCardSkeleton — animated placeholder matching FindingCard dimensions.
 * Shown while the intelligence feed is loading.
 */

export function FindingCardSkeleton(): React.JSX.Element {
  return (
    <div
      className="animate-pulse rounded-md border border-gray-200 bg-white px-4 py-3"
      aria-hidden="true"
    >
      {/* Header row: severity badge placeholder + dismiss button placeholder */}
      <div className="flex items-start justify-between">
        <div className="h-5 w-16 rounded-full bg-gray-200" />
        <div className="h-5 w-5 rounded bg-gray-200" />
      </div>

      {/* Headline placeholder — full width */}
      <div className="mt-2 h-5 w-full rounded bg-gray-200" />

      {/* Detail lines: 85% and 70% width */}
      <div className="mt-1 h-4 w-[85%] rounded bg-gray-200" />
      <div className="mt-1 h-4 w-[70%] rounded bg-gray-200" />

      {/* Metadata timestamp placeholder */}
      <div className="mt-2 h-3 w-24 rounded bg-gray-200" />

      {/* CTA row: primary action + tell me more */}
      <div className="mt-3 flex items-center gap-4">
        <div className="h-7 w-24 rounded bg-gray-200" />
        <div className="h-7 w-20 rounded bg-gray-200" />
      </div>
    </div>
  );
}
