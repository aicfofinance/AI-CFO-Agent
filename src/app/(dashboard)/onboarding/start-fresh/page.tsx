import Link from "next/link";
import { ArrowRight } from "lucide-react";

/**
 * Start-fresh screen — Step 10.2.
 *
 * For users who lost all their data and are beginning a brand-new set of
 * books. Three instructional steps + CTA to /onboarding/connect.
 */

type Step = {
  number: number;
  title: string;
  description: string;
};

const STEPS: Step[] = [
  {
    number: 1,
    title: "Set up QuickBooks Online",
    description: "Create a new QBO account at quickbooks.intuit.com. Free trial available.",
  },
  {
    number: 2,
    title: "Record your starting position",
    description:
      "Enter your current cash balance and any outstanding invoices as of today. Your accountant can help with opening balances.",
  },
  {
    number: 3,
    title: "Connect and start tracking",
    description:
      "Once your QuickBooks account is set up, connect it here to begin AI-powered analysis.",
  },
];

export default function StartFreshPage(): React.JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-semibold text-[var(--text-primary)]">Start from scratch</h1>
          <p className="mt-2 text-[var(--text-secondary)]">
            Follow these three steps to set up your books and begin AI-powered financial analysis.
          </p>
        </div>

        {/* Numbered steps */}
        <ol className="space-y-6">
          {STEPS.map((step) => (
            <li key={step.number} className="flex items-start gap-5">
              {/* Number circle */}
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--primary-500)] text-sm font-semibold text-white"
                aria-hidden="true"
              >
                {step.number}
              </span>

              {/* Step content */}
              <div className="pt-1">
                <h2 className="text-base font-semibold text-[var(--text-primary)]">{step.title}</h2>
                <p className="mt-1 text-sm leading-relaxed text-[var(--text-secondary)]">
                  {step.description}
                </p>
              </div>
            </li>
          ))}
        </ol>

        {/* CTA */}
        <div className="mt-10 flex justify-center">
          <Link
            href="/onboarding/connect"
            className="inline-flex items-center gap-2 rounded bg-[var(--primary-500)] px-5 py-2.5 text-sm font-medium text-white transition-colors duration-150 hover:bg-[var(--primary-600)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary-500)]"
          >
            Connect my new QuickBooks account
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </div>
  );
}
