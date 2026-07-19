"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useFamily } from "@/lib/family-context";
import { useToast } from "@/lib/toast";
import { todayISO, fmtDay, fmtTime } from "@/lib/date";
import { Button, Card, Empty, Swatch, Tag } from "@/components/ui";
import type { Database } from "@/lib/supabase/database.types";

type Event = Database["public"]["Tables"]["calendar_events"]["Row"];
type Task = Database["public"]["Tables"]["tasks"]["Row"];
type ZoneWithAssignee =
  Database["public"]["Functions"]["zones_with_assignee"]["Returns"][number];

export default function TodayPage() {
  const { me, isParent, memberById } = useFamily();
  const toast = useToast();
  const [events, setEvents] = useState<Event[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [zones, setZones] = useState<ZoneWithAssignee[]>([]);
  const [briefSentToday, setBriefSentToday] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    const supabase = createClient();
    const t = todayISO();
    const [eventsRes, tasksRes, zonesRes, briefRes] = await Promise.all([
      supabase
        .from("calendar_events")
        .select("*")
        .eq("date", t)
        .order("start_time"),
      supabase
        .from("tasks")
        .select("*")
        .lte("date", t)
        .neq("status", "verified"),
      supabase.rpc("zones_with_assignee"),
      supabase
        .from("notifications")
        .select("id")
        .eq("to_profile_id", me.id)
        .eq("kind", "brief")
        .gte(
          "created_at",
          new Date(new Date().setHours(0, 0, 0, 0)).toISOString(),
        )
        .limit(1),
    ]);
    setEvents(eventsRes.data ?? []);
    setTasks(tasksRes.data ?? []);
    setZones(zonesRes.data ?? []);
    setBriefSentToday((briefRes.data?.length ?? 0) > 0);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function sendBriefAll() {
    const { error } = await createClient().rpc("send_daily_brief_all");
    if (error) {
      toast(error.message);
      return;
    }
    setBriefSentToday(true);
    toast("Daily brief sent to all 5 family members");
  }

  if (loading) return null;

  const myEvents = events.filter((e) => e.member_id === me.id);
  const otherEvents = events.filter((e) => e.member_id !== me.id);
  const myTasks = tasks.filter((t) => t.member_id === me.id);
  const myZones = zones.filter((z) => z.assignee_id === me.id);

  return (
    <div>
      <Card>
        <h2 className="mb-2.5 flex flex-wrap items-center gap-2 text-[15px] font-semibold">
          ☀️ Daily brief — {fmtDay(todayISO())}
          <span className="text-xs font-normal text-gray-600">
            what&rsquo;s going on today for {me.display_name}
          </span>
        </h2>
        {myEvents.length === 0 &&
          myTasks.length === 0 &&
          myZones.length === 0 && <Empty>Nothing on your plate today 🎉</Empty>}
        {myEvents.map((e) => (
          <BriefLine key={e.id} color={me.color} time={fmtTime(e.start_time)}>
            <b>{e.title}</b> — {me.display_name}
            {e.source === "google" && <Tag tone="green">Google</Tag>}
          </BriefLine>
        ))}
        {myTasks.map((t) => (
          <BriefLine
            key={t.id}
            color={me.color}
            time={t.deadline ? `by ${fmtTime(t.deadline)}` : "today"}
          >
            <b>{t.title}</b>
            {t.date < todayISO() && (
              <span className="ml-1 font-bold text-red-600">overdue</span>
            )}
          </BriefLine>
        ))}
        {myZones.map((z) => (
          <BriefLine key={z.id} color={me.color} time="zone">
            <b>{z.name}</b> is your zone this week
          </BriefLine>
        ))}
      </Card>

      <Card>
        <h2 className="mb-2.5 text-[15px] font-semibold">
          👨‍👩‍👧‍👦 Where everyone is today
        </h2>
        {otherEvents.length === 0 ? (
          <Empty>No one else has events today.</Empty>
        ) : (
          otherEvents.map((e) => {
            const owner = memberById(e.member_id);
            return (
              <BriefLine
                key={e.id}
                color={owner?.color ?? "#9ca3af"}
                time={fmtTime(e.start_time)}
              >
                <b>{e.title}</b> — {owner?.display_name}
                {e.source === "google" && <Tag tone="green">Google</Tag>}
              </BriefLine>
            );
          })
        )}
      </Card>

      {isParent && (
        <Card>
          <h2 className="mb-2.5 text-[15px] font-semibold">📣 Parent tools</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={sendBriefAll}>Send daily brief to everyone</Button>
            <span className="text-sm text-gray-600">
              {briefSentToday
                ? "✓ Brief already sent today (fires automatically at 7:00 AM)"
                : "Fires automatically each morning at 7:00 AM."}
            </span>
          </div>
        </Card>
      )}
    </div>
  );
}

function BriefLine({
  color,
  time,
  children,
}: {
  color: string;
  time: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 border-b border-gray-100 py-2 text-sm last:border-b-0">
      <Swatch color={color} size={11} />
      <span className="w-16 shrink-0 text-xs text-gray-600">{time}</span>
      <span className="flex items-center gap-1.5">{children}</span>
    </div>
  );
}
