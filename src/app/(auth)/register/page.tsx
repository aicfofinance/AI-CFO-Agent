"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import { createClientClient } from "@/lib/platform/auth/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// ---------------------------------------------------------------------------
// Inner component — must be in Suspense because it reads useSearchParams
// ---------------------------------------------------------------------------

function RegisterForm(): React.JSX.Element {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const isBenchSource = searchParams.get("source") === "bench";

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const supabase = createClientClient();

      // Include source=bench in the redirect URL so the callback can route
      // returning Bench refugees to the migration onboarding path.
      const redirectTo =
        window.location.origin + "/api/auth/callback" + (isBenchSource ? "?source=bench" : "");

      const { error: authError } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: redirectTo,
        },
      });

      if (authError !== null) {
        setError(authError.message);
        return;
      }

      router.push(`/check-email?email=${encodeURIComponent(email)}`);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--surface-page)] px-4">
      <div className="w-full max-w-sm">
        {/* App identity */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">CFO Lens</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            AI-powered financial intelligence for growing businesses
          </p>
        </div>

        {/* Data sovereignty notice — shown only for Bench refugees */}
        {isBenchSource && (
          <div
            className="mb-4 flex items-start gap-2 rounded-lg border border-primary-200 bg-primary-50 px-4 py-3"
            role="note"
            aria-label="Data sovereignty notice"
          >
            <ShieldCheck
              size={16}
              className="mt-0.5 shrink-0 text-primary-500"
              aria-hidden="true"
            />
            <p className="text-[0.8125rem] leading-[1.6] text-[var(--text-primary)]">
              Your data is yours. We read your QuickBooks or Xero data but never write to it. If you
              leave, your books are 100% intact.
            </p>
          </div>
        )}

        <div className="rounded-lg border border-[var(--border-default)] bg-white p-6 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="email"
                className="block text-xs font-medium text-[var(--text-secondary)]"
              >
                Work email address
              </label>
              <Input
                id="email"
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full"
              />
            </div>

            {error !== null && (
              <p className="text-sm text-loss-600" role="alert">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Sending…" : "Get started"}
            </Button>

            <p className="text-center text-xs text-[var(--text-muted)]">
              We'll send a magic link — no password required.
            </p>
          </form>

          <p className="mt-4 text-center text-sm text-[var(--text-secondary)]">
            {"Already have an account? "}
            <Link
              href="/login"
              className="text-[var(--text-link)] underline-offset-2 hover:text-[var(--text-link-hover)] hover:underline"
            >
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Page — wraps RegisterForm in Suspense required by useSearchParams
// ---------------------------------------------------------------------------

export default function RegisterPage(): React.JSX.Element {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
