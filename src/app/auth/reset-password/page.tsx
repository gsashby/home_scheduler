"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestReset(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { error } = await createClient().auth.resetPasswordForEmail(
      email.trim(),
      { redirectTo: `${window.location.origin}/auth/update-password` },
    );
    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    // Don't reveal whether the email is registered — same message either way.
    setSent(true);
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div>
          <h1 className="text-2xl font-semibold">Reset your password</h1>
          <p className="mt-1 text-sm text-gray-600">
            Enter the email you sign in with and we&rsquo;ll send you a reset
            link.
          </p>
        </div>

        {sent ? (
          <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
            If an account exists for {email.trim()}, a reset link is on its way.
            Check your inbox.
          </p>
        ) : (
          <>
            {error && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}
            <form onSubmit={requestReset} className="space-y-2.5 text-left">
              <input
                type="email"
                required
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-2.5 py-2 text-sm focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100 focus:outline-none"
              />
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? "Sending…" : "Send reset link"}
              </button>
            </form>
          </>
        )}

        <p className="text-sm text-gray-600">
          <Link href="/login" className="font-semibold text-indigo-600">
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
