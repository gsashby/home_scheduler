// Shared date/time conversion between Google Calendar's event resource
// shape (RFC3339 dateTime + IANA timeZone, or a bare date for all-day
// events) and this app's calendar_events columns (separate date/start_time/
// end_time, no timezone — the whole schema assumes the database's own
// timezone IS the household's local time, see
// supabase/migrations/20260719120000_web_push_cron.sql).
export const HOUSEHOLD_TZ = "America/Denver";

export function toHouseholdLocalParts(iso: string): {
  date: string;
  time: string;
} {
  const dt = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: HOUSEHOLD_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(dt);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  // Some ICU implementations emit "24" for midnight under hour12: false.
  const hour = get("hour") === "24" ? "00" : get("hour");
  return { date, time: `${hour}:${get("minute")}:${get("second")}` };
}

export interface GoogleEventTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

// All-day Google events only carry a date — approximate as spanning the
// whole day in the app's date/start_time/end_time model, which has no
// separate concept of an all-day event.
export function fromGoogleEventTime(
  start: GoogleEventTime,
  end: GoogleEventTime,
): { date: string; startTime: string; endTime: string } {
  if (start.date) {
    return { date: start.date, startTime: "00:00:00", endTime: "23:59:00" };
  }
  const startLocal = toHouseholdLocalParts(start.dateTime!);
  const endLocal = end.dateTime
    ? toHouseholdLocalParts(end.dateTime)
    : startLocal;
  return {
    date: startLocal.date,
    startTime: startLocal.time,
    endTime: endLocal.time,
  };
}

export function toGoogleEventTime(date: string, time: string): GoogleEventTime {
  return { dateTime: `${date}T${time}`, timeZone: HOUSEHOLD_TZ };
}
