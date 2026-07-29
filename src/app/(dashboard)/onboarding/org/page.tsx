"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INDUSTRY_OPTIONS = [
  "Retail",
  "E-commerce",
  "Professional Services",
  "Healthcare",
  "Construction",
  "Real Estate",
  "Manufacturing",
  "Food & Beverage",
  "Technology",
  "Transportation",
  "Education",
  "Finance",
  "Non-profit",
  "Media & Entertainment",
  "Other",
] as const;

const REVENUE_BAND_OPTIONS = [
  "Under $100K",
  "$100K–$500K",
  "$500K–$1M",
  "$1M–$5M",
  "$5M–$25M",
  "Over $25M",
] as const;

// Shared style for native select elements — mirrors the Input component style.
const SELECT_CLASS =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm " +
  "transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 " +
  "focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 " +
  "text-[var(--text-primary)]";

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function OrgCreationPage(): React.JSX.Element {
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [revenueBand, setRevenueBand] = useState("");
  const [consentGiven, setConsentGiven] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();

    // Belt-and-suspenders consent check — the required attribute on the
    // checkbox handles this in the browser, but we double-check before sending.
    if (!consentGiven) {
      setError("You must accept the data terms before continuing.");
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const response = await fetch("/api/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, industry, revenueBand, consentGiven: true }),
      });

      if (response.ok) {
        router.push("/onboarding/connect");
        return;
      }

      if (response.status === 409) {
        setError("You already have an organization.");
        return;
      }

      setError("Something went wrong. Please try again.");
    } catch {
      setError("Something went wrong. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--surface-page)] px-4 py-12">
      <div className="w-full max-w-lg">
        {/* Progress indicator */}
        <div className="mb-6">
          <p className="text-xs font-medium text-[var(--text-muted)]">Step 1 of 2</p>
          <h1 className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">
            Tell us about your business
          </h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            This helps us tailor the intelligence feed to your industry.
          </p>
        </div>

        {/* Progress bar */}
        <div className="mb-8 h-1 w-full rounded-full bg-[var(--border-default)]">
          <div className="h-1 w-1/2 rounded-full bg-primary-500" />
        </div>

        <div className="rounded-lg border border-[var(--border-default)] bg-white p-6 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Business name */}
            <div className="space-y-1.5">
              <label
                htmlFor="business-name"
                className="block text-xs font-medium text-[var(--text-secondary)]"
              >
                Business name
                <span className="ml-0.5 text-loss-600" aria-hidden="true">
                  *
                </span>
              </label>
              <Input
                id="business-name"
                type="text"
                placeholder="Acme Corp"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoComplete="organization"
                className="w-full"
              />
            </div>

            {/* Industry */}
            <div className="space-y-1.5">
              <label
                htmlFor="industry"
                className="block text-xs font-medium text-[var(--text-secondary)]"
              >
                Industry
                <span className="ml-0.5 text-loss-600" aria-hidden="true">
                  *
                </span>
              </label>
              <select
                id="industry"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                required
                className={SELECT_CLASS}
              >
                <option value="" disabled>
                  Select your industry
                </option>
                {INDUSTRY_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>

            {/* Revenue band */}
            <div className="space-y-1.5">
              <label
                htmlFor="revenue-band"
                className="block text-xs font-medium text-[var(--text-secondary)]"
              >
                Annual revenue
                <span className="ml-0.5 text-loss-600" aria-hidden="true">
                  *
                </span>
              </label>
              <select
                id="revenue-band"
                value={revenueBand}
                onChange={(e) => setRevenueBand(e.target.value)}
                required
                className={SELECT_CLASS}
              >
                <option value="" disabled>
                  Select a revenue range
                </option>
                {REVENUE_BAND_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>

            {/* Consent checkbox */}
            <div className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-page)] p-4">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  id="consent"
                  checked={consentGiven}
                  onChange={(e) => setConsentGiven(e.target.checked)}
                  required
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-[var(--border-strong)] accent-primary-500"
                  aria-describedby="consent-description"
                />
                <span
                  id="consent-description"
                  className="text-sm leading-[1.6] text-[var(--text-primary)]"
                >
                  This product reads my QuickBooks or Xero data. It never modifies my books. It
                  provides AI-generated analysis, not financial advice.
                </span>
              </label>
            </div>

            {error !== null && (
              <p className="text-sm text-loss-600" role="alert">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={loading || !consentGiven}>
              {loading ? "Creating account…" : "Continue →"}
            </Button>
          </form>
        </div>
      </div>
    </main>
  );
}
