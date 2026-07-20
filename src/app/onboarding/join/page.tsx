"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function JoinFamilyPage() {
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setSubmitting(true);
    setError(null);
    const { error } = await createClient().rpc("join_family_by_code", {
      p_code: code.trim(),
    });
    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    window.location.href = "/";
  }

  return (
    <div className="space-y-6 text-center">
      <div>
        <h1 className="text-2xl font-semibold">Join a family</h1>
        <p className="mt-1 text-sm text-gray-600">
          Enter the invite code your family admin shared with you.
          You&rsquo;ll join as a member — an admin can update your role
          afterward from Settings.
        </p>
      </div>
      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <form onSubmit={join} className="space-y-2.5 text-left">
        <input
          type="text"
          required
          placeholder="e.g., MAPLE-2481"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          className="w-full rounded-lg border border-gray-200 px-2.5 py-2 text-center font-mono text-sm tracking-wider uppercase focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-100"
        />
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Joining…" : "Join family"}
        </button>
      </form>
      <p className="text-xs text-gray-500">
        🔒 Private to that family only — joining doesn&rsquo;t give you access
        to any other family&rsquo;s data.
      </p>
    </div>
  );
}
