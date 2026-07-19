import { createClient } from "@/lib/supabase/server";

export default async function CalendarPage() {
  const supabase = await createClient();
  const { data: events } = await supabase
    .from("calendar_events")
    .select(
      "id, title, location, starts_at, ends_at, owner_id, profiles(display_name, color)",
    )
    .order("starts_at", { ascending: true })
    .limit(50);

  return (
    <div>
      <h1 className="text-lg font-semibold">This week</h1>
      <p className="mt-1 text-sm text-gray-500">
        Week-at-a-glance view. Drill-in by day and day/3-day/week toggles are
        next up.
      </p>
      <ul className="mt-4 divide-y divide-gray-200">
        {events?.map((event) => (
          <li key={event.id} className="flex items-center gap-3 py-3">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{
                backgroundColor:
                  (event as { profiles?: { color?: string } }).profiles
                    ?.color ?? "#9ca3af",
              }}
              aria-hidden
            />
            <div>
              <p className="text-sm font-medium">{event.title}</p>
              <p className="text-xs text-gray-500">
                {new Date(event.starts_at).toLocaleString()}
                {event.location ? ` · ${event.location}` : ""}
              </p>
            </div>
          </li>
        ))}
        {!events?.length && (
          <li className="py-3 text-sm text-gray-500">
            No events yet — this is where the shared family calendar will show
            up.
          </li>
        )}
      </ul>
    </div>
  );
}
