/**
 * CurrencyAmount — the sole way to render a monetary value in the UI.
 *
 * Calls formatCurrency() from src/lib/format.ts for the formatted string.
 * Applies loss-600 (#C42030) text color for negative values.
 * Always uses font-numeric for tabular figure alignment.
 *
 * Per CLAUDE.md: "Financial numbers always render through the shared
 * components: CurrencyAmount, MetricChange, SeverityBadge, FinancialTable.
 * Never format a dollar amount inline."
 */

import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

type CurrencyAmountProps = {
  value: string | number;
  /** Extra Tailwind classes applied to the wrapping span. */
  className?: string;
};

export function CurrencyAmount({ value, className }: CurrencyAmountProps): React.JSX.Element {
  const numericValue = typeof value === "string" ? parseFloat(value) : value;
  const isNegative = Number.isFinite(numericValue) && numericValue < 0;
  const formatted = formatCurrency(value);

  return (
    <span
      className={cn(
        "font-numeric",
        isNegative && "text-[#C42030]", // loss-600 — passes WCAG AA (5.5:1)
        className,
      )}
    >
      {formatted}
    </span>
  );
}
