// Date helpers matching the prototype's date math exactly (plain calendar
// dates, no timezone handling — single-household, single-timezone app).

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseISODate(isoStr: string): Date {
  const [y, m, d] = isoStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function today(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function todayISO(): string {
  return toISODate(today());
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function dISO(n: number): string {
  return toISODate(addDays(today(), n));
}

export function mondayOf(d: Date): Date {
  const x = new Date(d);
  const wd = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - wd);
  return x;
}

export function fmtDay(isoStr: string): string {
  return parseISODate(isoStr).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function relDay(isoStr: string): string {
  const t = todayISO();
  if (isoStr === t) return "Today";
  if (isoStr === dISO(1)) return "Tomorrow";
  if (isoStr === dISO(-1)) return "Yesterday";
  return fmtDay(isoStr);
}

// "16:00:00" (Postgres time) -> "16:00"
export function fmtTime(t: string | null): string {
  if (!t) return "";
  return t.slice(0, 5);
}
