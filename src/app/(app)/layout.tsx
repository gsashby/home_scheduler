import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { FamilyProvider } from "@/lib/family-context";
import { ToastProvider } from "@/lib/toast";
import { Shell } from "@/components/shell";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: me } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  // handle_new_user() (see supabase/migrations/20260720000001_multi_tenant_families.sql)
  // creates this row for every signup, password or Google — if it's
  // missing here, something upstream of onboarding is broken, not the
  // normal "hasn't picked a family yet" state.
  if (!me) {
    redirect("/auth/error?reason=missing_profile");
  }

  let familyId = me.family_id;
  if (!familyId) {
    // A pending email invite (Settings → Invite a family member, or the
    // post-create-family step) should auto-join the invitee instead of
    // sending them through the generic create-or-join onboarding flow.
    // accept_family_invite() raises (data null, error set) when there's
    // no pending invite for this account's email — that's the normal
    // case for an organic signup, so fall through to onboarding.
    const { data: joinedProfile } = await supabase.rpc("accept_family_invite");
    if (!joinedProfile?.family_id) {
      redirect("/onboarding/choose");
    }
    familyId = joinedProfile.family_id;
  }

  const [{ data: family }, { data: members }] = await Promise.all([
    supabase.from("families").select("*").eq("id", familyId).single(),
    supabase
      .from("profiles")
      .select("*")
      .eq("family_id", familyId)
      .order("created_at"),
  ]);

  if (!family) {
    redirect("/onboarding/choose");
  }

  return (
    <ToastProvider>
      <FamilyProvider meId={user.id} initialMembers={members ?? []} family={family}>
        <Shell>{children}</Shell>
      </FamilyProvider>
    </ToastProvider>
  );
}
