import { createClient } from "@/lib/supabase/server";

export default async function ZonesPage() {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: zones } = await supabase
    .from("zones")
    .select(
      "id, name, zone_assignments(profile_id, starts_on, ends_on, profiles(display_name, color))",
    )
    .order("name", { ascending: true });

  return (
    <div>
      <h1 className="text-lg font-semibold">Chore zones</h1>
      <p className="mt-1 text-sm text-gray-500">
        Rotates among family members on a configurable interval (default
        weekly).
      </p>
      <ul className="mt-4 divide-y divide-gray-200">
        {zones?.map((zone) => {
          type Assignment = {
            profile_id: string;
            starts_on: string;
            ends_on: string;
            profiles?: { display_name?: string; color?: string };
          };
          const current = (zone.zone_assignments as Assignment[] | null)?.find(
            (a) => a.starts_on <= today && today <= a.ends_on,
          );
          return (
            <li key={zone.id} className="flex items-center gap-3 py-3">
              <div className="flex-1">
                <p className="text-sm font-medium">{zone.name}</p>
                <p className="text-xs text-gray-500">
                  {current
                    ? `Assigned to ${current.profiles?.display_name ?? "someone"}`
                    : "Unassigned this period"}
                </p>
              </div>
              {current?.profiles?.color && (
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: current.profiles.color }}
                  aria-hidden
                />
              )}
            </li>
          );
        })}
        {!zones?.length && (
          <li className="py-3 text-sm text-gray-500">
            No zones yet — define home areas here and rotate who&rsquo;s
            responsible.
          </li>
        )}
      </ul>
    </div>
  );
}
