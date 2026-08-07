"use client";

/**
 * Settings > Billing page.
 *
 * Fetches GET /api/auth/me to read the org's plan tier, queries used, and
 * queries limit. Renders a "Current plan" card with a usage progress bar and
 * a "Need more?" upgrade section with a disabled "Contact sales" button
 * (Stripe is not wired in V1).
 *
 * "use client" is required because the plan data is fetched on mount to avoid
 * a server-side session cookie forwarding round-trip from a nested layout.
 */

import type { ReactElement } from "react";
import { useState, useEffect } from "react";

import { cn } from "@/lib/utils";
import type { AuthMeResponse } from "@/types/api";

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function BillingPage(): ReactElement {
  const [userInfo, setUserInfo] = useState<AuthMeResponse | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => {
        if (!res.ok) return null;
        return res.json() as Promise<{ data: AuthMeResponse }>;
      })
      .then((json) => {
        if (json !== null) setUserInfo(json.data);
      })
      .catch(() => {
        // silently ignored — billing info is supplementary display; the page
        // renders the skeleton/placeholder state until data arrives
      });
  }, []);

  // Derived values — safe against null userInfo
  const queriesUsed = userInfo?.queriesUsed ?? 0;
  const queriesLimit = userInfo?.queriesLimit ?? 0;
  const queriesRemaining = Math.max(queriesLimit - queriesUsed, 0);

  // Dynamic percentage — cannot be a static Tailwind class; inline style is
  // the sole acceptable exception per CLAUDE.md Component Rules (see also
  // src/components/dashboard/IntelligenceFeedBaseline.tsx for the pattern).
  const fillPct =
    queriesLimit > 0 ? Math.min(Math.round((queriesUsed / queriesLimit) * 100), 100) : 0;

  // Capitalize first letter of plan tier for display (e.g. "free" → "Free")
  const planLabel =
    userInfo !== null && userInfo.planTier.length > 0
      ? userInfo.planTier.charAt(0).toUpperCase() + userInfo.planTier.slice(1)
      : null;

  return (
    <div className="flex flex-col gap-8">
      {/* ------------------------------------------------------------------ */}
      {/* Page header                                                         */}
      {/* ------------------------------------------------------------------ */}
      <div className="border-b border-[var(--border-default)] pb-6">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Billing</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Manage your subscription and usage.
        </p>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Current plan card                                                   */}
      {/* ------------------------------------------------------------------ */}
      <section aria-labelledby="billing-plan-heading">
        <div className="rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] p-6 shadow-sm">
          {/* Header: section title + plan tier badge */}
          <div className="flex items-center gap-3">
            <h2
              id="billing-plan-heading"
              className="text-base font-semibold text-[var(--text-primary)]"
            >
              Current plan
            </h2>

            {planLabel !== null ? (
              <span className="rounded-full bg-[var(--primary-100)] px-2.5 py-0.5 text-xs font-medium text-[var(--primary-700)]">
                {planLabel}
              </span>
            ) : (
              /* Skeleton badge while loading */
              <div
                className="h-5 w-12 animate-pulse rounded-full bg-[var(--gray-200)]"
                aria-hidden="true"
              />
            )}
          </div>

          {/* Query usage section */}
          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-sm text-[var(--text-secondary)]">Query usage this month</span>

              {userInfo !== null ? (
                <span className="font-numeric text-sm text-[var(--text-secondary)]">
                  {queriesRemaining} remaining
                </span>
              ) : (
                <div
                  className="h-4 w-20 animate-pulse rounded bg-[var(--gray-200)]"
                  aria-hidden="true"
                />
              )}
            </div>

            {/* Progress bar track */}
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-[var(--gray-200)]"
              role="progressbar"
              aria-valuenow={fillPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${queriesUsed} of ${queriesLimit} queries used this month`}
            >
              {/* Progress bar fill — dynamic width requires inline style */}
              <div
                className="h-full rounded-full bg-[var(--primary-500)] transition-[width] duration-200"
                style={{ width: `${fillPct}%` }}
              />
            </div>

            {/* Usage text below bar */}
            {userInfo !== null ? (
              <p className="font-numeric mt-2 text-sm text-[var(--text-muted)]">
                {queriesUsed} of {queriesLimit} queries used this month
              </p>
            ) : (
              <div
                className="mt-2 h-4 w-44 animate-pulse rounded bg-[var(--gray-200)]"
                aria-hidden="true"
              />
            )}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Upgrade plan card                                                   */}
      {/* ------------------------------------------------------------------ */}
      <section aria-labelledby="billing-upgrade-heading">
        <div className="rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] p-6 shadow-sm">
          <h2
            id="billing-upgrade-heading"
            className="text-base font-semibold text-[var(--text-primary)]"
          >
            Need more?
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-[var(--text-secondary)]">
            Upgrade to Pro for unlimited queries and priority support.
          </p>

          <div className="mt-4">
            <button
              type="button"
              disabled
              aria-disabled="true"
              title="Contact us to upgrade your plan"
              className={cn(
                "rounded px-4 py-2 text-sm font-medium",
                "bg-[var(--primary-500)] text-white",
                "cursor-not-allowed opacity-50",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary-500)]",
              )}
            >
              Contact sales
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
