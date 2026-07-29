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
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

type DismissReason = "acknowledged" | "not_relevant" | "already_handled" | "false_positive";

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
  onDismiss?: (id: string) => void;
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
// Dismiss reason options — three choices shown in the modal
// ---------------------------------------------------------------------------

const DISMISS_OPTIONS: { value: DismissReason; label: string }[] = [
  { value: "acknowledged", label: "Acknowledged — I’m aware of this" },
  { value: "not_relevant", label: "Not relevant — doesn’t apply to us" },
  { value: "already_handled", label: "Already handled" },
];

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
  onDismiss,
}: FindingCardProps): React.JSX.Element {
  const router = useRouter();

  const [isExpanded, setIsExpanded] = useState(false);
  const [isDismissing, setIsDismissing] = useState(false);
  const [showDismissModal, setShowDismissModal] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [dismissReason, setDismissReason] = useState<DismissReason>("acknowledged");

  function handleToggle(): void {
    setIsExpanded((prev) => !prev);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleToggle();
    }
  }

  async function handleConfirmDismiss(): Promise<void> {
    setIsDismissing(true);
    try {
      const res = await fetch(`/api/intelligence/findings/${id}/dismiss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: dismissReason }),
      });
      if (res.ok) {
        setShowDismissModal(false);
        setIsDismissed(true);
        onDismiss?.(id);
        setTimeout(() => router.refresh(), 400);
      } else {
        setShowDismissModal(false);
      }
    } finally {
      setIsDismissing(false);
    }
  }

  return (
    <div
      className={cn(
        "bg-[var(--surface-card)] border border-[var(--border-default)] rounded-lg overflow-hidden transition-opacity duration-300",
        SEVERITY_LEFT_BORDER[severity],
        isDismissed ? "opacity-0 pointer-events-none" : "opacity-100",
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
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setShowDismissModal(true);
          }}
          aria-label="More options"
          className="ml-2 p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[#F1F5F9] focus-visible:outline-2 focus-visible:outline-[var(--primary-500)]"
        >
          •••
        </button>
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
              Tell me more &rarr;
            </Link>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------------- */}
      {/* Dismiss modal                                                     */}
      {/* --------------------------------------------------------------- */}
      <Dialog open={showDismissModal} onOpenChange={(open) => setShowDismissModal(open)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Dismiss finding</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-1 py-2">
            {DISMISS_OPTIONS.map((option) => (
              <label
                key={option.value}
                className="flex items-center gap-3 cursor-pointer p-3 rounded-lg hover:bg-[#F8FAFC] has-[:checked]:bg-[#EFF6FF]"
              >
                <input
                  type="radio"
                  name={`dismiss-reason-${id}`}
                  value={option.value}
                  checked={dismissReason === option.value}
                  onChange={() => setDismissReason(option.value)}
                  className="accent-[#2557A7]"
                />
                <span className="text-sm text-[var(--text-primary)]">{option.label}</span>
              </label>
            ))}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDismissModal(false)}>
              Cancel
            </Button>
            <Button disabled={isDismissing} onClick={() => void handleConfirmDismiss()}>
              {isDismissing ? "Dismissing…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
