import type { ReactElement } from "react";
import Link from "next/link";
import { Bell, Shield, PenLine, Check } from "lucide-react";

export default function LandingPage(): ReactElement {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      {/* ── Nav ── */}
      <nav className="border-b border-[var(--border-default)] bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <span className="text-lg font-semibold text-[var(--text-primary)]">CFO Lens</span>
          <Link
            href="/login"
            className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            Sign in
          </Link>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
        <div className="mx-auto max-w-2xl">
          <div className="mb-4 inline-block rounded-full bg-[var(--primary-50)] px-3 py-1 text-xs font-medium text-[var(--primary-600)]">
            Proactive financial intelligence
          </div>
          <h1 className="text-4xl font-semibold tracking-tight text-[var(--text-primary)] sm:text-5xl">
            Financial issues surfaced
            <br className="hidden sm:block" />
            {" before you know to ask"}
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-[var(--text-secondary)]">
            CFO Lens connects to QuickBooks or Xero in read-only mode, runs nightly analysis across
            your books, and delivers a prioritized brief — cash risks, AR gaps, duplicate
            subscriptions — every morning.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/register"
              className="inline-flex items-center rounded bg-[var(--primary-500)] px-6 py-3 text-sm font-medium text-white hover:bg-[var(--primary-600)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-300)]"
            >
              Get started free
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center rounded border border-[var(--border-default)] bg-white px-6 py-3 text-sm font-medium text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-300)]"
            >
              Sign in
            </Link>
          </div>
        </div>
      </section>

      {/* ── Three pillars ── */}
      <section className="bg-[var(--surface-page)] px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-10 text-center text-xl font-semibold text-[var(--text-primary)]">
            Built around three commitments
          </h2>
          <div className="grid gap-6 sm:grid-cols-3">
            {/* Pillar 1 — Proactive intelligence */}
            <div className="rounded-lg border border-[var(--border-default)] bg-white p-6">
              <div className="mb-4 inline-flex h-9 w-9 items-center justify-center rounded bg-[var(--primary-50)]">
                <Bell size={18} className="text-[var(--primary-500)]" aria-hidden="true" />
              </div>
              <h3 className="mb-2 text-base font-semibold text-[var(--text-primary)]">
                Proactive, not reactive
              </h3>
              <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                Every morning, CFO Lens has already scanned your cash position, flagged expense
                spikes, scored your AR aging, and checked for duplicate subscriptions — without you
                asking a question.
              </p>
            </div>

            {/* Pillar 2 — Data sovereignty */}
            <div className="rounded-lg border border-[var(--border-default)] bg-white p-6">
              <div className="mb-4 inline-flex h-9 w-9 items-center justify-center rounded bg-[var(--primary-50)]">
                <Shield size={18} className="text-[var(--primary-500)]" aria-hidden="true" />
              </div>
              <h3 className="mb-2 text-base font-semibold text-[var(--text-primary)]">
                Read-only. No lock-in.
              </h3>
              <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                We connect to QuickBooks and Xero with read-only OAuth. We cannot move money, create
                transactions, or modify your books. Export your data at any time and leave with
                everything.
              </p>
            </div>

            {/* Pillar 3 — Draft and approve */}
            <div className="rounded-lg border border-[var(--border-default)] bg-white p-6">
              <div className="mb-4 inline-flex h-9 w-9 items-center justify-center rounded bg-[var(--primary-50)]">
                <PenLine size={18} className="text-[var(--primary-500)]" aria-hidden="true" />
              </div>
              <h3 className="mb-2 text-base font-semibold text-[var(--text-primary)]">
                AI drafts. You approve.
              </h3>
              <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                When action is needed — a collections reminder, a vendor negotiation email — CFO
                Lens writes the draft. You review it, edit it, and copy it to your inbox. We never
                send on your behalf.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Trust indicators ── */}
      <section className="border-t border-[var(--border-default)] bg-white px-6 py-10">
        <div className="mx-auto max-w-3xl">
          <ul className="flex flex-wrap justify-center gap-x-8 gap-y-3">
            {[
              "Read-only access — cannot modify your books",
              "Your data is never used to train AI models",
              "Export everything, leave with nothing left behind",
              "Cancel at any time",
            ].map((item) => (
              <li
                key={item}
                className="flex items-center gap-2 text-sm text-[var(--text-secondary)]"
              >
                <Check size={14} className="shrink-0 text-[var(--gain-600)]" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-[var(--border-default)] bg-[var(--surface-page)] px-6 py-6">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <span className="text-xs text-[var(--text-muted)]">© 2026 CFO Lens</span>
          <nav aria-label="Footer" className="flex gap-6">
            <Link
              href="/terms"
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            >
              Terms
            </Link>
            <Link
              href="/privacy"
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            >
              Privacy
            </Link>
            <Link
              href="/login"
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            >
              Sign in
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
