"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useFamily } from "@/lib/family-context";
import { useToast } from "@/lib/toast";
import { Button, Card, Empty, Swatch, Tag } from "@/components/ui";
import { Field, Modal, Select, TextInput } from "@/components/modal";
import type { CalendarSharing, Database } from "@/lib/supabase/database.types";

type Subject = Database["public"]["Tables"]["subjects"]["Row"];

export default function SettingsPage() {
  const { isParent, members } = useFamily();
  const toast = useToast();
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [subjectModal, setSubjectModal] = useState<Subject | null | "new">(
    null,
  );
  const [loading, setLoading] = useState(true);

  async function load() {
    const { data } = await createClient()
      .from("subjects")
      .select("*")
      .order("position");
    setSubjects(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  if (loading) return null;

  if (!isParent) {
    return (
      <Card>
        <Empty>Settings are managed by parents.</Empty>
      </Card>
    );
  }

  return (
    <div>
      <Card>
        <h2 className="mb-2.5 flex flex-wrap items-center gap-2 text-[15px] font-semibold">
          🔄 Google Calendar sync
          <span className="text-xs font-normal text-gray-500">
            two-way — events created in either system appear in both
          </span>
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500">
                <th className="border-b border-gray-200 px-1.5 py-2 text-left">
                  Person
                </th>
                <th className="border-b border-gray-200 px-1.5 py-2 text-left">
                  Sync
                </th>
                <th className="border-b border-gray-200 px-1.5 py-2 text-left">
                  Calendar shared with
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id}>
                  <td className="border-b border-gray-200 px-1.5 py-2">
                    <span className="flex items-center gap-1.5 font-semibold">
                      <Swatch color={m.color} />
                      {m.display_name}
                    </span>
                  </td>
                  <td className="border-b border-gray-200 px-1.5 py-2">
                    {m.google_sync_enabled ? (
                      <Tag tone="green">Enabled</Tag>
                    ) : (
                      <Tag>Disabled</Tag>
                    )}
                    <Button
                      size="sm"
                      variant="secondary"
                      className="ml-1.5"
                      onClick={async () => {
                        await createClient().rpc("set_member_settings", {
                          p_member_id: m.id,
                          p_google_sync: !m.google_sync_enabled,
                          p_sharing: null,
                        });
                        toast(
                          `${m.display_name}'s Google sync ${!m.google_sync_enabled ? "enabled" : "disabled"}`,
                        );
                      }}
                    >
                      {m.google_sync_enabled ? "Disable" : "Enable"}
                    </Button>
                  </td>
                  <td className="border-b border-gray-200 px-1.5 py-2">
                    <Select
                      className="w-auto py-1"
                      defaultValue={m.calendar_sharing}
                      onChange={async (e) => {
                        await createClient().rpc("set_member_settings", {
                          p_member_id: m.id,
                          p_google_sync: null,
                          p_sharing: e.target.value as CalendarSharing,
                        });
                        toast(
                          `${m.display_name}'s calendar now shared with: ${e.target.value}`,
                        );
                      }}
                    >
                      <option value="family">Whole family</option>
                      <option value="parents">Parents only</option>
                      <option value="private">Just me</option>
                    </Select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-gray-500">
          These control who a person&rsquo;s Google Calendar is shared with once
          it&rsquo;s connected. Connecting a real Google account (OAuth) is the
          next piece of this build — see the README build status.
        </p>
      </Card>

      <Card>
        <h2 className="mb-2.5 flex flex-wrap items-center gap-2 text-[15px] font-semibold">
          📚 School subjects
          <span className="text-xs font-normal text-gray-500">
            used as School categories on tasks
          </span>
        </h2>
        {subjects.length === 0 ? (
          <Empty>No subjects defined.</Empty>
        ) : (
          subjects.map((s) => (
            <div
              key={s.id}
              className="mb-1.5 flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3"
            >
              <div className="flex-1 font-bold">{s.name}</div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setSubjectModal(s)}
              >
                ✎ Edit
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={async () => {
                  await createClient().from("subjects").delete().eq("id", s.id);
                  toast(`"${s.name}" removed`);
                  load();
                }}
              >
                ✕
              </Button>
            </div>
          ))
        )}
        <div className="mt-3">
          <Button size="sm" onClick={() => setSubjectModal("new")}>
            + Add subject
          </Button>
        </div>
        <p className="mt-2 text-sm text-gray-500">
          Tasks using a deleted subject show as &ldquo;School · Other&rdquo;.
        </p>
      </Card>

      <Card>
        <h2 className="mb-2.5 text-[15px] font-semibold">🔔 Notifications</h2>
        <div className="text-sm leading-7 text-gray-500">
          ① <b>Daily brief</b> — every morning at 7:00 AM (or on-demand from
          Today as a parent)
          <br />② <b>Deadline alerts</b> — a set time before a task&rsquo;s
          deadline (per-task setting)
          <br />③ <b>Parent nudge</b> — on-demand, from any task card (parents
          only)
        </div>
        <p className="mt-2.5 text-sm text-gray-500">
          Delivered as free web push (works on iPhone for installed web apps) —
          no App Store or paid developer account needed.
        </p>
      </Card>

      <SubjectModal
        subject={subjectModal}
        onClose={() => setSubjectModal(null)}
        onSaved={() => {
          load();
        }}
      />
    </div>
  );
}

function SubjectModal({
  subject,
  onClose,
  onSaved,
}: {
  subject: Subject | null | "new";
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const open = subject !== null;
  const isNew = subject === "new";

  useEffect(() => {
    if (subject && subject !== "new") setName(subject.name);
    else if (subject === "new") setName("");
  }, [subject]);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    const supabase = createClient();
    const { error } = isNew
      ? await supabase.from("subjects").insert({ name: name.trim() })
      : await supabase
          .from("subjects")
          .update({ name: name.trim() })
          .eq("id", (subject as Subject).id);
    setSaving(false);
    if (error) return;
    onClose();
    onSaved();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isNew ? "Add a school subject" : "Edit subject"}
    >
      <Field label="Subject name">
        <TextInput
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., History, Welding, Spanish"
        />
      </Field>
      <div className="mt-1.5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={save} disabled={saving}>
          {isNew ? "Add" : "Save"}
        </Button>
      </div>
    </Modal>
  );
}
