"use client";

/**
 * Onboarding sync-wait screen — Step 10.3.
 *
 * Two-phase polling:
 *   Phase 1 (polling_sync)  — poll GET /api/connections every 3s until
 *                             connections[0].syncStatus === 'success'.
 *   Phase 2 (polling_intel) — continue polling GET /api/connections every 3s
 *                             until connections[0].lastIntelligenceRunAt !== null.
 *
 * On success → router.push('/onboarding/first-brief').
 * 90-second total timeout → show failure state with Retry / Continue buttons.
 *
 * Dynamic text cycles through four messages every 5 seconds independently of
 * the poll interval.
 */

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import type { ConnectionSummary } from "@/types/api";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 3_000;
const TEXT_ROTATE_MS = 5_000;
const TIMEOUT_MS = 90_000;

const LOADING_MESSAGES = [
  "Importing your transaction history...",
  "Reading your AR aging...",
  "Analyzing expense patterns...",
  "Running first intelligence scan...",
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Phase = "polling_sync" | "polling_intel" | "done" | "timeout";

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SyncWaitPage(): React.JSX.Element {
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>("polling_sync");
  const [messageIndex, setMessageIndex] = useState(0);

  // Refs so the stable interval callback always reads the latest values
  // without being recreated.
  const phaseRef = useRef<Phase>("polling_sync");
  const startTimeRef = useRef<number>(Date.now());

  // ------------------------------------------------------------------
  // Text rotation — independent of polling
  // ------------------------------------------------------------------
  useEffect(() => {
    const id = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % LOADING_MESSAGES.length);
    }, TEXT_ROTATE_MS);
    return () => clearInterval(id);
  }, []);

  // ------------------------------------------------------------------
  // Polling — both phases share one interval
  // ------------------------------------------------------------------
  useEffect(() => {
    async function poll(): Promise<void> {
      const current = phaseRef.current;

      // Terminal states — nothing more to do
      if (current === "done") return;

      // Timeout guard
      if (Date.now() - startTimeRef.current >= TIMEOUT_MS) {
        if (current !== "timeout") {
          phaseRef.current = "timeout";
          setPhase("timeout");
        }
        return;
      }

      try {
        const res = await fetch("/api/connections");

        if (res.status === 401) {
          router.push("/login");
          return;
        }

        // Transient server error — keep polling
        if (!res.ok) return;

        const json = (await res.json()) as { data: ConnectionSummary[] };
        const connections = json.data;

        // No connections registered yet — keep polling
        if (!Array.isArray(connections) || connections.length === 0) return;

        const conn = connections[0];
        // Guard required by noUncheckedIndexedAccess
        if (conn === undefined) return;

        if (current === "polling_sync") {
          if (conn.syncStatus === "success") {
            phaseRef.current = "polling_intel";
            setPhase("polling_intel");
          } else if (conn.syncStatus === "failed" || conn.syncStatus === "auth_expired") {
            // Terminal error from the sync — show failure immediately
            phaseRef.current = "timeout";
            setPhase("timeout");
          }
          // 'in_progress' / null → keep polling
        } else if (current === "polling_intel") {
          if (conn.lastIntelligenceRunAt !== null) {
            phaseRef.current = "done";
            setPhase("done");
            router.push("/onboarding/first-brief");
          }
        }
      } catch {
        // Network error — keep polling
      }
    }

    // Fire immediately on mount, then on interval
    void poll();
    const id = setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(id);
  }, [router]);

  // ------------------------------------------------------------------
  // Handlers
  // ------------------------------------------------------------------

  function handleRetry(): void {
    // Reset timer and phase in-place; the existing interval picks these
    // up on its next tick without needing to remount the effect.
    startTimeRef.current = Date.now();
    phaseRef.current = "polling_sync";
    setPhase("polling_sync");
  }

  function handleContinue(): void {
    router.push("/onboarding/first-brief");
  }

  // ------------------------------------------------------------------
  // Failure / timeout state
  // ------------------------------------------------------------------

  if (phase === "timeout") {
    return (
      <div className="flex min-h-screen items-center justify-center px-4 py-12">
        <div className="w-full max-w-md text-center">
          <p className="text-lg font-medium text-[var(--text-primary)]">
            Import didn&apos;t complete.
          </p>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            The sync is taking longer than expected.
          </p>

          <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={handleRetry}
              className={cn(
                "rounded-lg border-2 border-[var(--primary-500)] px-5 py-2.5 text-sm font-medium",
                "text-[var(--primary-500)] transition-colors duration-150",
                "hover:bg-[var(--primary-50)]",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary-500)]",
              )}
            >
              Retry
            </button>

            <button
              type="button"
              onClick={handleContinue}
              className={cn(
                "rounded-lg bg-[var(--primary-500)] px-5 py-2.5 text-sm font-medium text-white",
                "transition-colors duration-150 hover:bg-[var(--primary-600)]",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary-500)]",
              )}
            >
              Continue — I&apos;ll scan with what&apos;s available
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Loading state (phase 1 or phase 2)
  // ------------------------------------------------------------------

  const currentMessage = LOADING_MESSAGES[messageIndex] ?? "Importing your transaction history...";

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md text-center">
        {/* Spinner */}
        <div
          className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-[var(--primary-500)] border-t-transparent"
          role="status"
          aria-label="Loading"
        />

        {/* Phase indicator */}
        <p className="mt-6 text-sm font-medium text-[var(--text-secondary)]">
          {phase === "polling_sync"
            ? "Step 1 of 2: Syncing your data"
            : "Step 2 of 2: Running intelligence scan"}
        </p>

        {/* Dynamic message */}
        <p className="mt-3 text-base font-medium text-[var(--text-primary)]">{currentMessage}</p>

        {/* Duration hint */}
        <p className="mt-2 text-sm text-[var(--text-muted)]">
          This usually takes 1–3 minutes for the first sync.
        </p>
      </div>
    </div>
  );
}
