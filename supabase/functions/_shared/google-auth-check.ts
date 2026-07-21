// Shared authorization check for the Google Calendar management endpoints
// (list/select) — callable by the target profile themselves, or by a
// parent in the same family. Mirrors set_member_settings()'s "parent
// required" rule (see supabase/migrations/20260719000001_init_schema.sql),
// generalized to also allow self-service since each member connects their
// own account.
// deno-lint-ignore no-explicit-any
export async function authorizeGoogleCalendarCaller(
  supabaseAdmin: any,
  callerId: string,
  targetProfileId: string,
): Promise<boolean> {
  if (callerId === targetProfileId) return true;

  const [{ data: caller }, { data: target }] = (await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("family_id, role")
      .eq("id", callerId)
      .maybeSingle(),
    supabaseAdmin
      .from("profiles")
      .select("family_id")
      .eq("id", targetProfileId)
      .maybeSingle(),
  ])) as [
    { data: { family_id: string | null; role: string } | null },
    { data: { family_id: string | null } | null },
  ];

  if (!caller || !target || caller.family_id !== target.family_id) return false;
  return caller.role === "parent";
}
