"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/lib/toast";
import { Button, Card, Empty, Tag } from "@/components/ui";
import type { Profile } from "@/lib/family-context";

interface GoogleCalendarOption {
  id: string;
  name: string;
  primary: boolean;
  enabled: boolean;
  is_export_target: boolean;
}

type Status = "loading" | "disconnected" | "connected" | "error";

export function GoogleCalendarCard({ me }: { me: Profile }) {
  const toast = useToast();
  const [status, setStatus] = useState<Status>("loading");
  const [calendars, setCalendars] = useState<GoogleCalendarOption[]>([]);
  const [busy, setBusy] = useState(false);

  async function load() {
    setStatus("loading");
    const { data, error } = await createClient().functions.invoke<{
      connected: boolean;
      calendars?: GoogleCalendarOption[];
    }>("google-calendar-list");
    if (error || !data) {
      setStatus("error");
      return;
    }
    if (!data.connected) {
      setStatus("disconnected");
      return;
    }
    setCalendars(data.calendars ?? []);
    setStatus("connected");
  }

  useEffect(() => {
    load();
  }, []);

  async function connect() {
    setBusy(true);
    const { data, error } = await createClient().functions.invoke<{
      url: string;
    }>("google-calendar-connect");
    setBusy(false);
    if (error || !data?.url) {
      toast("Couldn't start the Google Calendar connection");
      return;
    }
    window.location.href = data.url;
  }

  async function save() {
    setBusy(true);
    const { error } = await createClient().functions.invoke(
      "google-calendar-select",
      { body: { calendars } },
    );
    setBusy(false);
    if (error) {
      toast("Couldn't save your calendar selection");
      return;
    }
    toast("Google Calendar selection saved");
  }

  async function disconnect() {
    setBusy(true);
    const { error } = await createClient().functions.invoke(
      "google-calendar-select",
      { body: { disconnect: true } },
    );
    setBusy(false);
    if (error) {
      toast("Couldn't disconnect Google Calendar");
      return;
    }
    toast("Google Calendar disconnected");
    setCalendars([]);
    setStatus("disconnected");
  }

  function toggleEnabled(id: string, enabled: boolean) {
    setCalendars((prev) =>
      prev.map((c) => (c.id === id ? { ...c, enabled } : c)),
    );
  }

  function setExportTarget(id: string) {
    setCalendars((prev) =>
      prev.map((c) => ({ ...c, is_export_target: c.id === id })),
    );
  }

  return (
    <Card>
      <h2 className="mb-2.5 flex flex-wrap items-center gap-2 text-[15px] font-semibold">
        🔗 My Google Calendar
        <span className="text-xs font-normal text-gray-600">
          {me.display_name} — import selected calendars, two-way sync
        </span>
      </h2>

      {status === "loading" && (
        <p className="text-sm text-gray-600">Checking connection…</p>
      )}

      {status === "error" && (
        <Empty>Couldn&rsquo;t check your Google Calendar connection.</Empty>
      )}

      {status === "disconnected" && (
        <div>
          <Empty>Not connected yet.</Empty>
          <div className="mt-3">
            <Button size="sm" onClick={connect} disabled={busy}>
              Connect Google Calendar
            </Button>
          </div>
        </div>
      )}

      {status === "connected" && (
        <div>
          {calendars.length === 0 ? (
            <Empty>No calendars found on this Google account.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-600">
                    <th className="border-b border-gray-200 px-1.5 py-2 text-left">
                      Calendar
                    </th>
                    <th className="border-b border-gray-200 px-1.5 py-2 text-left">
                      Import
                    </th>
                    <th className="border-b border-gray-200 px-1.5 py-2 text-left">
                      Use for new events
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {calendars.map((cal) => (
                    <tr key={cal.id}>
                      <td className="border-b border-gray-200 px-1.5 py-2">
                        {cal.name}{" "}
                        {cal.primary && <Tag tone="green">primary</Tag>}
                      </td>
                      <td className="border-b border-gray-200 px-1.5 py-2">
                        <input
                          type="checkbox"
                          checked={cal.enabled}
                          onChange={(e) =>
                            toggleEnabled(cal.id, e.target.checked)
                          }
                        />
                      </td>
                      <td className="border-b border-gray-200 px-1.5 py-2">
                        <input
                          type="radio"
                          name="google-export-target"
                          checked={cal.is_export_target}
                          onChange={() => setExportTarget(cal.id)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={save} disabled={busy}>
              Save
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={disconnect}
              disabled={busy}
            >
              Disconnect
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
