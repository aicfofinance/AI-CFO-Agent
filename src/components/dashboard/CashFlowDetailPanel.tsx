"use client";

/**
 * CashFlowDetailPanel — inline panel that expands below the cash flow chart
 * when the user clicks a risk date marker.
 *
 * Shows the selected day's projected inflows, outflows, and end-of-day balance.
 * Always renders the "Accelerate these invoices" button as disabled — it is
 * wired up in Phase 9 (Step 9.7).
 *
 * Per CLAUDE.md: all monetary values render through CurrencyAmount; no inline
 * style props; parseFloat only acceptable for display comparisons (not arithmetic).
 */

import React from "react";

import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Types — match the DailyBalance shape from CashFlowChart / GET /api/cashflow/projection
// ---------------------------------------------------------------------------

type DailyBalance = {
  date: string; // ISO date string 'YYYY-MM-DD'
  projectedBalance: string; // DECIMAL string — running balance at end of day
  inflows: string; // DECIMAL string — expected to arrive this day
  outflows: string; // DECIMAL string — expected outgoing this day (stored positive)
};

type CashFlowDetailPanelProps = {
  /** ISO date string of the selected risk date (e.g. "2026-08-15") */
  selectedDate: string;
  /** Full projection array — panel finds the matching day's data */
  dailyBalances: DailyBalance[];
  /** Called when the user clicks the close (×) button */
  onClose: () => void;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CashFlowDetailPanel({
  selectedDate,
  dailyBalances,
  onClose,
}: CashFlowDetailPanelProps): React.JSX.Element | null {
  const dayData = dailyBalances.find((d) => d.date === selectedDate);

  // Guard: if the date is not in the projection array, render nothing
  if (!dayData) return null;

  // Format "2026-08-15" → "August 15, 2026"
  // Append T00:00:00 so the Date constructor parses in local time, not UTC
  const formattedDate = new Date(selectedDate + "T00:00:00").toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  // Determine whether the projected balance is negative for the warning
  // parseFloat here is for comparison only — no monetary arithmetic is performed
  const isNegativeBalance =
    Number.isFinite(parseFloat(dayData.projectedBalance)) &&
    parseFloat(dayData.projectedBalance) < 0;

  // Outflows are stored as positive strings (e.g. "18500.00"); prepend "-" so
  // CurrencyAmount renders them with loss-600 color and Unicode minus sign.
  // This is string manipulation for display, not monetary arithmetic.
  const outflowDisplay =
    parseFloat(dayData.outflows) > 0 ? `-${dayData.outflows}` : dayData.outflows;

  return (
    <div className="mt-4 rounded-lg border border-[var(--border-default)] border-l-4 border-l-[#C42030] bg-[var(--surface-card)] p-6">
      {/* Header row */}
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-base font-semibold text-[var(--text-primary)]">
          <time dateTime={selectedDate}>{formattedDate}</time>
          {" — Projected shortfall"}
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="text-xl leading-none text-[var(--text-muted)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-500)] focus-visible:rounded"
          aria-label="Close detail panel"
        >
          {"×"}
        </button>
      </div>

      {/* Daily figures */}
      <dl className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-[var(--text-secondary)]">Expected inflows</dt>
          <dd>
            <CurrencyAmount value={dayData.inflows} className="font-numeric" />
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-[var(--text-secondary)]">Expected outflows</dt>
          <dd>
            <CurrencyAmount value={outflowDisplay} className="font-numeric" />
          </dd>
        </div>
        <div className="flex items-center justify-between border-t border-[var(--border-subtle)] pt-2">
          <dt className="font-medium text-[var(--text-primary)]">End-of-day balance</dt>
          <dd>
            <CurrencyAmount
              value={dayData.projectedBalance}
              className="font-numeric font-semibold"
            />
          </dd>
        </div>
      </dl>

      {/* Warning — only shown when balance is negative */}
      {isNegativeBalance && (
        <p className="mt-4 flex items-center gap-2 text-sm font-medium text-[#C42030]">
          <span aria-hidden="true">&#9888;</span>
          <span>This day has a projected negative balance.</span>
        </p>
      )}

      {/* CTA — disabled until Phase 9 (Step 9.7) wires the agentic flow */}
      <div className="mt-4">
        <Button disabled={true} title="Available in a future update" variant="outline" size="sm">
          Accelerate these invoices
        </Button>
      </div>
    </div>
  );
}
