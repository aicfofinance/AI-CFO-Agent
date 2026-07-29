import type { ReactElement } from "react";
import Link from "next/link";

export default function PrivacyPage(): ReactElement {
  return (
    <div className="min-h-screen bg-[var(--surface-page)]">
      <div className="mx-auto max-w-3xl px-4 py-12">
        {/* Back link */}
        <div className="mb-8">
          <Link
            href="/"
            className="text-sm text-[var(--text-link)] underline-offset-2 hover:text-[var(--text-link-hover)] hover:underline"
          >
            ← CFO Lens
          </Link>
        </div>

        {/* Header */}
        <h1 className="text-3xl font-semibold text-[var(--text-primary)]">Privacy Policy</h1>
        <p className="mt-2 text-sm text-[var(--text-muted)]">Last updated: July 2026</p>
        <p className="mt-4 leading-relaxed text-[var(--text-secondary)]">
          CFO Lens connects to your accounting data to deliver financial intelligence. This policy
          explains what information we collect, how we use it, and the rights you have over your
          data.
        </p>

        {/* 1. Information We Collect */}
        <section className="mt-8">
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">
            1. Information We Collect
          </h2>
          <p className="mt-3 leading-relaxed text-[var(--text-secondary)]">
            We collect the following categories of information when you use CFO Lens:
          </p>
          <ul className="mt-3 list-none space-y-3 pl-0">
            <li className="flex gap-2.5 text-[var(--text-secondary)]">
              <span
                className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-muted)]"
                aria-hidden="true"
              />
              <span className="leading-relaxed">
                <strong className="font-medium text-[var(--text-primary)]">Financial data</strong> —
                transactions, chart of accounts, and balance sheet data read from QuickBooks Online
                or Xero, and any CSV files you upload directly.
              </span>
            </li>
            <li className="flex gap-2.5 text-[var(--text-secondary)]">
              <span
                className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-muted)]"
                aria-hidden="true"
              />
              <span className="leading-relaxed">
                <strong className="font-medium text-[var(--text-primary)]">
                  Account information
                </strong>{" "}
                — your work email address, business name, industry, and annual revenue band,
                provided during registration.
              </span>
            </li>
            <li className="flex gap-2.5 text-[var(--text-secondary)]">
              <span
                className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-muted)]"
                aria-hidden="true"
              />
              <span className="leading-relaxed">
                <strong className="font-medium text-[var(--text-primary)]">
                  Conversation history
                </strong>{" "}
                — questions you ask and the AI-generated responses provided in the conversational
                interface.
              </span>
            </li>
            <li className="flex gap-2.5 text-[var(--text-secondary)]">
              <span
                className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-muted)]"
                aria-hidden="true"
              />
              <span className="leading-relaxed">
                <strong className="font-medium text-[var(--text-primary)]">Usage logs</strong> —
                feature interactions, sync event timing, and error logs used to monitor product
                health and diagnose issues. These logs do not include the content of your financial
                data.
              </span>
            </li>
          </ul>
        </section>

        {/* 2. How We Use Your Information */}
        <section className="mt-8 border-t border-[var(--border-default)] pt-8">
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">
            2. How We Use Your Information
          </h2>
          <p className="mt-3 leading-relaxed text-[var(--text-secondary)]">
            Your information is used exclusively to operate and improve CFO Lens:
          </p>
          <ul className="mt-3 list-none space-y-3 pl-0">
            <li className="flex gap-2.5 text-[var(--text-secondary)]">
              <span
                className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-muted)]"
                aria-hidden="true"
              />
              <span className="leading-relaxed">
                Generating the intelligence feed, cash flow projections, anomaly alerts, and AR
                aging analysis.
              </span>
            </li>
            <li className="flex gap-2.5 text-[var(--text-secondary)]">
              <span
                className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-muted)]"
                aria-hidden="true"
              />
              <span className="leading-relaxed">
                Answering your financial questions in the conversational interface.
              </span>
            </li>
            <li className="flex gap-2.5 text-[var(--text-secondary)]">
              <span
                className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-muted)]"
                aria-hidden="true"
              />
              <span className="leading-relaxed">Producing monthly financial reports.</span>
            </li>
            <li className="flex gap-2.5 text-[var(--text-secondary)]">
              <span
                className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-muted)]"
                aria-hidden="true"
              />
              <span className="leading-relaxed">
                Sending alert emails when high or critical severity findings are detected, if you
                have enabled email notifications in Settings → Notifications.
              </span>
            </li>
            <li className="flex gap-2.5 text-[var(--text-secondary)]">
              <span
                className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-muted)]"
                aria-hidden="true"
              />
              <span className="leading-relaxed">
                Improving product reliability using anonymized, aggregated usage patterns.
                Individual financial data is never used to train AI models.
              </span>
            </li>
          </ul>
        </section>

        {/* 3. Data Retention */}
        <section className="mt-8 border-t border-[var(--border-default)] pt-8">
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">3. Data Retention</h2>
          <p className="mt-3 leading-relaxed text-[var(--text-secondary)]">
            We retain your data for as long as your account is active, subject to the following
            category-specific policies:
          </p>
          <ul className="mt-3 list-none space-y-3 pl-0">
            <li className="flex gap-2.5 text-[var(--text-secondary)]">
              <span
                className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-muted)]"
                aria-hidden="true"
              />
              <span className="leading-relaxed">
                <strong className="font-medium text-[var(--text-primary)]">
                  Financial transaction data
                </strong>{" "}
                — retained while your account is active. Deleted within 30 days of account closure.
              </span>
            </li>
            <li className="flex gap-2.5 text-[var(--text-secondary)]">
              <span
                className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-muted)]"
                aria-hidden="true"
              />
              <span className="leading-relaxed">
                <strong className="font-medium text-[var(--text-primary)]">
                  Conversation history
                </strong>{" "}
                — retained on a 12-month rolling window. Conversations older than 12 months are
                automatically and permanently deleted on a monthly schedule. This policy applies to
                all subscription plans and cannot be extended.
              </span>
            </li>
            <li className="flex gap-2.5 text-[var(--text-secondary)]">
              <span
                className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-muted)]"
                aria-hidden="true"
              />
              <span className="leading-relaxed">
                <strong className="font-medium text-[var(--text-primary)]">
                  Account information
                </strong>{" "}
                — retained until you request account deletion.
              </span>
            </li>
            <li className="flex gap-2.5 text-[var(--text-secondary)]">
              <span
                className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-muted)]"
                aria-hidden="true"
              />
              <span className="leading-relaxed">
                <strong className="font-medium text-[var(--text-primary)]">Usage logs</strong> —
                retained for 90 days for operational monitoring, then permanently deleted.
              </span>
            </li>
          </ul>
        </section>

        {/* 4. Third-Party Services */}
        <section className="mt-8 border-t border-[var(--border-default)] pt-8">
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">
            4. Third-Party Services
          </h2>
          <p className="mt-3 leading-relaxed text-[var(--text-secondary)]">
            CFO Lens relies on the following sub-processors to deliver the product. Each has been
            selected for security and compliance with financial-grade data handling standards.
          </p>

          <div className="mt-4 space-y-5">
            <div>
              <h3 className="text-base font-medium text-[var(--text-primary)]">
                Anthropic / Google AI
              </h3>
              <p className="mt-1 leading-relaxed text-[var(--text-secondary)]">
                AI analysis and response generation. When you ask a financial question or the
                intelligence engine generates a finding, a prompt containing a window of your
                transaction context is sent to Anthropic or Google AI. Your financial data is not
                used to train their models. The AI provider used on any given request is governed by
                your plan and current availability.
              </p>
            </div>
            <div>
              <h3 className="text-base font-medium text-[var(--text-primary)]">Supabase</h3>
              <p className="mt-1 leading-relaxed text-[var(--text-secondary)]">
                Database hosting and authentication. Your financial data is stored in an isolated
                tenant with row-level security enforced at the database layer. Supabase is SOC 2
                Type II certified. Authentication is handled via magic-link email — no password is
                ever stored.
              </p>
            </div>
            <div>
              <h3 className="text-base font-medium text-[var(--text-primary)]">Vercel</h3>
              <p className="mt-1 leading-relaxed text-[var(--text-secondary)]">
                Application hosting and edge infrastructure. Vercel processes requests in transit to
                serve the application. It does not retain your financial data beyond request
                processing. All traffic between your browser and Vercel is encrypted in transit
                using TLS 1.3.
              </p>
            </div>
            <div>
              <h3 className="text-base font-medium text-[var(--text-primary)]">Stripe</h3>
              <p className="mt-1 leading-relaxed text-[var(--text-secondary)]">
                Payment processing. Stripe handles all billing transactions. CFO Lens never stores
                your credit card number; we hold only a Stripe customer ID linked to your account.
                Stripe is PCI DSS Level 1 certified.
              </p>
            </div>
          </div>
        </section>

        {/* 5. Data Security */}
        <section className="mt-8 border-t border-[var(--border-default)] pt-8">
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">5. Data Security</h2>
          <p className="mt-3 leading-relaxed text-[var(--text-secondary)]">
            We implement technical and organizational measures to protect your information:
          </p>
          <ul className="mt-3 list-none space-y-3 pl-0">
            <li className="flex gap-2.5 text-[var(--text-secondary)]">
              <span
                className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-muted)]"
                aria-hidden="true"
              />
              <span className="leading-relaxed">
                OAuth tokens (QuickBooks and Xero credentials) are encrypted with AES-256-GCM before
                being stored in the database. Decryption keys are never co-located with the
                database.
              </span>
            </li>
            <li className="flex gap-2.5 text-[var(--text-secondary)]">
              <span
                className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-muted)]"
                aria-hidden="true"
              />
              <span className="leading-relaxed">
                All data is transmitted over TLS 1.3. Plaintext connections are rejected.
              </span>
            </li>
            <li className="flex gap-2.5 text-[var(--text-secondary)]">
              <span
                className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-muted)]"
                aria-hidden="true"
              />
              <span className="leading-relaxed">
                Row-level security policies at the database layer ensure that one organization can
                never read another organization's data — even in the event of an application-layer
                bug.
              </span>
            </li>
            <li className="flex gap-2.5 text-[var(--text-secondary)]">
              <span
                className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-muted)]"
                aria-hidden="true"
              />
              <span className="leading-relaxed">
                QuickBooks and Xero connections use read-only OAuth scopes. CFO Lens cannot write
                to, modify, or delete any records in your accounting system.
              </span>
            </li>
          </ul>
        </section>

        {/* 6. Your Rights */}
        <section className="mt-8 border-t border-[var(--border-default)] pt-8">
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">6. Your Rights</h2>
          <p className="mt-3 leading-relaxed text-[var(--text-secondary)]">
            You have the following rights over your data:
          </p>
          <ul className="mt-3 list-none space-y-3 pl-0">
            <li className="flex gap-2.5 text-[var(--text-secondary)]">
              <span
                className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-muted)]"
                aria-hidden="true"
              />
              <span className="leading-relaxed">
                <strong className="font-medium text-[var(--text-primary)]">Export</strong> —
                download all data CFO Lens has generated about your organization at any time from
                Settings → Account. The export is provided as a structured JSON file.
              </span>
            </li>
            <li className="flex gap-2.5 text-[var(--text-secondary)]">
              <span
                className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-muted)]"
                aria-hidden="true"
              />
              <span className="leading-relaxed">
                <strong className="font-medium text-[var(--text-primary)]">Deletion</strong> —
                request complete account deletion by emailing{" "}
                <a
                  href="mailto:privacy@cfolens.com"
                  className="text-[var(--text-link)] underline underline-offset-2 hover:text-[var(--text-link-hover)]"
                >
                  privacy@cfolens.com
                </a>
                . We will delete all your data within 30 days of the request.
              </span>
            </li>
            <li className="flex gap-2.5 text-[var(--text-secondary)]">
              <span
                className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-muted)]"
                aria-hidden="true"
              />
              <span className="leading-relaxed">
                <strong className="font-medium text-[var(--text-primary)]">Portability</strong> —
                your underlying QuickBooks and Xero accounting records always remain in those
                systems and are completely unaffected by your CFO Lens account status.
              </span>
            </li>
            <li className="flex gap-2.5 text-[var(--text-secondary)]">
              <span
                className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-muted)]"
                aria-hidden="true"
              />
              <span className="leading-relaxed">
                <strong className="font-medium text-[var(--text-primary)]">Correction</strong> —
                update your account information at any time from Settings → Account.
              </span>
            </li>
            <li className="flex gap-2.5 text-[var(--text-secondary)]">
              <span
                className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-muted)]"
                aria-hidden="true"
              />
              <span className="leading-relaxed">
                <strong className="font-medium text-[var(--text-primary)]">Disconnect</strong> —
                remove your QuickBooks or Xero connection at any time from Settings → Connections.
                This stops all future data syncs immediately.
              </span>
            </li>
          </ul>
        </section>

        {/* 7. Cookies and Tracking */}
        <section className="mt-8 border-t border-[var(--border-default)] pt-8">
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">
            7. Cookies and Tracking
          </h2>
          <p className="mt-3 leading-relaxed text-[var(--text-secondary)]">
            CFO Lens uses session cookies to maintain your authenticated state. We do not use
            third-party advertising cookies, behavioral tracking pixels, or cross-site tracking.
            OAuth state and PKCE verifier values are stored in short-lived, HttpOnly,
            SameSite=Strict cookies that expire in two minutes and are never accessible to
            JavaScript.
          </p>
        </section>

        {/* 8. Changes to This Policy */}
        <section className="mt-8 border-t border-[var(--border-default)] pt-8">
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">
            8. Changes to This Policy
          </h2>
          <p className="mt-3 leading-relaxed text-[var(--text-secondary)]">
            We will notify you via email of any material changes to this Privacy Policy at least
            fourteen days before they take effect. The current version is always available at this
            URL. Continued use of the product after the effective date constitutes acceptance of the
            updated policy.
          </p>
        </section>

        {/* 9. Contact */}
        <section className="mt-8 border-t border-[var(--border-default)] pt-8">
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">9. Contact</h2>
          <p className="mt-3 leading-relaxed text-[var(--text-secondary)]">
            Privacy questions or deletion requests:{" "}
            <a
              href="mailto:privacy@cfolens.com"
              className="text-[var(--text-link)] underline underline-offset-2 hover:text-[var(--text-link-hover)]"
            >
              privacy@cfolens.com
            </a>
            . You may also review our{" "}
            <Link
              href="/terms"
              className="text-[var(--text-link)] underline underline-offset-2 hover:text-[var(--text-link-hover)]"
            >
              Terms of Service
            </Link>
            .
          </p>
        </section>

        {/* Footer */}
        <p className="mt-12 text-xs text-[var(--text-muted)]">
          © 2026 CFO Lens. All rights reserved.
        </p>
      </div>
    </div>
  );
}
