"use client";

import { useState } from "react";
import type { ReactElement } from "react";

/**
 * Client component — "Generate last month's report" button.
 *
 * POSTs to `POST /api/reports/generate` and shows inline feedback without
 * navigating away. Displays a loading state during the request and a success
 * message on completion. Any error is surfaced as a short inline message.
 */
export function GenerateReportButton(): ReactElement {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  async function handleGenerate(): Promise<void> {
    setStatus("loading");
    try {
      const res = await fetch("/api/reports/generate", { method: "POST" });
      if (res.ok) {
        setStatus("success");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <p className="text-sm text-[var(--gain-600)]">
        Report generation started. Check back in ~1 minute.
      </p>
    );
  }

  if (status === "error") {
    return (
      <p className="text-sm text-[var(--loss-600)]">
        Failed to start report generation. Please try again.
      </p>
    );
  }

  return (
    <button
      type="button"
      disabled={status === "loading"}
      onClick={() => void handleGenerate()}
      className="inline-flex items-center rounded-md bg-[var(--primary-500)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--primary-600)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary-500)] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {status === "loading" ? "Starting…" : "Generate last month's report"}
    </button>
  );
}
