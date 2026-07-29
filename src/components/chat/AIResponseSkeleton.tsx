/**
 * AIResponseSkeleton — loading state for the AI response area.
 *
 * The left border accent (primary-200) renders immediately so the user sees
 * the response container form before content arrives — per FRONTEND_GUIDELINES
 * Section 8.4: "The left border accent renders immediately in primary-200 so
 * the user sees the response container form before content arrives."
 *
 * Uses animate-pulse per FRONTEND_GUIDELINES Section 11.4:
 * "opacity 0.4 → 1 → 0.4 via CSS animation, 1.5s duration"
 */

export function AIResponseSkeleton(): React.JSX.Element {
  return (
    <div
      className="border-l-4 border-l-[#B3D3FF] px-6 py-4"
      aria-label="Analyzing your financial data"
      role="status"
    >
      {/* Status line — editorial, not a chat spinner */}
      <p className="mb-3 text-sm italic text-[#94A3B8]">Analyzing your financial data&hellip;</p>

      {/* Three skeleton lines at 90%, 75%, 55% width */}
      <div className="flex flex-col gap-2 animate-pulse">
        <div className="h-4 w-[90%] rounded bg-gray-200" />
        <div className="h-4 w-[75%] rounded bg-gray-200" />
        <div className="h-4 w-[55%] rounded bg-gray-200" />
      </div>
    </div>
  );
}
