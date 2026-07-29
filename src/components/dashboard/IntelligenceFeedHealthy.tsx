/**
 * IntelligenceFeedHealthy — rendered when findings.length === 0 and the org
 * has 60+ days of transaction history.
 *
 * Server Component — no state needed, no "use client".
 */

import Link from "next/link";

import { Button } from "@/components/ui/button";

type IntelligenceFeedHealthyProps = {
  /** Optional ISO string for when the next scan is scheduled. Defaults to "tomorrow at 6:00 AM". */
  nextScanTime?: string;
};

const CHECKED_ITEMS = [
  "Cash flow projection (30-day forward look)",
  "Expense spike detection",
  "Collections slippage",
  "Gross margin vs prior year",
  "Overdue AR aging",
  "Duplicate subscription scan",
] as const;

function formatNextScan(isoString?: string): string {
  if (!isoString) return "tomorrow at 6:00 AM";
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return "tomorrow at 6:00 AM";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function IntelligenceFeedHealthy({
  nextScanTime,
}: IntelligenceFeedHealthyProps): React.JSX.Element {
  const nextScanDisplay = formatNextScan(nextScanTime);

  return (
    <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-lg p-8">
      <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-6">
        All clear — no urgent findings
      </h2>

      <p className="text-sm font-medium text-[var(--text-secondary)] mb-3">
        What CFO Lens checked this morning:
      </p>

      <ul className="space-y-2" aria-label="Intelligence checks completed">
        {CHECKED_ITEMS.map((item) => (
          <li key={item} className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            {/* gain-600 (#15803D) — 4.6:1 contrast, passes AA */}
            <span className="text-[#15803D]" aria-hidden="true">
              ✓
            </span>
            {item}
          </li>
        ))}
      </ul>

      <p className="text-sm text-[var(--text-muted)] mt-6">Next scan: {nextScanDisplay}</p>

      <div className="mt-6">
        <Link href="/ask">
          <Button variant="outline">Ask a question →</Button>
        </Link>
      </div>
    </div>
  );
}
