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

  if (!me.family_id) {
    redirect("/onboarding/choose");
  }

  const [{ data: family }, { data: members }] = await Promise.all([
    supabase.from("families").select("*").eq("id", me.family_id).single(),
    supabase
      .from("profiles")
      .select("*")
      .eq("family_id", me.family_id)
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
