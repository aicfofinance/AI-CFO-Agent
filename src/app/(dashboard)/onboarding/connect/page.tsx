import Link from "next/link";
import { ShieldCheck, ArrowRight } from "lucide-react";

/**
 * Provider connect screen — Step 10.2.
 *
 * Data sovereignty statement appears above provider options per spec.
 * Provider cards are plain <a> tags that navigate the browser to the
 * OAuth initiate endpoints — no JS needed.
 *
 * Layout:
 *   1. Page title
 *   2. Read-only data sovereignty banner (above everything else)
 *   3. QuickBooks + Xero provider cards
 *   4. CSV fallback link
 */

// ---------------------------------------------------------------------------
// Provider display config — documented mapping from provider key to display.
// Brand hex colors documented here as the mapping table:
//   quickbooks: QuickBooks brand green (#2CA01C)
//   xero:       Xero brand blue (#1AB4D7)
// ---------------------------------------------------------------------------

const PROVIDER_CONFIG = {
  quickbooks: {
    label: "QuickBooks",
    initials: "QB",
    /** QuickBooks brand green — bg-[#2CA01C] */
    logoBgClass: "bg-[#2CA01C]",
    initiateUrl: "/api/auth/quickbooks/initiate",
    description: "Connect your QuickBooks Online account for live syncing and AI analysis.",
  },
  xero: {
    label: "Xero",
    initials: "Xero",
    /** Xero brand blue — bg-[#1AB4D7] */
    logoBgClass: "bg-[#1AB4D7]",
    initiateUrl: "/api/auth/xero/initiate",
    description: "Connect your Xero account for live syncing and AI analysis.",
  },
} as const;

type ProviderKey = keyof typeof PROVIDER_CONFIG;

const PROVIDERS: ProviderKey[] = ["quickbooks", "xero"];

export default function ConnectPage(): React.JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="mb-6 text-center">
          <h1 className="text-3xl font-semibold text-[var(--text-primary)]">
            Connect your accounting software
          </h1>
        </div>

        {/* Data sovereignty statement — must appear ABOVE provider options */}
        <div
          className="mb-8 border-l-4 border-[var(--primary-500)] bg-[var(--primary-50)] px-4 py-3"
          role="note"
          aria-label="Data sovereignty statement"
        >
          <div className="flex items-start gap-2">
            <ShieldCheck
              size={16}
              className="mt-0.5 shrink-0 text-[var(--primary-500)]"
              aria-hidden="true"
            />
            <p className="text-sm leading-relaxed text-[var(--primary-800)]">
              <strong className="font-semibold">Read-only access. Always.</strong> We connect to
              your QuickBooks or Xero file but never write to it. If you cancel, your accounting
              file is 100% intact.
            </p>
          </div>
        </div>

        {/* Provider cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {PROVIDERS.map((providerKey) => {
            const config = PROVIDER_CONFIG[providerKey];
            return (
              <a
                key={providerKey}
                href={config.initiateUrl}
                className="group flex flex-col items-start rounded-xl border-2 border-[var(--border-default)] bg-white p-6 transition-colors duration-150 hover:border-[var(--primary-500)] hover:bg-[var(--primary-50)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary-500)]"
              >
                {/* Provider logo — brand color from PROVIDER_CONFIG */}
                <div
                  className={`mb-4 flex h-10 w-10 items-center justify-center rounded text-sm font-bold text-white ${config.logoBgClass}`}
                  aria-hidden="true"
                >
                  {config.initials}
                </div>

                <h2 className="text-lg font-semibold text-[var(--text-primary)]">{config.label}</h2>

                <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
                  {config.description}
                </p>

                <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--primary-500)]">
                  Connect {config.label}
                  <ArrowRight size={14} aria-hidden="true" />
                </span>
              </a>
            );
          })}
        </div>

        {/* CSV fallback link */}
        <p className="mt-8 text-center text-sm text-[var(--text-secondary)]">
          Don&apos;t have live accounting software?{" "}
          <Link
            href="/onboarding/csv"
            className="font-medium text-[var(--primary-500)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary-500)]"
          >
            Import a CSV export
            <ArrowRight size={12} className="ml-0.5 inline-block align-middle" aria-hidden="true" />
          </Link>
        </p>
      </div>
    </div>
  );
}
