"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useFamily } from "@/lib/family-context";
import { useToast } from "@/lib/toast";
import { addDays, fmtDay, fmtTime, mondayOf, parseISODate, relDay, todayISO, toISODate } from "@/lib/date";
import { Button, Card, Chip, Empty, Tag } from "@/components/ui";
import { Field, Modal, Select, TextInput } from "@/components/modal";
import type { Database } from "@/lib/supabase/database.types";

type Event = Database["public"]["Tables"]["calendar_events"]["Row"];
type Task = Database["public"]["Tables"]["tasks"]["Row"];
type CalView = "day" | "3day" | "week";

export default function CalendarPage() {
  const { me, isParent, members, memberById } = useFamily();
  const toast = useToast();
  const [view, setView] = useState<CalView>("week");
  const [anchor, setAnchor] = useState(todayISO());
  const [filter, setFilter] = useState<string | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [modalOpen, setModalOpen] = useState(false);

  const days = useMemo(() => {
    const anchorDate = parseISODate(anchor);
    if (view === "week") {
      const mon = mondayOf(anchorDate);
      return Array.from({ length: 7 }, (_, i) => toISODate(addDays(mon, i)));
    }
    if (view === "3day") {
      return Array.from({ length: 3 }, (_, i) => toISODate(addDays(anchorDate, i)));
    }
    return [anchor];
  }, [view, anchor]);

  async function load() {
    const supabase = createClient();
    const from = days[0];
    const to = days[days.length - 1];
    const [eventsRes, tasksRes] = await Promise.all([
      supabase.from("calendar_events").select("*").gte("date", from).lte("date", to).order("start_time"),
      supabase.from("tasks").select("*").gte("date", from).lte("date", to).neq("status", "verified"),
    ]);
    setEvents(eventsRes.data ?? []);
    setTasks(tasksRes.data ?? []);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days.join(",")]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("calendar-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "calendar_events" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, load)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days.join(",")]);

  function itemsForDay(date: string) {
    let evs = events.filter((e) => e.date === date);
    let tks = tasks.filter((t) => t.date === date);
    if (filter) {
      evs = evs.filter((e) => e.member_id === filter);
      tks = tks.filter((t) => t.member_id === filter);
    }
    return { evs: evs.sort((a, b) => (a.start_time < b.start_time ? -1 : 1)), tks };
  }

  const step = view === "week" ? 7 : view === "3day" ? 3 : 1;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border border-gray-200 bg-white">
          {(["day", "3day", "week"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1.5 text-sm font-semibold ${view === v ? "bg-gray-900 text-white" : "text-gray-500"}`}
            >
              {v === "day" ? "Day" : v === "3day" ? "3-Day" : "Week"}
            </button>
          ))}
        </div>
        <Button size="sm" variant="secondary" onClick={() => setAnchor(toISODate(addDays(parseISODate(anchor), -step)))}>
          ‹
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setAnchor(todayISO())}>
          Today
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setAnchor(toISODate(addDays(parseISODate(anchor), step)))}>
          ›
        </Button>
        <div className="flex-1" />
        <Button size="sm" onClick={() => setModalOpen(true)}>
          + Add event
        </Button>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <Chip active={!filter} onClick={() => setFilter(null)}>
          Everyone
        </Chip>
        {members.map((m) => (
          <Chip key={m.id} active={filter === m.id} color={m.color} onClick={() => setFilter(m.id)}>
            {m.display_name}
          </Chip>
        ))}
      </div>

      {view === "day" ? (
        <DayView date={days[0]} itemsForDay={itemsForDay} memberById={memberById} />
      ) : (
        <>
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0,1fr))` }}
          >
            {days.map((d) => {
              const { evs, tks } = itemsForDay(d);
              const isToday = d === todayISO();
              return (
                <div
                  key={d}
                  onClick={() => {
                    setView("day");
                    setAnchor(d);
                  }}
                  title={`Open ${relDay(d)}`}
                  className={`min-h-[120px] cursor-pointer rounded-lg border bg-white p-2 ${
                    isToday ? "border-indigo-600 ring-1 ring-indigo-600" : "border-gray-200"
                  }`}
                >
                  <h4 className="mb-1.5 flex justify-between text-xs text-gray-500">
                    <b className="text-gray-900">{parseISODate(d).toLocaleDateString(undefined, { weekday: "short" })}</b>
                    <span>{parseISODate(d).getDate()}</span>
                  </h4>
                  {evs.map((e) => (
                    <div
                      key={e.id}
                      className="mb-1 truncate rounded-md px-1.5 py-1 text-[12px] font-semibold leading-tight text-white"
                      style={{ backgroundColor: memberById(e.member_id)?.color }}
                    >
                      {fmtTime(e.start_time)} {e.title}
                      {e.source === "google" && <span className="ml-1 rounded bg-white/35 px-1 text-[9px]">G</span>}
                    </div>
                  ))}
                  {tks.map((t) => (
                    <div
                      key={t.id}
                      className="mb-1 truncate rounded-md px-1.5 py-1 text-[12px] font-semibold leading-tight text-white opacity-90"
                      style={{ backgroundColor: memberById(t.member_id)?.color }}
                    >
                      ☑ {t.title}
                    </div>
                  ))}
                  {evs.length === 0 && tks.length === 0 && <div className="text-[11px] text-gray-400">—</div>}
                </div>
              );
            })}
          </div>
          <div className="mt-1.5 text-xs text-gray-500">
            Tap any day to drill in · ☑ = task · G = synced with Google Calendar
          </div>
        </>
      )}

      <EventModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        defaultDate={view === "day" ? days[0] : todayISO()}
        isParent={isParent}
        me={me}
        members={members}
        onSaved={(memberName) => {
          toast(`Event added for ${memberName}`);
          load();
        }}
      />
    </div>
  );
}

function DayView({
  date,
  itemsForDay,
  memberById,
}: {
  date: string;
  itemsForDay: (d: string) => { evs: Event[]; tks: Task[] };
  memberById: (id: string) => { display_name: string; color: string } | undefined;
}) {
  const { evs, tks } = itemsForDay(date);
  return (
    <Card>
      <h2 className="mb-2 flex items-baseline gap-2 text-[15px] font-semibold">
        {relDay(date)} <span className="text-xs font-normal text-gray-500">{fmtDay(date)}</span>
      </h2>
      {evs.length === 0 && tks.length === 0 && <Empty>Nothing scheduled.</Empty>}
      {evs.map((e) => {
        const owner = memberById(e.member_id);
        return (
          <div key={e.id} className="flex gap-2.5 border-b border-gray-100 py-2">
            <div className="w-16 shrink-0 pt-0.5 text-xs text-gray-500">
              {fmtTime(e.start_time)}–{fmtTime(e.end_time)}
            </div>
            <div className="flex-1 rounded-md px-2.5 py-1.5 text-sm font-semibold text-white" style={{ backgroundColor: owner?.color }}>
              {e.title}
              {e.source === "google" && <Tag tone="green">Google</Tag>}
              <small className="block font-medium opacity-85">{owner?.display_name}</small>
            </div>
          </div>
        );
      })}
      {tks.map((t) => {
        const owner = memberById(t.member_id);
        return (
          <div key={t.id} className="flex gap-2.5 border-b border-gray-100 py-2 last:border-b-0">
            <div className="w-16 shrink-0 pt-0.5 text-xs text-gray-500">{t.deadline ? fmtTime(t.deadline) : "all day"}</div>
            <div className="flex-1 rounded-md px-2.5 py-1.5 text-sm font-semibold text-white opacity-90" style={{ backgroundColor: owner?.color }}>
              ☑ {t.title}
              <small className="block font-medium opacity-85">{owner?.display_name}</small>
            </div>
          </div>
        );
      })}
    </Card>
  );
}

function EventModal({
  open,
  onClose,
  defaultDate,
  isParent,
  me,
  members,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  defaultDate: string;
  isParent: boolean;
  me: { id: string; display_name: string };
  members: { id: string; display_name: string }[];
  onSaved: (memberName: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [ownerId, setOwnerId] = useState(me.id);
  const [date, setDate] = useState(defaultDate);
  const [start, setStart] = useState("16:00");
  const [end, setEnd] = useState("17:00");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle("");
      setOwnerId(me.id);
      setDate(defaultDate);
      setStart("16:00");
      setEnd("17:00");
    }
  }, [open, defaultDate, me.id]);

  async function save() {
    if (!title.trim()) return;
    setSaving(true);
    const supabase = createClient();
    const memberId = isParent ? ownerId : me.id;
    const { error } = await supabase.from("calendar_events").insert({
      title: title.trim(),
      member_id: memberId,
      date,
      start_time: start,
      end_time: end,
      created_by: me.id,
      source: "app",
    });
    setSaving(false);
    if (error) return;
    onClose();
    onSaved(members.find((m) => m.id === memberId)?.display_name ?? "");
  }

  return (
    <Modal open={open} onClose={onClose} title="Add calendar event">
      <Field label="Title">
        <TextInput
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g., Work shift, Practice, Appointment"
        />
      </Field>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Who">
          {isParent ? (
            <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name}
                </option>
              ))}
            </Select>
          ) : (
            <Select disabled value={me.id}>
              <option value={me.id}>{me.display_name} (you)</option>
            </Select>
          )}
        </Field>
        <Field label="Date">
          <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Start">
          <TextInput type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="End">
          <TextInput type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      </div>
      <div className="mt-1.5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={save} disabled={saving}>
          Add event
        </Button>
      </div>
      <p className="mt-2.5 text-xs text-gray-500">
        Google Calendar two-way sync isn&rsquo;t connected yet for this event&rsquo;s owner — see Settings once
        it ships.
      </p>
    </Modal>
  );
}
