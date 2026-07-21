"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useFamily } from "@/lib/family-context";
import { useToast } from "@/lib/toast";
import {
  addDays,
  fmtDay,
  fmtTime,
  mondayOf,
  parseISODate,
  relDay,
  todayISO,
  toISODate,
} from "@/lib/date";
import { Button, Card, Chip, Empty, Tag } from "@/components/ui";
import { Field, Modal, Select, TextArea, TextInput } from "@/components/modal";
import type { Database } from "@/lib/supabase/database.types";

type Event = Database["public"]["Tables"]["calendar_events"]["Row"];
type Task = Database["public"]["Tables"]["tasks"]["Row"];
type CalView = "day" | "3day" | "week";
type AttendeesByEvent = Record<string, string[]>;

export default function CalendarPage() {
  const { me, isParent, members, memberById } = useFamily();
  const toast = useToast();
  const [view, setView] = useState<CalView>("week");
  const [anchor, setAnchor] = useState(todayISO());
  const [filter, setFilter] = useState<string | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [attendeesByEvent, setAttendeesByEvent] = useState<AttendeesByEvent>(
    {},
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [newEventDate, setNewEventDate] = useState<string | null>(null);

  const days = useMemo(() => {
    const anchorDate = parseISODate(anchor);
    if (view === "week") {
      const mon = mondayOf(anchorDate);
      return Array.from({ length: 7 }, (_, i) => toISODate(addDays(mon, i)));
    }
    if (view === "3day") {
      return Array.from({ length: 3 }, (_, i) =>
        toISODate(addDays(anchorDate, i)),
      );
    }
    return [anchor];
  }, [view, anchor]);

  async function load() {
    const supabase = createClient();
    const from = days[0];
    const to = days[days.length - 1];
    const [eventsRes, tasksRes] = await Promise.all([
      supabase
        .from("calendar_events")
        .select("*")
        .gte("date", from)
        .lte("date", to)
        .order("start_time"),
      supabase
        .from("tasks")
        .select("*")
        .gte("date", from)
        .lte("date", to)
        .neq("status", "verified"),
    ]);
    setEvents(eventsRes.data ?? []);
    setTasks(tasksRes.data ?? []);

    const eventIds = (eventsRes.data ?? []).map((e) => e.id);
    if (eventIds.length === 0) {
      setAttendeesByEvent({});
      return;
    }
    const attendeesRes = await supabase
      .from("calendar_event_attendees")
      .select("event_id, member_id")
      .in("event_id", eventIds);
    const map: AttendeesByEvent = {};
    for (const row of attendeesRes.data ?? []) {
      (map[row.event_id] ??= []).push(row.member_id);
    }
    setAttendeesByEvent(map);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days.join(",")]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("calendar-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "calendar_events" },
        load,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tasks" },
        load,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "calendar_event_attendees" },
        load,
      )
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
      evs = evs.filter(
        (e) =>
          e.member_id === filter ||
          (attendeesByEvent[e.id] ?? []).includes(filter),
      );
      tks = tks.filter((t) => t.member_id === filter);
    }
    return {
      evs: evs.sort((a, b) => (a.start_time < b.start_time ? -1 : 1)),
      tks,
    };
  }

  function openNewEvent(date: string) {
    setEditingEvent(null);
    setNewEventDate(date);
    setModalOpen(true);
  }

  function openEditEvent(event: Event) {
    setEditingEvent(event);
    setNewEventDate(null);
    setModalOpen(true);
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
              className={`px-3 py-1.5 text-sm font-semibold ${view === v ? "bg-gray-900 text-white" : "text-gray-600"}`}
            >
              {v === "day" ? "Day" : v === "3day" ? "3-Day" : "Week"}
            </button>
          ))}
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            setAnchor(toISODate(addDays(parseISODate(anchor), -step)))
          }
        >
          ‹
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setAnchor(todayISO())}
        >
          Today
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            setAnchor(toISODate(addDays(parseISODate(anchor), step)))
          }
        >
          ›
        </Button>
        <div className="flex-1" />
        <Button
          size="sm"
          onClick={() => openNewEvent(view === "day" ? days[0] : todayISO())}
        >
          + Add event
        </Button>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <Chip active={!filter} onClick={() => setFilter(null)}>
          Everyone
        </Chip>
        {members.map((m) => (
          <Chip
            key={m.id}
            active={filter === m.id}
            color={m.color}
            onClick={() => setFilter(m.id)}
          >
            {m.display_name}
          </Chip>
        ))}
      </div>

      {view === "day" ? (
        <DayView
          date={days[0]}
          itemsForDay={itemsForDay}
          memberById={memberById}
          attendeesByEvent={attendeesByEvent}
          onSelectEvent={openEditEvent}
        />
      ) : (
        <>
          <div
            className="grid gap-2"
            style={{
              gridTemplateColumns: `repeat(${days.length}, minmax(0,1fr))`,
            }}
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
                    isToday
                      ? "border-indigo-600 ring-1 ring-indigo-600"
                      : "border-gray-200"
                  }`}
                >
                  <h4 className="mb-1.5 flex justify-between text-xs text-gray-600">
                    <b className="text-gray-900">
                      {parseISODate(d).toLocaleDateString(undefined, {
                        weekday: "short",
                      })}
                    </b>
                    <span>{parseISODate(d).getDate()}</span>
                  </h4>
                  {evs.map((e) => {
                    const shareCount = (attendeesByEvent[e.id] ?? []).filter(
                      (id) => id !== e.member_id,
                    ).length;
                    return (
                      <div
                        key={e.id}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          openEditEvent(e);
                        }}
                        className="mb-1 truncate rounded-md px-1.5 py-1 text-[12px] leading-tight font-semibold text-white"
                        style={{
                          backgroundColor: memberById(e.member_id)?.color,
                        }}
                      >
                        {e.all_day ? "All day" : fmtTime(e.start_time)}{" "}
                        {e.title}
                        {e.source === "google" && (
                          <span className="ml-1 rounded bg-white/35 px-1 text-[9px]">
                            G
                          </span>
                        )}
                        {shareCount > 0 && (
                          <span className="ml-1 rounded bg-white/35 px-1 text-[9px]">
                            +{shareCount}
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {tks.map((t) => (
                    <div
                      key={t.id}
                      className="mb-1 truncate rounded-md px-1.5 py-1 text-[12px] leading-tight font-semibold text-white opacity-90"
                      style={{
                        backgroundColor: memberById(t.member_id)?.color,
                      }}
                    >
                      ☑ {t.title}
                    </div>
                  ))}
                  {evs.length === 0 && tks.length === 0 && (
                    <div className="text-[11px] text-gray-500">—</div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-1.5 text-xs text-gray-600">
            Tap any day to drill in · tap an event to edit · ☑ = task · G =
            synced with Google Calendar · +N = also shared with N others
          </div>
        </>
      )}

      <EventModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        event={editingEvent}
        initialAttendeeIds={
          editingEvent ? (attendeesByEvent[editingEvent.id] ?? []) : []
        }
        defaultDate={newEventDate ?? (view === "day" ? days[0] : todayISO())}
        isParent={isParent}
        me={me}
        members={members}
        onSaved={(memberName, wasEdit) => {
          toast(wasEdit ? "Event updated" : `Event added for ${memberName}`);
          load();
        }}
        onDeleted={() => {
          toast("Event deleted");
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
  attendeesByEvent,
  onSelectEvent,
}: {
  date: string;
  itemsForDay: (d: string) => { evs: Event[]; tks: Task[] };
  memberById: (
    id: string,
  ) => { display_name: string; color: string } | undefined;
  attendeesByEvent: AttendeesByEvent;
  onSelectEvent: (event: Event) => void;
}) {
  const { evs, tks } = itemsForDay(date);
  return (
    <Card>
      <h2 className="mb-2 flex items-baseline gap-2 text-[15px] font-semibold">
        {relDay(date)}{" "}
        <span className="text-xs font-normal text-gray-600">
          {fmtDay(date)}
        </span>
      </h2>
      {evs.length === 0 && tks.length === 0 && (
        <Empty>Nothing scheduled.</Empty>
      )}
      {evs.map((e) => {
        const owner = memberById(e.member_id);
        const others = (attendeesByEvent[e.id] ?? [])
          .filter((id) => id !== e.member_id)
          .map((id) => memberById(id)?.display_name)
          .filter(Boolean);
        return (
          <div
            key={e.id}
            onClick={() => onSelectEvent(e)}
            className="flex cursor-pointer gap-2.5 border-b border-gray-100 py-2"
          >
            <div className="w-16 shrink-0 pt-0.5 text-xs text-gray-600">
              {e.all_day
                ? "All day"
                : `${fmtTime(e.start_time)}–${fmtTime(e.end_time)}`}
            </div>
            <div
              className="flex-1 rounded-md px-2.5 py-1.5 text-sm font-semibold text-white"
              style={{ backgroundColor: owner?.color }}
            >
              {e.title}
              {e.source === "google" && <Tag tone="green">Google</Tag>}
              <small className="block font-medium opacity-85">
                {owner?.display_name}
                {others.length > 0 && ` · shared with ${others.join(", ")}`}
              </small>
              {e.location && (
                <small className="block font-medium opacity-85">
                  📍 {e.location}
                </small>
              )}
              {e.notes && (
                <small className="block font-normal opacity-85">
                  {e.notes}
                </small>
              )}
            </div>
          </div>
        );
      })}
      {tks.map((t) => {
        const owner = memberById(t.member_id);
        return (
          <div
            key={t.id}
            className="flex gap-2.5 border-b border-gray-100 py-2 last:border-b-0"
          >
            <div className="w-16 shrink-0 pt-0.5 text-xs text-gray-600">
              {t.deadline ? fmtTime(t.deadline) : "all day"}
            </div>
            <div
              className="flex-1 rounded-md px-2.5 py-1.5 text-sm font-semibold text-white opacity-90"
              style={{ backgroundColor: owner?.color }}
            >
              ☑ {t.title}
              <small className="block font-medium opacity-85">
                {owner?.display_name}
              </small>
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
  event,
  initialAttendeeIds,
  defaultDate,
  isParent,
  me,
  members,
  onSaved,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  event: Event | null;
  initialAttendeeIds: string[];
  defaultDate: string;
  isParent: boolean;
  me: { id: string; display_name: string };
  members: { id: string; display_name: string }[];
  onSaved: (memberName: string, wasEdit: boolean) => void;
  onDeleted: () => void;
}) {
  const [title, setTitle] = useState("");
  const [ownerId, setOwnerId] = useState(me.id);
  const [date, setDate] = useState(defaultDate);
  const [start, setStart] = useState("16:00");
  const [end, setEnd] = useState("17:00");
  const [allDay, setAllDay] = useState(false);
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [shareWith, setShareWith] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const canEdit = !event || isParent || event.member_id === me.id;

  useEffect(() => {
    if (!open) return;
    if (event) {
      setTitle(event.title);
      setOwnerId(event.member_id);
      setDate(event.date);
      setStart(fmtTime(event.start_time) || "16:00");
      setEnd(fmtTime(event.end_time) || "17:00");
      setAllDay(event.all_day);
      setLocation(event.location ?? "");
      setNotes(event.notes ?? "");
      setShareWith(initialAttendeeIds);
    } else {
      setTitle("");
      setOwnerId(me.id);
      setDate(defaultDate);
      setStart("16:00");
      setEnd("17:00");
      setAllDay(false);
      setLocation("");
      setNotes("");
      setShareWith([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, event, defaultDate, me.id]);

  function toggleShare(memberId: string) {
    setShareWith((prev) =>
      prev.includes(memberId)
        ? prev.filter((id) => id !== memberId)
        : [...prev, memberId],
    );
  }

  async function save() {
    if (!title.trim()) return;
    setSaving(true);
    const supabase = createClient();
    const memberId = isParent ? ownerId : me.id;
    const payload = {
      title: title.trim(),
      member_id: memberId,
      date,
      start_time: allDay ? "00:00" : start,
      end_time: allDay ? "23:59" : end,
      all_day: allDay,
      location: location.trim() || null,
      notes: notes.trim() || null,
    };

    let eventId = event?.id;
    if (event) {
      const { error } = await supabase
        .from("calendar_events")
        .update(payload)
        .eq("id", event.id);
      if (error) {
        setSaving(false);
        return;
      }
    } else {
      const { data, error } = await supabase
        .from("calendar_events")
        .insert({ ...payload, created_by: me.id, source: "app" })
        .select("id")
        .single();
      if (error || !data) {
        setSaving(false);
        return;
      }
      eventId = data.id;
    }

    const desired = new Set(shareWith.filter((id) => id !== memberId));
    const initial = new Set(initialAttendeeIds.filter((id) => id !== memberId));
    const toAdd = [...desired].filter((id) => !initial.has(id));
    const toRemove = [...initial].filter((id) => !desired.has(id));
    if (toAdd.length > 0) {
      await supabase
        .from("calendar_event_attendees")
        .insert(toAdd.map((id) => ({ event_id: eventId!, member_id: id })));
    }
    if (toRemove.length > 0) {
      await supabase
        .from("calendar_event_attendees")
        .delete()
        .eq("event_id", eventId!)
        .in("member_id", toRemove);
    }

    setSaving(false);
    onClose();
    onSaved(
      members.find((m) => m.id === memberId)?.display_name ?? "",
      !!event,
    );
  }

  async function remove() {
    if (!event) return;
    setSaving(true);
    const supabase = createClient();
    await supabase.from("calendar_events").delete().eq("id", event.id);
    setSaving(false);
    onClose();
    onDeleted();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={event ? "Edit event" : "Add calendar event"}
    >
      <Field label="Title">
        <TextInput
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g., Work shift, Practice, Appointment"
          disabled={!canEdit}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Who">
          {isParent ? (
            <Select
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
              disabled={!canEdit}
            >
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
          <TextInput
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={!canEdit}
          />
        </Field>
      </div>
      <label className="mb-2.5 flex items-center gap-2 text-xs font-semibold text-gray-600">
        <input
          type="checkbox"
          checked={allDay}
          onChange={(e) => setAllDay(e.target.checked)}
          disabled={!canEdit}
        />
        All-day event
      </label>
      {!allDay && (
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Start">
            <TextInput
              type="time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              disabled={!canEdit}
            />
          </Field>
          <Field label="End">
            <TextInput
              type="time"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              disabled={!canEdit}
            />
          </Field>
        </div>
      )}
      <Field label="Location (optional)">
        <TextInput
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="e.g., School gym, Grandma's house"
          disabled={!canEdit}
        />
      </Field>
      <Field label="Notes (optional)">
        <TextArea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Anything else the family should know"
          disabled={!canEdit}
        />
      </Field>
      {members.filter((m) => m.id !== ownerId).length > 0 && (
        <Field label="Share with (optional)">
          <div className="flex flex-wrap gap-1.5">
            {members
              .filter((m) => m.id !== ownerId)
              .map((m) => (
                <Chip
                  key={m.id}
                  active={shareWith.includes(m.id)}
                  onClick={() => canEdit && toggleShare(m.id)}
                  className={!canEdit ? "cursor-not-allowed opacity-60" : ""}
                >
                  {m.display_name}
                </Chip>
              ))}
          </div>
        </Field>
      )}
      {!canEdit && (
        <p className="mt-1 mb-2.5 text-xs text-gray-600">
          Only {members.find((m) => m.id === event?.member_id)?.display_name} or
          a parent can edit this event.
        </p>
      )}
      <div className="mt-1.5 flex justify-end gap-2">
        {event && canEdit && (
          <Button variant="danger" onClick={remove} disabled={saving}>
            Delete
          </Button>
        )}
        <div className="flex-1" />
        <Button variant="secondary" onClick={onClose}>
          {canEdit ? "Cancel" : "Close"}
        </Button>
        {canEdit && (
          <Button onClick={save} disabled={saving}>
            {event ? "Save changes" : "Add event"}
          </Button>
        )}
      </div>
      {canEdit && (
        <p className="mt-2.5 text-xs text-gray-600">
          If this event&rsquo;s owner has Google Calendar connected with a
          two-way sync target set (see Settings), this event will sync there
          automatically.
        </p>
      )}
    </Modal>
  );
}
