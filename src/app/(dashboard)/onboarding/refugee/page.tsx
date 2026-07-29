"use client";

/**
 * Bench refugee welcome screen — Step 10.1-ui.
 *
 * Three path cards for users migrating away from Bench:
 *   Card 1: "I have QuickBooks or Xero exports" → /onboarding/csv
 *   Card 2: "I have QBO or Xero access"         → /onboarding/connect
 *   Card 3: "I lost everything"                  → /onboarding/start-fresh
 */

import type React from "react";
import { useRouter } from "next/navigation";
import { FileText, ArrowRightLeft, Sparkles, ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";

export default function RefugeePage(): React.JSX.Element {
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-3xl">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-semibold text-[var(--text-primary)]">
            You've been through this before. Let's make sure it never happens again.
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-[var(--text-secondary)]">
            Your financial data belongs to you — not to us, not to any platform. This product reads
            your books without touching them. You can export everything at any time, and if you ever
            leave, your full ledger is untouched.
          </p>
        </div>

        {/* Path cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {/* ---------------------------------------------------------------- */}
          {/* Card 1 — CSV export path                                         */}
          {/* ---------------------------------------------------------------- */}
          <button
            type="button"
            onClick={() => router.push("/onboarding/csv")}
            className={cn(
              "group flex flex-col items-start rounded-xl border-2 p-6 text-left transition-colors duration-150",
              "border-[var(--border-default)] bg-white hover:border-[var(--primary-500)] hover:bg-[var(--primary-50)]",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary-500)]",
            )}
          >
            {/* Icon */}
            <div className="mb-4 rounded-lg bg-[var(--primary-100)] p-3">
              <FileText size={24} className="text-[var(--primary-800)]" aria-hidden="true" />
            </div>

            {/* Title */}
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">
              I have QuickBooks or Xero exports
            </h2>

            {/* Description */}
            <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
              Upload a CSV export to import your transaction history.
            </p>

            {/* CTA arrow */}
            <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--primary-500)]">
              Upload CSV
              <ArrowRight size={14} aria-hidden="true" />
            </span>
          </button>

          {/* ---------------------------------------------------------------- */}
          {/* Card 2 — Live account access path                                */}
          {/* ---------------------------------------------------------------- */}
          <button
            type="button"
            onClick={() => router.push("/onboarding/connect")}
            className={cn(
              "group flex flex-col items-start rounded-xl border-2 p-6 text-left transition-colors duration-150",
              "border-[var(--border-default)] bg-white hover:border-[var(--primary-500)] hover:bg-[var(--primary-50)]",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary-500)]",
            )}
          >
            {/* Icon */}
            <div className="mb-4 rounded-lg bg-[var(--primary-100)] p-3">
              <ArrowRightLeft size={24} className="text-[var(--primary-800)]" aria-hidden="true" />
            </div>

            {/* Title */}
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">
              I have QBO or Xero access
            </h2>

            {/* Description */}
            <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
              Connect directly for live data and automatic syncing.
            </p>

            {/* CTA arrow */}
            <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--primary-500)]">
              Connect account
              <ArrowRight size={14} aria-hidden="true" />
            </span>
          </button>

          {/* ---------------------------------------------------------------- */}
          {/* Card 3 — Lost everything / start fresh path                      */}
          {/* ---------------------------------------------------------------- */}
          <button
            type="button"
            onClick={() => router.push("/onboarding/start-fresh")}
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
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">I lost everything</h2>

            {/* Description */}
            <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
              Start from scratch and build your financial records going forward.
            </p>

            {/* CTA arrow */}
            <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--primary-500)]">
              Start fresh
              <ArrowRight size={14} aria-hidden="true" />
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
