/**
 * IntelligenceFeedBaseline — rendered when the API returns 422 (fewer than
 * 60 days of transaction history available).
 *
 * Server Component — no state needed, no "use client".
 */

import Link from "next/link";

type IntelligenceFeedBaselineProps = {
  daysAvailable: number;
};

export function IntelligenceFeedBaseline({
  daysAvailable,
}: IntelligenceFeedBaselineProps): React.JSX.Element {
  // Dynamic percentage — cannot be a static Tailwind class; inline style is the
  // sole acceptable exception per CLAUDE.md Component Rules.
  const pct = Math.min(Math.round((daysAvailable / 60) * 100), 100);

  return (
    <div className="bg-[var(--surface-card)] border border-[var(--border-default)] rounded-lg p-8">
      <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">
        Building your baseline
      </h2>

      <p className="text-sm text-[var(--text-secondary)] mb-6">
        CFO Lens needs 60 days of transaction data to detect patterns. You have {daysAvailable}{" "}
        {daysAvailable === 1 ? "day" : "days"} so far.
      </p>

      {/* Progress bar */}
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-[var(--gray-200)] mb-2"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${daysAvailable} of 60 days of transaction data collected`}
      >
        <div
          className="h-full bg-[var(--primary-500)] rounded-full transition-[width]"
          style={{ width: `${pct}%` }}
        />
      </div>

      <p className="font-numeric text-xs text-[var(--text-muted)] mb-8">
        {daysAvailable} / 60 days
      </p>

      <p className="text-sm font-medium text-[var(--text-secondary)] mb-3">
        While you wait, you can still:
      </p>

      <ul className="space-y-2">
        <li>
          <Link href="/ask" className="text-sm text-[var(--text-link)] hover:underline">
            → Ask about your current transactions
          </Link>
        </li>
        <li>
          <Link
            href="/ask?q=show+me+my+chart+of+accounts"
            className="text-sm text-[var(--text-link)] hover:underline"
          >
            → View your chart of accounts
          </Link>
        </li>
        <li>
          <Link
            href="/ask?q=show+me+spending+by+category"
            className="text-sm text-[var(--text-link)] hover:underline"
          >
            → Check recent spending by category
          </Link>
        </li>
      </ul>
    </div>
  );
}
