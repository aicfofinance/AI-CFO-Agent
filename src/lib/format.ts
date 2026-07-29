/**
 * Formatting utilities — the single source of truth for turning stored data
 * (monetary strings, decimal percentages, dates) into display text.
 *
 * Per CLAUDE.md: formatCurrency() is the ONLY place monetary strings become
 * display text. Never write `$${amount}` or `${amount.toFixed(2)}` inline.
 *
 * These are pure functions. No DB calls, no API calls.
 */

// Unicode minus sign (U+2212) — used for negatives instead of the ASCII
// hyphen-minus that Intl produces, and never parentheses.
const UNICODE_MINUS = "−";

export type FormatCurrencyOptions = {
  currency?: string;
  showCents?: boolean;
  compact?: boolean;
};

/**
 * Format a monetary value for display.
 *
 * Negative values render with a Unicode minus prefix (−$1,234.56), never
 * parentheses. The caller is responsible for applying the `loss-600` color
 * to the returned string in the UI.
 */
export function formatCurrency(value: string | number, options?: FormatCurrencyOptions): string {
  const currency = options?.currency ?? "USD";
  const showCents = options?.showCents ?? true;
  const compact = options?.compact ?? false;

  const parsed = parseFloat(String(value));
  const numeric = Number.isFinite(parsed) ? parsed : 0;

  const fractionDigits = showCents ? 2 : 0;

  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
    ...(compact ? { notation: "compact", compactDisplay: "short" } : {}),
  });

  const formatted = formatter.format(numeric);

  // Replace the ASCII hyphen-minus prefix Intl emits with the Unicode minus.
  if (formatted.startsWith("-")) {
    return `${UNICODE_MINUS}${formatted.slice(1)}`;
  }

  return formatted;
}

export type FormatPercentOptions = {
  decimals?: number;
};

/**
 * Format a percentage for display.
 *
 * Stored decimals (e.g. 0.2000 = 20%) are converted to percentage points.
 * Values greater than 1 are assumed to already be in percentage points
 * (e.g. 50.25 → "50.25%").
 */
export function formatPercent(value: string | number, options?: FormatPercentOptions): string {
  const decimals = options?.decimals ?? 2;

  const parsed = parseFloat(String(value));
  const numeric = Number.isFinite(parsed) ? parsed : 0;

  const points = Math.abs(numeric) > 1 ? numeric : numeric * 100;

  return `${points.toFixed(decimals)}%`;
}

export type FormatDateOptions = {
  format?: "short" | "long" | "month-year";
};

/**
 * Format a date for display. Accepts an ISO date string ('YYYY-MM-DD') or a
 * Date object.
 *
 * Dates are formatted in UTC so that a stored 'YYYY-MM-DD' calendar date is
 * never shifted by the viewer's local timezone offset.
 */
export function formatDate(value: string | Date, options?: FormatDateOptions): string {
  const format = options?.format ?? "short";

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const config: Intl.DateTimeFormatOptions =
    format === "long"
      ? { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }
      : format === "month-year"
        ? { year: "numeric", month: "long", timeZone: "UTC" }
        : { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" };

  return new Intl.DateTimeFormat("en-US", config).format(date);
}
