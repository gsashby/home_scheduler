"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui";
import { Field, Select, TextInput } from "@/components/modal";
import type { FamilyRole } from "@/lib/supabase/database.types";

const INVITE_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

// Shared by the Settings "Invite a family member" card and the onboarding
// "invite members" step — both just need to collect email/name/role/color
// and call create_family_invite(). The RPC itself is admin-gated and
// family-scoped server-side (see
// supabase/migrations/20260720000002_family_invites_generalize.sql), so
// this component doesn't need to know or care which context it's in.
export function InviteForm({
  onSent,
  onCancel,
  submitLabel = "Send invite",
}: {
  onSent: (email: string) => void;
  onCancel?: () => void;
  submitLabel?: string;
}) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<FamilyRole>("kid");
  const [color, setColor] = useState(INVITE_COLORS[0]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!email.trim() || !displayName.trim()) return;
    setSending(true);
    setError(null);
    const { error } = await createClient().rpc("create_family_invite", {
      p_email: email.trim(),
      p_display_name: displayName.trim(),
      p_role: role,
      p_color: color,
    });
    setSending(false);
    if (error) {
      setError(error.message);
      return;
    }
    const sentEmail = email.trim();
    setEmail("");
    setDisplayName("");
    setRole("kid");
    setColor(INVITE_COLORS[0]);
    onSent(sentEmail);
  }

  return (
    <div>
      <Field label="Email address">
        <TextInput
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@example.com"
        />
      </Field>
      <Field label="Name">
        <TextInput
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="e.g., Alex"
        />
      </Field>
      <Field label="Role">
        <Select
          value={role}
          onChange={(e) => setRole(e.target.value as FamilyRole)}
        >
          <option value="kid">Kid</option>
          <option value="parent">Parent</option>
        </Select>
      </Field>
      <Field label="Color">
        <div className="flex flex-wrap gap-2">
          {INVITE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className={`h-7 w-7 rounded-full ${
                color === c ? "ring-2 ring-gray-900 ring-offset-2" : ""
              }`}
              style={{ backgroundColor: c }}
              aria-label={c}
            />
          ))}
        </div>
      </Field>
      {error && <p className="mb-2.5 text-sm text-red-600">{error}</p>}
      <div className="mt-1.5 flex justify-end gap-2">
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button onClick={send} disabled={sending}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
