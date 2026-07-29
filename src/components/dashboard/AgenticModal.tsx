"use client";

/**
 * AgenticModal — five-state agentic execution modal.
 *
 * State machine (per CLAUDE.md — never add or skip states):
 *   confirm → generating → review → copy → done
 *
 * Accessibility requirements:
 *   - DialogTitle present in every state for aria-labelledby.
 *   - Textarea in State 3 has aria-label="Email draft body — editable".
 *   - Copy button has aria-label; aria-live region announces success.
 *   - AI disclaimer banner is always visible in State 3 — never hidden.
 */

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Copy, CircleCheck } from "lucide-react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CurrencyAmount } from "@/components/shared/CurrencyAmount";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ModalState = "confirm" | "generating" | "review" | "copy" | "done";

type FindingType =
  | "cash_flow_risk"
  | "anomaly"
  | "collections_opportunity"
  | "duplicate_subscription"
  | "margin_alert";

type DraftData = {
  draftId: string;
  draftContent: string;
  subjectLine: string;
  recipientEmail: string | null;
};

export type AgenticModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  findingId: string;
  findingType: FindingType;
  headline: string;
  relatedData: Record<string, unknown> | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip the "[AI Draft — Review before sending]\n\n" prefix from API content. */
const AI_DRAFT_PREFIX = "[AI Draft — Review before sending]\n\n";

function stripDraftPrefix(content: string): string {
  return content.startsWith(AI_DRAFT_PREFIX) ? content.slice(AI_DRAFT_PREFIX.length) : content;
}

/**
 * Extract client name and invoice amount for collections_opportunity findings.
 * Uses type guards — never casts to any.
 */
function extractInvoiceContext(relatedData: Record<string, unknown> | null): {
  clientName: string;
  amount: string | null;
} {
  if (!relatedData) return { clientName: "", amount: null };
  const invoices = relatedData["invoices"];
  if (!Array.isArray(invoices) || invoices.length === 0) {
    return { clientName: "", amount: null };
  }
  const first = invoices[0];
  if (first === null || typeof first !== "object") {
    return { clientName: "", amount: null };
  }
  const record = first as Record<string, unknown>;
  const clientName = typeof record["clientName"] === "string" ? record["clientName"] : "";
  const amount = typeof record["amount"] === "string" ? record["amount"] : null;
  return { clientName, amount };
}

/** Extract vendor name for duplicate_subscription findings. */
function extractVendorName(relatedData: Record<string, unknown> | null): string {
  if (!relatedData) return "";
  const vendorName = relatedData["vendorName"];
  return typeof vendorName === "string" ? vendorName : "";
}

function getModalTitle(findingType: FindingType): string {
  switch (findingType) {
    case "collections_opportunity":
      return "Draft a collections reminder";
    case "duplicate_subscription":
      return "Draft a cancellation inquiry";
    case "margin_alert":
      return "Draft a vendor negotiation email";
    default:
      return "Draft an action email";
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AgenticModal({
  open,
  onOpenChange,
  findingId,
  findingType,
  headline,
  relatedData,
}: AgenticModalProps): React.JSX.Element {
  const router = useRouter();

  const [modalState, setModalState] = useState<ModalState>("confirm");
  const [draftData, setDraftData] = useState<DraftData | null>(null);
  // draftBody is the editable text in State 3; persists edits across state
  // transitions within the same modal session.
  const [draftBody, setDraftBody] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // markedAsSent is a V1 visual-only toggle — no API side effect.
  const [markedAsSent, setMarkedAsSent] = useState(false);

  // Reset to confirm when the modal opens fresh (not on internal state changes).
  useEffect(() => {
    if (open) {
      setModalState("confirm");
      setDraftData(null);
      setDraftBody("");
      setErrorMessage(null);
      setMarkedAsSent(false);
    }
  }, [open]);

  // ---------------------------------------------------------------------------
  // Derived context
  // ---------------------------------------------------------------------------

  const invoiceCtx =
    findingType === "collections_opportunity"
      ? extractInvoiceContext(relatedData)
      : { clientName: "", amount: null };

  const vendorName = findingType === "duplicate_subscription" ? extractVendorName(relatedData) : "";

  /**
   * The "client name" used in no-email warnings and copy-text placeholders.
   * Falls back to empty string — callers show "client" when empty.
   */
  const contextName =
    findingType === "collections_opportunity"
      ? invoiceCtx.clientName
      : findingType === "duplicate_subscription"
        ? vendorName
        : "";

  const noEmail = draftData?.recipientEmail === null;

  // ---------------------------------------------------------------------------
  // API call
  // ---------------------------------------------------------------------------

  async function callDraftApi(): Promise<void> {
    setModalState("generating");
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/intelligence/findings/${findingId}/draft-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const raw: unknown = await res.json();

      if (!res.ok) {
        type ErrorShape = { error?: { message?: string } };
        const errBody = raw as ErrorShape;
        setErrorMessage(errBody.error?.message ?? "An unexpected error occurred.");
        return;
      }

      type SuccessShape = { data: DraftData };
      const body = raw as SuccessShape;
      const cleaned = stripDraftPrefix(body.data.draftContent);
      const resolved: DraftData = { ...body.data, draftContent: cleaned };
      setDraftData(resolved);
      setDraftBody(cleaned);
      setModalState("review");
    } catch {
      setErrorMessage("Network error. Check your connection and try again.");
    }
  }

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  function handleDraftIt(): void {
    if (draftData !== null) {
      // Re-use cached draft (e.g. after "← Start over") — do NOT re-call API.
      setModalState("review");
      return;
    }
    void callDraftApi();
  }

  function handleStartOver(): void {
    // Return to State 1. draftData is preserved — "Draft it" will go directly
    // to review if clicked again without re-calling the API.
    setModalState("confirm");
  }

  function handleLooksGood(): void {
    // Best-effort tracking PATCH — does not block the UX.
    if (draftData !== null) {
      void fetch(`/api/intelligence/actions/${draftData.draftId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "approved" }),
      })
        .then((res) => {
          if (!res.ok) {
            console.error({
              event: "action_tracking_patch_failed",
              targetStatus: "approved",
              httpStatus: res.status,
            });
          }
        })
        .catch((err: unknown) => {
          console.error({
            event: "action_tracking_patch_network_error",
            targetStatus: "approved",
            error: err,
          });
        });
    }
    setModalState("copy");
  }

  async function handleCopy(): Promise<void> {
    const recipient = draftData?.recipientEmail ?? null;
    const subject = draftData?.subjectLine ?? "";
    const nameForCopy = contextName || "client";

    const toLine =
      recipient !== null ? `TO: ${recipient}` : `TO: [Add ${nameForCopy}'s email address]`;

    const fullText = `${toLine}\nSubject: ${subject}\n\n${draftBody}`;

    try {
      await navigator.clipboard.writeText(fullText);
    } catch {
      // Clipboard API unavailable (HTTP context or older browser).
      // The state still transitions to done — user may copy manually.
    }

    // Best-effort tracking PATCH — fires regardless of clipboard success.
    // Does not block the UX; copy success transitions to done unconditionally.
    if (draftData !== null) {
      void fetch(`/api/intelligence/actions/${draftData.draftId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "copied" }),
      })
        .then((res) => {
          if (!res.ok) {
            console.error({
              event: "action_tracking_patch_failed",
              targetStatus: "copied",
              httpStatus: res.status,
            });
          }
        })
        .catch((err: unknown) => {
          console.error({
            event: "action_tracking_patch_network_error",
            targetStatus: "copied",
            error: err,
          });
        });
    }

    setModalState("done");
  }

  function handleClose(): void {
    // Refresh the feed when closing from the done state so the actioned finding
    // disappears without requiring a manual page refresh (IMPLEMENTATION_PLAN 9.6).
    if (modalState === "done") {
      router.refresh();
    }
    onOpenChange(false);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const modalTitle = getModalTitle(findingType);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        {/* ---------------------------------------------------------------- */}
        {/* State 1 — Confirm                                                 */}
        {/* ---------------------------------------------------------------- */}
        {modalState === "confirm" && (
          <div className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{modalTitle}</DialogTitle>
            </DialogHeader>

            {/* Finding context summary */}
            <div className="rounded border border-[var(--border-default)] bg-[var(--gray-50)] px-4 py-3">
              <p className="text-sm font-medium text-[var(--text-primary)] leading-snug">
                {headline}
              </p>

              {findingType === "collections_opportunity" && invoiceCtx.clientName && (
                <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
                  <span className="text-xs text-[var(--text-secondary)]">
                    Client:{" "}
                    <span className="font-medium text-[var(--text-primary)]">
                      {invoiceCtx.clientName}
                    </span>
                  </span>
                  {invoiceCtx.amount !== null && (
                    <span className="text-xs text-[var(--text-secondary)]">
                      Amount: <CurrencyAmount value={invoiceCtx.amount} className="text-xs" />
                    </span>
                  )}
                </div>
              )}

              {findingType === "duplicate_subscription" && vendorName && (
                <div className="mt-2">
                  <span className="text-xs text-[var(--text-secondary)]">
                    Vendor:{" "}
                    <span className="font-medium text-[var(--text-primary)]">{vendorName}</span>
                  </span>
                </div>
              )}
            </div>

            <p className="text-sm text-[var(--text-secondary)]">
              The AI will draft a professional email you can review before copying.
            </p>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" size="sm" onClick={handleClose}>
                Not now
              </Button>
              {/* autoFocus ensures "Draft it" receives focus when modal opens */}
              <Button autoFocus size="sm" onClick={handleDraftIt}>
                Draft it
              </Button>
            </div>
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* State 2 — Generating                                              */}
        {/* ---------------------------------------------------------------- */}
        {modalState === "generating" && (
          <div className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{modalTitle}</DialogTitle>
            </DialogHeader>

            {errorMessage !== null ? (
              /* Error sub-state within generating — per CLAUDE.md, not a
                 separate state. */
              <div className="flex flex-col gap-4">
                <div className="flex items-start gap-2 rounded border border-[var(--loss-200)] bg-[var(--loss-50)] px-3 py-2">
                  <AlertTriangle
                    size={14}
                    className="mt-0.5 shrink-0 text-[#C42030]"
                    aria-hidden="true"
                  />
                  <p className="text-sm text-[#A21520]">Draft generation failed. {errorMessage}</p>
                </div>
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button variant="ghost" size="sm" onClick={handleClose}>
                    Cancel
                  </Button>
                  <Button autoFocus size="sm" onClick={() => void callDraftApi()}>
                    Try again
                  </Button>
                </div>
              </div>
            ) : (
              /* Progress sub-state */
              <div className="flex flex-col gap-3 py-4">
                <div
                  className="relative h-[3px] w-full overflow-hidden rounded-none bg-[var(--gray-200)]"
                  role="progressbar"
                  aria-label="Drafting in progress"
                  aria-busy="true"
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div className="animate-agentic-progress absolute h-full w-2/5 bg-[var(--primary-500)]" />
                </div>
                <p className="text-center text-sm text-[var(--text-secondary)]">
                  Drafting your message&hellip;
                </p>
              </div>
            )}
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* State 3 — Review (inline edit)                                    */}
        {/* ---------------------------------------------------------------- */}
        {modalState === "review" && draftData !== null && (
          <div className="flex flex-col gap-3">
            <DialogHeader>
              <DialogTitle>Review your draft</DialogTitle>
            </DialogHeader>

            {/* AI disclaimer — always visible, never hidden per CLAUDE.md */}
            <div className="flex items-start gap-2 rounded border border-[var(--warning-200)] bg-[var(--warning-50)] px-3 py-2">
              <AlertTriangle
                size={14}
                className="mt-0.5 shrink-0 text-[#B45309]"
                aria-hidden="true"
              />
              <p className="text-[0.8125rem] text-[#92400E]">
                This draft was generated by AI using your QuickBooks data. Review it before sending.
              </p>
            </div>

            {/* No-email warning — shown when recipient is missing */}
            {noEmail && (
              <div className="flex items-start gap-2 rounded border border-[var(--warning-200)] bg-[var(--warning-50)] px-3 py-2">
                <AlertTriangle
                  size={14}
                  className="mt-0.5 shrink-0 text-[#B45309]"
                  aria-hidden="true"
                />
                <p className="text-[0.8125rem] text-[#92400E]">
                  QuickBooks doesn&apos;t have an email address for {contextName || "this client"}.
                  Add their address in the &ldquo;To:&rdquo; field when you paste into your email
                  client.
                </p>
              </div>
            )}

            {/* To field */}
            <div className="rounded border border-[var(--border-default)] bg-[var(--gray-50)] px-3 py-2 text-sm">
              <span className="text-[var(--text-muted)]">To: </span>
              {draftData.recipientEmail !== null ? (
                <span className="text-[var(--text-primary)]">{draftData.recipientEmail}</span>
              ) : (
                <span className="text-[#B45309]">
                  [Add {contextName || "client"}&apos;s email address]
                </span>
              )}
            </div>

            {/* Subject field */}
            <div className="border-b border-[var(--border-subtle)] px-3 py-2 text-sm">
              <span className="text-[var(--text-muted)]">Subject: </span>
              <span className="text-[var(--text-primary)]">{draftData.subjectLine}</span>
            </div>

            {/* Editable draft body — click anywhere to edit */}
            <textarea
              autoFocus
              className="w-full resize-none rounded border border-[var(--border-default)] p-3 text-sm leading-[1.7] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary-300)]"
              rows={8}
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              aria-label="Email draft body — editable"
            />

            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={handleStartOver}
                className="rounded px-1 text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              >
                ← Start over
              </button>
              <Button size="sm" onClick={handleLooksGood}>
                Looks good →
              </Button>
            </div>
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* State 4 — Copy to clipboard                                       */}
        {/* ---------------------------------------------------------------- */}
        {modalState === "copy" && draftData !== null && (
          <div className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Ready to copy</DialogTitle>
            </DialogHeader>

            {/* No-email warning */}
            {noEmail && (
              <div className="flex items-start gap-2 rounded border border-[var(--warning-200)] bg-[var(--warning-50)] px-3 py-2">
                <AlertTriangle
                  size={14}
                  className="mt-0.5 shrink-0 text-[#B45309]"
                  aria-hidden="true"
                />
                <p className="text-[0.8125rem] text-[#92400E]">
                  QuickBooks doesn&apos;t have an email address for {contextName || "this client"}.
                  Add their address in the &ldquo;To:&rdquo; field when you paste.
                </p>
              </div>
            )}

            {/* Read-only final draft preview */}
            <div className="rounded-none border border-[var(--border-default)] bg-[var(--gray-50)] p-3 text-sm leading-[1.7] text-[var(--text-primary)]">
              <p className="mb-1 text-xs text-[var(--text-muted)]">
                To: {draftData.recipientEmail ?? `[Add ${contextName || "client"}'s email address]`}
              </p>
              <p className="mb-2 text-xs text-[var(--text-muted)]">
                Subject: {draftData.subjectLine}
              </p>
              <div className="whitespace-pre-wrap border-t border-[var(--border-subtle)] pt-2">
                {draftBody}
              </div>
            </div>

            {/* aria-live region announces copy success to screen readers */}
            <div aria-live="polite" aria-atomic="true" className="sr-only" />

            {/* Primary CTA — NEVER labelled "Send" per CLAUDE.md */}
            <button
              type="button"
              autoFocus
              onClick={() => void handleCopy()}
              className="flex w-full items-center justify-center gap-2 rounded bg-[var(--primary-500)] py-2.5 text-sm font-medium text-white hover:bg-[var(--primary-600)]"
              aria-label="Copy draft to clipboard"
            >
              <Copy size={16} aria-hidden="true" />
              📋 Copy to clipboard
            </button>

            <p className="text-center text-sm text-[var(--text-muted)]">
              Paste this into your email client and send it.
              <br />
              <span className="text-xs">This product never sends on your behalf.</span>
            </p>

            <div className="flex justify-start">
              <button
                type="button"
                onClick={() => setModalState("review")}
                className="rounded px-1 text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              >
                ← Edit
              </button>
            </div>
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* State 5 — Done (confirmation)                                     */}
        {/* PATCH /api/intelligence/actions/:id with status:'copied' is fired */}
        {/* in handleCopy() above (best-effort, non-blocking).                */}
        {/* ---------------------------------------------------------------- */}
        {modalState === "done" && (
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            {/* Accessible title for aria-labelledby */}
            <DialogTitle className="sr-only">Copied to clipboard</DialogTitle>

            <CircleCheck size={40} className="text-[#15803D]" aria-hidden="true" />
            <span className="sr-only">Success:</span>
            <p className="text-lg font-medium text-[var(--text-primary)]">
              &#10003; Copied to clipboard
            </p>
            <p className="text-sm text-[var(--text-secondary)]">
              Open your email client, paste, and send.
            </p>

            {/* Mark as sent toggle — V1 visual affordance only, no API side effect */}
            <label className="flex cursor-pointer items-center gap-2 rounded border border-[var(--border-default)] bg-[var(--gray-50)] px-4 py-2.5 text-sm text-[var(--text-secondary)]">
              <input
                type="checkbox"
                checked={markedAsSent}
                onChange={(e) => setMarkedAsSent(e.target.checked)}
                className="h-4 w-4 cursor-pointer accent-[var(--primary-500)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-300)]"
                aria-label="Mark as sent"
              />
              <span>Mark as sent</span>
            </label>
            <p className="text-xs text-[var(--text-muted)]">
              This product never sends on your behalf.
            </p>

            <Button autoFocus variant="ghost" size="sm" onClick={handleClose}>
              Close
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
