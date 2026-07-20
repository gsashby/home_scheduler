"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function CreateFamilyPage() {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    const { error } = await createClient().rpc("create_family", {
      p_name: name.trim(),
    });
    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    window.location.href = "/onboarding/invite";
  }

  return (
    <div className="space-y-6 text-center">
      <div>
        <h1 className="text-2xl font-semibold">Name your family</h1>
        <p className="mt-1 text-sm text-gray-600">
          You&rsquo;ll be the family admin — you can invite others and manage
          the invite code any time from Settings.
        </p>
      </div>
      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      <form onSubmit={create} className="space-y-2.5 text-left">
        <input
          type="text"
          required
          placeholder="e.g., The Petersons"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg border border-gray-200 px-2.5 py-2 text-sm focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-100"
        />
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Creating…" : "Create family"}
        </button>
      </form>
      <p className="text-xs text-gray-500">
        🔒 Private to your family — no other family can see or access this
        data.
      </p>
    </div>
  );
}
