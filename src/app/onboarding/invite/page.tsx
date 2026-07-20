"use client";

import { useState } from "react";
import { InviteForm } from "@/components/invite-form";

export default function InviteMembersPage() {
  const [sentTo, setSentTo] = useState<string[]>([]);

  function goToApp() {
    window.location.href = "/";
  }

  return (
    <div className="space-y-6 text-center">
      <div>
        <h1 className="text-2xl font-semibold">Invite your family</h1>
        <p className="mt-1 text-sm text-gray-600">
          Send an email invite now, or skip this and invite people later from
          Settings.
        </p>
      </div>

      {sentTo.length > 0 && (
        <ul className="space-y-1 text-left text-sm text-gray-600">
          {sentTo.map((email) => (
            <li key={email}>✓ Invited {email}</li>
          ))}
        </ul>
      )}

      <div className="text-left">
        <InviteForm
          submitLabel="Send invite"
          onSent={(email) => setSentTo((prev) => [...prev, email])}
        />
      </div>

      <button
        type="button"
        onClick={goToApp}
        className="text-sm font-semibold text-indigo-600"
      >
        {sentTo.length > 0 ? "Done — go to my family" : "Skip for now"}
      </button>
    </div>
  );
}
