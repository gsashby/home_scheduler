"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Status = "checking" | "ready" | "no-session" | "saved";

export default function UpdatePasswordPage() {
  const [status, setStatus] = useState<Status>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data: { user } }) => {
        setStatus(user ? "ready" : "no-session");
      });
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    const { error } = await createClient().auth.updateUser({ password });
    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    setStatus("saved");
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div>
          <h1 className="text-2xl font-semibold">Set a new password</h1>
        </div>

        {status === "checking" && (
          <p className="text-sm text-gray-600">Checking your reset link…</p>
        )}

        {status === "no-session" && (
          <>
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              This reset link is invalid or has expired.
            </p>
            <p className="text-sm text-gray-600">
              <Link
                href="/auth/reset-password"
                className="font-semibold text-indigo-600"
              >
                Request a new reset link
              </Link>
            </p>
          </>
        )}

        {status === "saved" && (
          <>
            <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
              Your password has been updated.
            </p>
            <p className="text-sm text-gray-600">
              <Link href="/" className="font-semibold text-indigo-600">
                Continue to Home Scheduler
              </Link>
            </p>
          </>
        )}

        {status === "ready" && (
          <>
            {error && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}
            <form onSubmit={save} className="space-y-2.5 text-left">
              <input
                type="password"
                required
                minLength={8}
                placeholder="New password (min. 8 characters)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-2.5 py-2 text-sm focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100 focus:outline-none"
              />
              <input
                type="password"
                required
                minLength={8}
                placeholder="Confirm new password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-2.5 py-2 text-sm focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100 focus:outline-none"
              />
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? "Saving…" : "Save new password"}
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
