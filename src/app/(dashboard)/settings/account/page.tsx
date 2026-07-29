"use client";

/**
 * Settings > Account page.
 *
 * Two sections:
 *   1. Account   — display name + role from GET /api/auth/me
 *   2. Data & Privacy — read-only access summary + "Download your data" button
 *
 * The download button calls GET /api/data/export which returns:
 *   200 → application/zip; trigger browser download via blob URL
 *   429 → { error: { message: "Try again after …" } }; show message below button
 *   other → generic "Export failed. Please try again."
 *
 * "use client" is required because of button loading/error state.
 */

import { useState, useEffect } from "react";
import { ShieldCheck, Download } from "lucide-react";

import { cn } from "@/lib/utils";
import type { AuthMeResponse } from "@/types/api";

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function AccountPage(): React.JSX.Element {
  const [userInfo, setUserInfo] = useState<AuthMeResponse | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportDone, setExportDone] = useState(false);

  // Fetch current user + org context for the Account section header.
  // Non-critical — if the request fails, the section renders without user info.
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
        // silently ignored — account header is supplementary display
      });
  }, []);

  async function handleDownload(): Promise<void> {
    setIsDownloading(true);
    setExportError(null);
    setExportDone(false);

    try {
      const res = await fetch("/api/data/export");

      if (res.ok) {
        // Trigger browser download — filename comes from Content-Disposition header
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setExportDone(true);
      } else if (res.status === 429) {
        // API returns: { error: { code, message, request_id } }
        // message contains "Try again in about N minute(s)." — surface verbatim
        const json = (await res.json()) as {
          error: { code: string; message: string; request_id: string };
        };
        setExportError(json.error.message);
      } else if (res.status === 401 || res.status === 403) {
        setExportError("You are not authorized to export data. Please sign in again.");
      } else {
        setExportError("Export failed. Please try again.");
      }
    } catch {
      setExportError("Export failed. Please try again.");
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      {/* ------------------------------------------------------------------ */}
      {/* Account section                                                     */}
      {/* ------------------------------------------------------------------ */}
      <div className="border-b border-[var(--border-default)] pb-6">
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Account</h1>
        {userInfo !== null && (
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            {userInfo.displayName.length > 0 ? `${userInfo.displayName} · ` : ""}
            <span className="capitalize">{userInfo.role}</span>
            {" · "}
            <span className="capitalize">{userInfo.planTier} plan</span>
          </p>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Data & Privacy section                                              */}
      {/* ------------------------------------------------------------------ */}
      <section aria-labelledby="data-privacy-heading">
        <h2 id="data-privacy-heading" className="text-xl font-semibold text-[var(--text-primary)]">
          Data &amp; Privacy
        </h2>

        <div className="mt-4 flex flex-col gap-4">
          {/* Read-only access notice — FRONTEND_GUIDELINES §13.4 inline variant */}
          <div
            className="flex items-start gap-2 rounded border border-[var(--primary-200)] bg-[var(--primary-50)] px-3 py-2"
            role="note"
            aria-label="Data sovereignty notice"
          >
            <ShieldCheck
              size={14}
              className="mt-0.5 shrink-0 text-[var(--primary-500)]"
              aria-hidden="true"
            />
            <p className="text-[0.8125rem] leading-[1.6] text-[var(--primary-800)]">
              This product has read-only access to your accounting data. We never write to your
              QuickBooks or Xero account. Your financial records remain entirely under your control.
            </p>
          </div>

          {/* Download your data card */}
          <div className="rounded-md border border-[var(--border-default)] bg-[var(--surface-card)] p-6 shadow-sm">
            <h3 className="text-base font-semibold text-[var(--text-primary)]">
              Download your data
            </h3>
            <p className="mt-1 text-sm leading-relaxed text-[var(--text-secondary)]">
              Export a zip archive containing your reports, full conversation history, all findings,
              and action drafts. Exports are rate-limited to once per hour.
            </p>

            <div className="mt-4">
              <button
                type="button"
                onClick={() => {
                  void handleDownload();
                }}
                disabled={isDownloading}
                className={cn(
                  "inline-flex items-center gap-2 rounded px-4 py-2 text-sm font-medium",
                  "transition-colors duration-100",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary-500)]",
                  isDownloading
                    ? "cursor-not-allowed bg-[var(--gray-200)] text-[var(--text-muted)]"
                    : "bg-[var(--primary-500)] text-white hover:bg-[var(--primary-600)]",
                )}
              >
                {isDownloading ? (
                  <>
                    <span
                      className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--gray-400)] border-t-transparent"
                      aria-hidden="true"
                    />
                    Preparing export&hellip;
                  </>
                ) : (
                  <>
                    <Download size={16} aria-hidden="true" />
                    Download your data
                  </>
                )}
              </button>

              {/* 429 or other error — visible below the button */}
              {exportError !== null && (
                <p role="alert" className="mt-3 text-sm text-[var(--loss-600)]">
                  {exportError}
                </p>
              )}

              {/* Success confirmation — shown after download starts */}
              {exportDone && exportError === null && (
                <p role="status" className="mt-3 text-sm text-[var(--gain-600)]">
                  Your data export has started downloading.
                </p>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
