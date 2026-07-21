// Client-side CSV/ICS export. Everything exported here is already
// RLS-scoped to the caller's own family — these helpers just format data
// already in memory and trigger a browser download; no server round-trip.
import { addDays, parseISODate, toISODate } from "@/lib/date";

export function downloadFile(
  filename: string,
  content: string,
  mimeType: string,
) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function csvEscape(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV<T>(
  rows: T[],
  columns: { header: string; value: (row: T) => string | number | null }[],
): string {
  const header = columns.map((c) => csvEscape(c.header)).join(",");
  const lines = rows.map((row) =>
    columns.map((c) => csvEscape(c.value(row))).join(","),
  );
  return [header, ...lines].join("\r\n") + "\r\n";
}

export interface ICSEvent {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  startTime: string; // Postgres time, "HH:MM:SS"
  endTime: string;
  allDay: boolean;
  location?: string | null;
  notes?: string | null;
  organizer?: string | null;
}

function icsEscape(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function icsDate(isoDate: string): string {
  return isoDate.replace(/-/g, "");
}

function icsDateTime(isoDate: string, time: string): string {
  return `${icsDate(isoDate)}T${time.replace(/:/g, "").slice(0, 6)}`;
}

function icsUTCStamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

// Events have no stored timezone (the whole app assumes one family-local
// timezone — see 05-notifications-and-push.md), so times are emitted as
// floating local time (no TZID/Z suffix): the imported event shows the
// same wall-clock time regardless of the importing device's timezone.
// Lines aren't folded at 75 octets per RFC 5545 §3.1 — titles/notes here
// are short enough in practice that every mainstream calendar app (Google,
// Apple, Outlook) still imports them fine unfolded.
export function toICS(calendarName: string, events: ICSEvent[]): string {
  const dtstamp = icsUTCStamp(new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Home Scheduler//Export//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${icsEscape(calendarName)}`,
  ];

  for (const e of events) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${e.id}@home-scheduler`);
    lines.push(`DTSTAMP:${dtstamp}`);
    if (e.allDay) {
      const nextDay = toISODate(addDays(parseISODate(e.date), 1));
      lines.push(`DTSTART;VALUE=DATE:${icsDate(e.date)}`);
      lines.push(`DTEND;VALUE=DATE:${icsDate(nextDay)}`);
    } else {
      lines.push(`DTSTART:${icsDateTime(e.date, e.startTime)}`);
      lines.push(`DTEND:${icsDateTime(e.date, e.endTime)}`);
    }
    lines.push(`SUMMARY:${icsEscape(e.title)}`);
    if (e.location) lines.push(`LOCATION:${icsEscape(e.location)}`);
    const description = [
      e.organizer ? `Assigned to: ${e.organizer}` : null,
      e.notes,
    ]
      .filter(Boolean)
      .join("\n");
    if (description) lines.push(`DESCRIPTION:${icsEscape(description)}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
