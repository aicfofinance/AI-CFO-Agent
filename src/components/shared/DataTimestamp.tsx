"use client";

/**
 * DataTimestamp — shows when data was last updated.
 *
 * Turns amber (warning-600) when the date is more than 12 hours ago,
 * signalling that the data may be stale and a sync is overdue.
 *
 * Uses "use client" because it reads the current time to compare.
 */

import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

type DataTimestampProps = {
  date: string | Date;
  /** Prefix label. Defaults to "Last updated". */
  label?: string;
  /** Extra Tailwind classes. */
  className?: string;
};

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

export function DataTimestamp({
  date,
  label = "Last updated",
  className,
}: DataTimestampProps): React.JSX.Element {
  const dateObj = date instanceof Date ? date : new Date(date);
  const isStale = Date.now() - dateObj.getTime() > TWELVE_HOURS_MS;

  return (
    <span
      className={cn(
        "text-xs",
        // warning-600 (#B45309) when stale — 5.9:1 contrast, passes AA
        // text-muted (#94A3B8) when fresh — supplementary, non-critical text
        isStale ? "text-[#B45309]" : "text-[#94A3B8]",
        className,
      )}
    >
      {label} {formatDate(date)}
    </span>
  );
}
