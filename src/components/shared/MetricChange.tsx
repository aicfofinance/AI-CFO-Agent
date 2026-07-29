/**
 * MetricChange — renders a percentage change with direction symbol and color.
 *
 * Color is NEVER the sole indicator:
 *   - Positive: ▲ symbol + gain-600 text + sr-only description
 *   - Negative: ▼ symbol + loss-600 text + sr-only description
 *   - Zero:     → symbol + neutral text + sr-only description
 *
 * Per CLAUDE.md: "gain-500 / loss-500 are never used for text — minimum
 * gain-600 / loss-600."
 */

import { cn } from "@/lib/utils";

type MetricChangeProps = {
  /** The percentage change as a plain number, e.g. 12.3 means +12.3%. */
  value: number;
  /** Extra Tailwind classes applied to the wrapping span. */
  className?: string;
};

export function MetricChange({ value, className }: MetricChangeProps): React.JSX.Element {
  let symbol: string;
  let colorClass: string;
  let formattedValue: string;
  let srText: string;

  if (value > 0) {
    symbol = "▲";
    colorClass = "text-[#15803D]"; // gain-600 — 4.6:1 contrast, passes AA
    formattedValue = `+${value.toFixed(1)}%`;
    srText = `up ${value.toFixed(1)}% from prior period`;
  } else if (value < 0) {
    symbol = "▼";
    colorClass = "text-[#C42030]"; // loss-600 — 5.5:1 contrast, passes AA
    // Unicode minus (U+2212) — never ASCII hyphen for negative currency/percent
    formattedValue = `−${Math.abs(value).toFixed(1)}%`;
    srText = `down ${Math.abs(value).toFixed(1)}% from prior period`;
  } else {
    symbol = "→";
    colorClass = "text-[#64748B]"; // neutral-change (gray-500)
    formattedValue = "0.0%";
    srText = "unchanged from prior period";
  }

  return (
    <span
      className={cn("inline-flex items-center gap-0.5 text-sm font-numeric", colorClass, className)}
    >
      <span aria-hidden="true">{symbol}</span>
      <span>{formattedValue}</span>
      <span className="sr-only">{srText}</span>
    </span>
  );
}
