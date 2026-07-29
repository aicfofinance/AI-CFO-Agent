"use client";

/**
 * CSV upload screen — Step 10.1-ui.
 *
 * State machine:
 *   idle → uploading → success (summary + persistent banner)
 *                    → error   (message + retry)
 *
 * Calls POST /api/connections/csv with multipart/form-data field "file".
 * Returns 201 { data: { rowsImported: number, connectionId: string } }.
 */

import { useState, useRef } from "react";
import Link from "next/link";
import { Upload, CircleCheck, AlertCircle, ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";

type UploadState = "idle" | "uploading" | "success" | "error";

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB — matches API limit

export default function CsvUploadPage(): React.JSX.Element {
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [rowsImported, setRowsImported] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const selected = e.target.files?.[0] ?? null;

    if (selected !== null && selected.size > MAX_FILE_BYTES) {
      // Clear the native input so the user can retry with a different file.
      if (fileInputRef.current !== null) {
        fileInputRef.current.value = "";
      }
      setFile(null);
      setErrorMessage("File exceeds the 10 MB limit. Please export a smaller date range.");
      setUploadState("error");
      return;
    }

    setFile(selected);
    setErrorMessage(null);
    if (uploadState === "error") setUploadState("idle");
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (file === null) return;

    setUploadState("uploading");
    setErrorMessage(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/connections/csv", {
        method: "POST",
        body: formData,
      });

      if (res.status === 201) {
        const body = (await res.json()) as {
          data: { rowsImported: number; connectionId: string };
        };
        setRowsImported(body.data.rowsImported);
        setUploadState("success");
        return;
      }

      if (res.status === 413) {
        setErrorMessage("File exceeds the 10 MB limit. Please export a smaller date range.");
        setUploadState("error");
        return;
      }

      if (res.status === 422) {
        setErrorMessage("The CSV appears to be empty. Please export transactions and try again.");
        setUploadState("error");
        return;
      }

      if (res.status === 400) {
        const body = (await res.json()) as { error?: { message?: string } };
        setErrorMessage(
          body.error?.message ??
            "Invalid file format. Please upload a QuickBooks or Xero CSV export.",
        );
        setUploadState("error");
        return;
      }

      if (res.status === 401) {
        setErrorMessage("Your session has expired. Please refresh the page and sign in again.");
        setUploadState("error");
        return;
      }

      setErrorMessage("Something went wrong. Please try again.");
      setUploadState("error");
    } catch {
      setErrorMessage("Upload failed. Please check your connection and try again.");
      setUploadState("error");
    }
  }

  function handleReset(): void {
    setUploadState("idle");
    setFile(null);
    setErrorMessage(null);
    if (fileInputRef.current !== null) {
      fileInputRef.current.value = "";
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--surface-page)] px-4 py-12">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-semibold text-[var(--text-primary)]">
            Import your financial data
          </h1>
          <p className="mt-2 text-[var(--text-secondary)]">
            Upload a QuickBooks or Xero CSV export to bring in your transaction history.
          </p>
        </div>

        {/* Card */}
        <div className="rounded-lg border border-[var(--border-default)] bg-white p-6 shadow-sm">
          {uploadState === "success" ? (
            // ----------------------------------------------------------------
            // Success state — import summary + persistent connection banner
            // ----------------------------------------------------------------
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <CircleCheck size={24} className="shrink-0 text-gain-600" aria-hidden="true" />
                <span className="sr-only">Import successful.</span>
                <p className="text-lg font-semibold text-[var(--text-primary)]">
                  Imported {rowsImported.toLocaleString()}{" "}
                  {rowsImported === 1 ? "transaction" : "transactions"}
                </p>
              </div>

              <p className="text-sm text-[var(--text-secondary)]">
                Your historical data is ready. Financial insights will be available shortly.
              </p>

              {/* Persistent banner — never dismissible */}
              <div
                role="note"
                className="flex items-start gap-3 rounded border border-[var(--primary-200)] bg-[var(--primary-50)] px-4 py-3"
              >
                <AlertCircle
                  size={16}
                  className="mt-0.5 shrink-0 text-[var(--primary-500)]"
                  aria-hidden="true"
                />
                <div>
                  <p className="text-sm font-medium text-[var(--primary-800)]">
                    Static snapshot — connect QuickBooks for live monitoring.
                  </p>
                  <p className="mt-1 text-sm text-[var(--text-secondary)]">
                    This import is a one-time snapshot of your history.{" "}
                    <Link
                      href="/onboarding/connect"
                      className={cn(
                        "font-medium text-[var(--primary-500)] underline-offset-2",
                        "hover:underline",
                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary-500)]",
                      )}
                    >
                      Connect QuickBooks or Xero
                      <ArrowRight
                        size={12}
                        className="ml-0.5 inline-block align-middle"
                        aria-hidden="true"
                      />
                    </Link>{" "}
                    for automatic updates.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            // ----------------------------------------------------------------
            // Upload form — idle, uploading, error
            // ----------------------------------------------------------------
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* File input label */}
              <div className="space-y-2">
                <label
                  htmlFor="csv-file"
                  className="block text-xs font-medium text-[var(--text-secondary)]"
                >
                  CSV file
                  <span className="ml-0.5 text-loss-600" aria-hidden="true">
                    *
                  </span>
                </label>

                {/* Drop-zone area — invisible input overlaid on the visual area */}
                <div
                  className={cn(
                    "relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors duration-150",
                    file !== null
                      ? "border-[var(--primary-500)] bg-[var(--primary-50)]"
                      : "border-[var(--border-default)] bg-white hover:border-[var(--primary-500)] hover:bg-[var(--primary-50)]",
                    uploadState === "error" && file === null && "border-loss-200 bg-loss-50",
                  )}
                >
                  <Upload
                    size={24}
                    className={cn(
                      "mb-2",
                      file !== null ? "text-[var(--primary-500)]" : "text-[var(--text-muted)]",
                    )}
                    aria-hidden="true"
                  />

                  {file !== null ? (
                    <p className="text-sm font-medium text-[var(--text-primary)]">{file.name}</p>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-[var(--text-primary)]">
                        Choose a CSV file
                      </p>
                      <p className="mt-1 text-xs text-[var(--text-muted)]">.csv only · max 10 MB</p>
                    </>
                  )}

                  {/* Invisible full-area file input — click anywhere in the zone */}
                  <input
                    ref={fileInputRef}
                    id="csv-file"
                    type="file"
                    accept=".csv"
                    required
                    onChange={handleFileChange}
                    disabled={uploadState === "uploading"}
                    aria-describedby={errorMessage !== null ? "upload-error" : undefined}
                    className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
                  />
                </div>
              </div>

              {/* Error message */}
              {errorMessage !== null && (
                <div
                  id="upload-error"
                  role="alert"
                  className="flex items-start gap-2 rounded border border-loss-200 bg-loss-50 px-3 py-2"
                >
                  <AlertCircle
                    size={14}
                    className="mt-0.5 shrink-0 text-loss-600"
                    aria-hidden="true"
                  />
                  <p className="text-sm text-loss-600">{errorMessage}</p>
                </div>
              )}

              {/* Submit button */}
              <button
                type="submit"
                disabled={file === null || uploadState === "uploading"}
                className={cn(
                  "flex w-full items-center justify-center gap-2 rounded px-4 py-2.5 text-sm font-medium text-white transition-colors duration-150",
                  "bg-[var(--primary-500)] hover:bg-[var(--primary-600)]",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary-500)]",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                )}
              >
                {uploadState === "uploading" ? (
                  <>
                    <span
                      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
                      aria-hidden="true"
                    />
                    Importing…
                  </>
                ) : (
                  <>
                    <Upload size={16} aria-hidden="true" />
                    Import CSV
                  </>
                )}
              </button>

              {/* Reset link — shown after an error so user can start over */}
              {uploadState === "error" && (
                <button
                  type="button"
                  onClick={handleReset}
                  className={cn(
                    "w-full text-center text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary-500)]",
                  )}
                >
                  Clear and try again
                </button>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
