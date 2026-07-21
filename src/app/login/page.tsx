"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [denied, setDenied] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDenied(
      new URLSearchParams(window.location.search).get("denied") === "1",
    );
  }, []);

  const signInWithGoogle = async () => {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  };

  const signInWithPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setSigningIn(true);
    setError(null);
    const { error } = await createClient().auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setSigningIn(false);
    if (error) {
      setError(error.message);
      return;
    }
    window.location.href = "/";
  };

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div>
          <h1 className="text-2xl font-semibold">Home Scheduler</h1>
          <p className="mt-1 text-sm text-gray-600">
            The family calendar, tasks, and chore zones — all in one place.
          </p>
        </div>
        {denied && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            That account isn&rsquo;t set up as a family member on this app.
          </p>
        )}
        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={signInWithGoogle}
          className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          Sign in with Google
        </button>

        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span className="h-px flex-1 bg-gray-200" />
          or sign in with email
          <span className="h-px flex-1 bg-gray-200" />
        </div>

        <form onSubmit={signInWithPassword} className="space-y-2.5 text-left">
          <input
            type="email"
            required
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-2.5 py-2 text-sm focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100 focus:outline-none"
          />
          <input
            type="password"
            required
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-2.5 py-2 text-sm focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100 focus:outline-none"
          />
          <button
            type="submit"
            disabled={signingIn}
            className="w-full rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {signingIn ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="text-sm text-gray-600">
          New here?{" "}
          <Link href="/signup" className="font-semibold text-indigo-600">
            Create an account
          </Link>
        </p>
        <p className="text-xs text-gray-500">
          <Link
            href="/auth/reset-password"
            className="font-semibold text-indigo-600"
          >
            Forgot your password?
          </Link>
        </p>
      </div>
    </main>
  );
}
