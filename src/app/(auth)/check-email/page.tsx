"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Inner component — must be in Suspense because it reads useSearchParams
// ---------------------------------------------------------------------------

function CheckEmailContent(): React.JSX.Element {
  const searchParams = useSearchParams();
  const email = searchParams.get("email");

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--surface-page)] px-4">
      <div className="w-full max-w-sm text-center">
        {/* App identity */}
        <h1 className="mb-8 text-2xl font-semibold text-[var(--text-primary)]">CFO Lens</h1>

        <div className="rounded-lg border border-[var(--border-default)] bg-white p-8 shadow-sm">
          {/* Mail icon — decorative */}
          <div
            className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary-50"
            aria-hidden="true"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-primary-500"
              aria-hidden="true"
            >
              <rect width="20" height="16" x="2" y="4" rx="2" />
              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
            </svg>
          </div>

          <h2 className="text-xl font-semibold text-[var(--text-primary)]">Check your email</h2>

          <p className="mt-3 text-sm text-[var(--text-secondary)]">
            {email !== null ? (
              <>
                We sent a magic link to{" "}
                <span className="font-medium text-[var(--text-primary)]">{email}</span>. Click the
                link to sign in.
              </>
            ) : (
              "We sent a magic link to your email address. Click the link to sign in."
            )}
          </p>

          <p className="mt-2 text-xs text-[var(--text-muted)]">
            The link expires in 1 hour. Check your spam folder if you don't see it.
          </p>

          <div className="mt-6 border-t border-[var(--border-subtle)] pt-4">
            <Link
              href="/login"
              className="text-sm text-[var(--text-link)] underline-offset-2 hover:text-[var(--text-link-hover)] hover:underline"
            >
              Wrong email? Go back
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Page — wraps content in Suspense required by useSearchParams
// ---------------------------------------------------------------------------

export default function CheckEmailPage(): React.JSX.Element {
  return (
    <Suspense>
      <CheckEmailContent />
    </Suspense>
  );
}
