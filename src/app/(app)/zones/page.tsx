"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useFamily } from "@/lib/family-context";
import { useToast } from "@/lib/toast";
import { relDay } from "@/lib/date";
import { Button, Card, Empty, StatusBadge, Swatch } from "@/components/ui";
import { Field, Modal, Select, TextArea, TextInput } from "@/components/modal";
import type { Database } from "@/lib/supabase/database.types";

type ZoneWithAssignee =
  Database["public"]["Functions"]["zones_with_assignee"]["Returns"][number];
type Rotation = Database["public"]["Tables"]["zone_rotation"]["Row"];
type Task = Database["public"]["Tables"]["tasks"]["Row"];

export default function ZonesPage() {
  const { isParent, memberById } = useFamily();
  const toast = useToast();
  const [zones, setZones] = useState<ZoneWithAssignee[]>([]);
  const [rotation, setRotation] = useState<Rotation | null>(null);
  const [cycleTasks, setCycleTasks] = useState<Task[]>([]);
  const [nextRotation, setNextRotation] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingZone, setEditingZone] = useState<
    ZoneWithAssignee | null | "new"
  >(null);

  async function load() {
    const supabase = createClient();
    const [zonesRes, rotationRes, nextRes, cycleRes] = await Promise.all([
      supabase.rpc("zones_with_assignee"),
      supabase.from("zone_rotation").select("*").maybeSingle(),
      supabase.rpc("next_rotation_date"),
      supabase
        .from("tasks")
        .select("*")
        .not("zone_id", "is", null)
        .neq("status", "verified"),
    ]);
    setZones(zonesRes.data ?? []);
    setRotation(rotationRes.data ?? null);
    setNextRotation(nextRes.data ?? null);
    setCycleTasks(cycleRes.data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const supabase = createClient();
    const channel = supabase
      .channel("zones-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "zones" },
        load,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "zone_rotation" },
        load,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tasks" },
        load,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  if (loading) return null;

  if (!isParent) {
    return (
      <Card>
        <Empty>
          Zone management is a parent function. Your zone shows up on your task
          list.
        </Empty>
      </Card>
    );
  }

  const rotLabel =
    !rotation || rotation.interval_days == null
      ? "manual rotation"
      : `rotate every ${rotation.interval_days} day${rotation.interval_days > 1 ? "s" : ""}`;
  const nextLabel = nextRotation
    ? relDay(nextRotation)
    : "when you press Rotate now";

  return (
    <Card>
      <h2 className="mb-1 flex flex-wrap items-center gap-2 text-[15px] font-semibold">
        🧹 Chore zones
        <span className="text-xs font-normal text-gray-500">
          parent-managed · {rotLabel} · next rotation: {nextLabel}
        </span>
      </h2>
      <p className="mb-2.5 text-sm text-gray-500">
        Each zone appears automatically on the assigned person&rsquo;s task
        list, with its areas as subtasks.
      </p>

      {zones.length === 0 && <Empty>No zones defined yet.</Empty>}

      {zones.map((z) => {
        const assignee = z.assignee_id ? memberById(z.assignee_id) : undefined;
        const zt = cycleTasks.find((t) => t.zone_id === z.id);
        return (
          <div
            key={z.id}
            className="mb-2 flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3"
          >
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2 font-bold">
                {z.name}
                {zt ? (
                  <StatusBadge status={zt.status} />
                ) : (
                  <StatusBadge status="verified" />
                )}
              </div>
              <div className="mt-0.5 text-sm text-gray-500">
                {z.subzones.length
                  ? `Areas: ${z.subzones.join(" · ")}`
                  : "No sub-areas defined"}
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-sm font-semibold">
              {assignee && <Swatch color={assignee.color} size={12} />}
              <Select
                className="w-auto py-1"
                value={z.assigned_to ?? ""}
                onChange={async (e) => {
                  const value = e.target.value || null;
                  await createClient().rpc("set_zone_assignee", {
                    p_zone_id: z.id,
                    p_member_id: value,
                  });
                  toast(
                    value
                      ? `${z.name} pinned to ${memberById(value)?.display_name}`
                      : `${z.name} back in the rotation`,
                  );
                  load();
                }}
              >
                <option value="">
                  ↻ Rotation
                  {!z.assigned_to && assignee
                    ? ` (${assignee.display_name})`
                    : ""}
                </option>
                {(rotation?.member_order ?? []).map((mid) => (
                  <option key={mid} value={mid}>
                    📌 {memberById(mid)?.display_name}
                  </option>
                ))}
              </Select>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setEditingZone(z)}
            >
              ✎ Edit
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={async () => {
                await createClient().rpc("delete_zone", { p_zone_id: z.id });
                toast(`"${z.name}" removed from the rotation`);
                load();
              }}
            >
              ✕
            </Button>
          </div>
        );
      })}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => setEditingZone("new")}>
          + Add zone
        </Button>
        <Button
          size="sm"
          onClick={async () => {
            await createClient().rpc("rotate_now");
            toast("Zones rotated");
            load();
          }}
        >
          ↻ Rotate now
        </Button>
        <label className="flex items-center gap-1.5 text-sm text-gray-500">
          Interval:
          <Select
            className="w-auto py-1"
            value={
              rotation?.interval_days == null
                ? "manual"
                : String(rotation.interval_days)
            }
            onChange={async (e) => {
              const v = e.target.value;
              await createClient().rpc("set_zone_interval", {
                p_interval_days: v === "manual" ? null : Number(v),
              });
              toast(
                v === "manual"
                  ? 'Rotation set to manual — use "Rotate now"'
                  : "Rotation interval updated",
              );
              load();
            }}
          >
            <option value="manual">Manual (rotate by hand)</option>
            <option value="3">3 days</option>
            <option value="7">1 week (default)</option>
            <option value="14">14 days</option>
          </Select>
        </label>
      </div>
      <p className="mt-2 text-sm text-gray-500">
        📌 pins a zone to one person (skips rotation) · ↻ Rotation rotates it
        among{" "}
        {(rotation?.member_order ?? [])
          .map((mid) => memberById(mid)?.display_name)
          .join(", ")}
        .
      </p>

      <ZoneModal
        zone={editingZone}
        onClose={() => setEditingZone(null)}
        onSaved={() => {
          load();
        }}
      />
    </Card>
  );
}

function ZoneModal({
  zone,
  onClose,
  onSaved,
}: {
  zone: ZoneWithAssignee | null | "new";
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [subzonesText, setSubzonesText] = useState("");
  const [saving, setSaving] = useState(false);
  const open = zone !== null;
  const isNew = zone === "new";

  useEffect(() => {
    if (zone && zone !== "new") {
      setName(zone.name);
      setSubzonesText(zone.subzones.join("\n"));
    } else if (zone === "new") {
      setName("");
      setSubzonesText("");
    }
  }, [zone]);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    const subzones = subzonesText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const { error } = await createClient().rpc("save_zone", {
      p_zone_id: isNew ? null : (zone as ZoneWithAssignee).id,
      p_name: name.trim(),
      p_subzones: subzones,
    });
    setSaving(false);
    if (error) return;
    onClose();
    onSaved();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isNew ? "Add a zone" : "Edit zone"}
    >
      <Field label="Zone name">
        <TextInput
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., Kitchen, Garage, Backyard"
        />
      </Field>
      <Field label="Sub-areas (one per line — become subtasks on the assignee's list)">
        <TextArea
          rows={4}
          value={subzonesText}
          onChange={(e) => setSubzonesText(e.target.value)}
          placeholder={"Dishes & counters\nSweep floor\nTake out trash"}
        />
      </Field>
      <div className="mt-1.5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={save} disabled={saving}>
          {isNew ? "Add zone" : "Save"}
        </Button>
      </div>
      {isNew && (
        <p className="mt-2.5 text-xs text-gray-500">
          New zones join the rotation immediately and appear on the
          assignee&rsquo;s task list.
        </p>
      )}
    </Modal>
  );
}
