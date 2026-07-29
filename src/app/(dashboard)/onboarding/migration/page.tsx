"use client";

/**
 * Migration check screen — Step 10.0.
 *
 * Two path cards:
 *   Card 1: "Migrating from Bench or another service" → /onboarding/refugee
 *   Card 2: "Starting fresh" → /onboarding/org
 *
 * When ?source=bench is present, Card 1 is highlighted with a
 * "Recommended for you" badge and primary border/background.
 *
 * useSearchParams() requires a Suspense boundary per Next.js 15 App Router.
 */

import { Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ArrowRightLeft, Sparkles, ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Inner content — reads search params, must be inside <Suspense>
// ---------------------------------------------------------------------------

function MigrationContent(): React.JSX.Element {
  const searchParams = useSearchParams();
  const router = useRouter();

  const isBenchSource = searchParams.get("source") === "bench";

  function handleMigrationClick(): void {
    router.push("/onboarding/refugee");
  }

  function handleFreshClick(): void {
    router.push("/onboarding/org");
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-semibold text-[var(--text-primary)]">
            How would you like to get started?
          </h1>
          <p className="mt-2 text-[var(--text-secondary)]">
            Choose the path that best describes your situation.
          </p>
        </div>

        {/* Path cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* ---------------------------------------------------------------- */}
          {/* Card 1 — Migration path                                          */}
          {/* ---------------------------------------------------------------- */}
          <button
            type="button"
            onClick={handleMigrationClick}
            className={cn(
              "group flex flex-col items-start rounded-xl border-2 p-6 text-left transition-colors duration-150",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary-500)]",
              isBenchSource
                ? "border-[var(--primary-500)] bg-[var(--primary-50)]"
                : "border-[var(--border-default)] bg-white hover:border-[var(--primary-500)] hover:bg-[var(--primary-50)]",
            )}
          >
            {/* Recommended badge — visible only when source=bench */}
            {isBenchSource && (
              <span className="mb-3 inline-flex items-center rounded-full bg-[var(--primary-500)] px-2.5 py-0.5 text-xs font-medium text-white">
                Recommended for you
              </span>
            )}

            {/* Icon */}
            <div className="mb-4 rounded-lg bg-[var(--primary-100)] p-3">
              <ArrowRightLeft size={24} className="text-[var(--primary-800)]" aria-hidden="true" />
            </div>

            {/* Title */}
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">
              Migrating from Bench or another service
            </h2>

            {/* Description */}
            <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
              Import your historical financial data via CSV and pick up where you left off.
            </p>

            {/* CTA arrow */}
            <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--primary-500)]">
              Get started
              <ArrowRight size={14} aria-hidden="true" />
            </span>
          </button>

          {/* ---------------------------------------------------------------- */}
          {/* Card 2 — Fresh start path                                        */}
          {/* ---------------------------------------------------------------- */}
          <button
            type="button"
            onClick={handleFreshClick}
            className={cn(
              "group flex flex-col items-start rounded-xl border-2 p-6 text-left transition-colors duration-150",
              "border-[var(--border-default)] bg-white hover:border-[var(--primary-500)] hover:bg-[var(--primary-50)]",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary-500)]",
            )}
          >
            {/* Icon */}
            <div className="mb-4 rounded-lg bg-[var(--primary-100)] p-3">
              <Sparkles size={24} className="text-[var(--primary-800)]" aria-hidden="true" />
            </div>

            {/* Title */}
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">Starting fresh</h2>

            {/* Description */}
            <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
              Connect your QuickBooks or Xero account and let CFO Lens get to work on your data.
            </p>

            {/* CTA arrow */}
            <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--primary-500)]">
              Get started
              <ArrowRight size={14} aria-hidden="true" />
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton — shown while search params are resolving
// ---------------------------------------------------------------------------

function MigrationSkeleton(): React.JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-2xl">
        <div className="mb-8 text-center">
          <div className="mx-auto h-9 w-80 animate-pulse rounded bg-[var(--border-default)]" />
          <div className="mx-auto mt-2 h-5 w-56 animate-pulse rounded bg-[var(--border-default)]" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="h-52 animate-pulse rounded-xl border-2 border-[var(--border-default)] bg-white" />
          <div className="h-52 animate-pulse rounded-xl border-2 border-[var(--border-default)] bg-white" />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page — wraps MigrationContent in Suspense as required by Next.js 15
// ---------------------------------------------------------------------------

export default function MigrationPage(): React.JSX.Element {
  return (
    <Suspense fallback={<MigrationSkeleton />}>
      <MigrationContent />
    </Suspense>
  );
}
