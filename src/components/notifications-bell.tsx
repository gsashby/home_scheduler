"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useFamily } from "@/lib/family-context";
import { NOTIF_KIND_LABELS } from "@/lib/notifications";
import type { Database } from "@/lib/supabase/database.types";
import { Button, Empty } from "@/components/ui";

type Notification = Database["public"]["Tables"]["notifications"]["Row"];

export function NotificationsBell() {
  const { me } = useFamily();
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    supabase
      .from("notifications")
      .select("*")
      .eq("to_profile_id", me.id)
      .order("created_at", { ascending: false })
      .limit(100)
      .then(({ data }) => {
        if (!cancelled && data) setNotifs(data);
      });

    const channel = supabase
      .channel(`notifications-${me.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `to_profile_id=eq.${me.id}`,
        },
        (payload) =>
          setNotifs((prev) => [payload.new as Notification, ...prev]),
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "notifications",
          filter: `to_profile_id=eq.${me.id}`,
        },
        (payload) =>
          setNotifs((prev) =>
            prev.map((n) =>
              n.id === payload.new.id ? (payload.new as Notification) : n,
            ),
          ),
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [me.id]);

  const unread = notifs.filter((n) => !n.read).length;

  async function markAllRead() {
    setNotifs((prev) => prev.map((n) => ({ ...n, read: true })));
    await createClient().rpc("mark_all_read");
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Notifications"
        className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-lg"
      >
        🔔
        {unread > 0 && (
          <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/35"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="absolute inset-y-0 right-0 w-full max-w-[400px] overflow-y-auto bg-white p-4 shadow-2xl">
            <div className="mb-3 flex items-center gap-2">
              <h2 className="flex-1 text-base font-semibold">Notifications</h2>
              <Button size="sm" variant="secondary" onClick={markAllRead}>
                Mark all read
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setOpen(false)}
              >
                ✕
              </Button>
            </div>
            {notifs.length === 0 ? (
              <Empty>No notifications for {me.display_name} yet.</Empty>
            ) : (
              notifs.map((n) => (
                <div
                  key={n.id}
                  className={`mb-2 rounded-lg border px-3 py-2.5 text-sm ${
                    n.read
                      ? "border-gray-200"
                      : "border-l-4 border-y-gray-200 border-r-gray-200 border-l-indigo-600 bg-indigo-50"
                  }`}
                >
                  <div className="text-[10px] font-bold tracking-wide text-indigo-600 uppercase">
                    {NOTIF_KIND_LABELS[n.kind]}
                  </div>
                  {n.text}
                  <div className="mt-0.5 text-[11px] text-gray-500">
                    {new Date(n.created_at).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}
