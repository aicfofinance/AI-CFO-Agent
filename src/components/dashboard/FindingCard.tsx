"use client";

/**
 * FindingCard — displays a single intelligence finding with expandable detail.
 *
 * Five required elements:
 *   1. SeverityBadge
 *   2. Headline
 *   3. "Why it matters" detail (shown when expanded)
 *   4. Recommended action (shown when expanded, if non-null)
 *   5. "Take action" button + "Tell me more →" link (shown when expanded)
 *
 * Card expands inline when the header row is clicked.
 */

import React, { useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { DataTimestamp } from "@/components/shared/DataTimestamp";
import { SeverityBadge } from "@/components/shared/SeverityBadge";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FindingType =
  | "cash_flow_risk"
  | "anomaly"
  | "collections_opportunity"
  | "duplicate_subscription"
  | "margin_alert";

type Severity = "critical" | "high" | "medium" | "low";

export type FindingCardProps = {
  id: string;
  findingType: FindingType;
  severity: Severity;
  headline: string;
  detail: string | null;
  recommendedAction: string | null;
  relatedData: Record<string, unknown> | null;
  hasActionableType: boolean;
  createdAt: string;
  onDismiss?: (id: string) => void; // placeholder — wired in Step 8.3
};

// ---------------------------------------------------------------------------
// Severity → colored left-border Tailwind class.
// Acceptable inline hex per CLAUDE.md: severity-to-style mapping table.
//   critical: loss-700    (#A21520)
//   high:     warning-600 (#B45309)
//   medium:   primary-700 (#183979)
//   low:      gray-700    (#334155)
// ---------------------------------------------------------------------------

const SEVERITY_LEFT_BORDER: Record<Severity, string> = {
  critical: "border-l-4 border-l-[#A21520]",
  high: "border-l-4 border-l-[#B45309]",
  medium: "border-l-4 border-l-[#183979]",
  low: "border-l-4 border-l-[#334155]",
} as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FindingCard({
  id,
  severity,
  headline,
  detail,
  recommendedAction,
  hasActionableType,
  createdAt,
}: FindingCardProps): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);

  function handleToggle(): void {
    setIsExpanded((prev) => !prev);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleToggle();
    }
  }

  return (
    <div
      className={cn(
        "bg-[var(--surface-card)] border border-[var(--border-default)] rounded-lg overflow-hidden",
        SEVERITY_LEFT_BORDER[severity],
      )}
    >
      {/* --------------------------------------------------------------- */}
      {/* Header row — always visible, clickable to expand/collapse        */}
      {/* --------------------------------------------------------------- */}
      <div
        role="button"
        aria-expanded={isExpanded}
        tabIndex={0}
        className="flex items-start gap-3 p-5 cursor-pointer select-none"
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
      >
        <SeverityBadge severity={severity} />
        <h3 className="flex-1 text-sm font-semibold text-[var(--text-primary)] leading-snug">
          {headline}
        </h3>
        <DataTimestamp date={createdAt} label="Added" className="shrink-0" />
      </div>

      {/* --------------------------------------------------------------- */}
      {/* Expanded content                                                  */}
      {/* --------------------------------------------------------------- */}
      {isExpanded && (
        <div className="px-5 pb-5 pt-0">
          {detail !== null && <p className="text-sm text-[var(--text-secondary)] mb-3">{detail}</p>}

          {recommendedAction !== null && (
            <div>
              <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1">
                Recommended action
              </p>
              <p className="text-sm text-[var(--text-secondary)] mb-3">{recommendedAction}</p>
            </div>
          )}

          {/* Action row */}
          <div className="flex items-center gap-3 mt-4">
            <Button size="sm" disabled={!hasActionableType}>
              Take action
            </Button>
            <Link
              href={`/ask?finding_id=${id}`}
              className="text-sm text-[var(--text-link)] hover:underline"
            >
              Tell me more →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
