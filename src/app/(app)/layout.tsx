import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { FamilyProvider } from "@/lib/family-context";
import { ToastProvider } from "@/lib/toast";
import { Shell } from "@/components/shell";

export default async function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: members } = await supabase.from("profiles").select("*").order("created_at");

  // No row in profiles means this Google account isn't one of the 5 family
  // members — is_member() denies everything server-side too, so there's
  // nothing useful to render here.
  if (!members?.some((m) => m.id === user.id)) {
    redirect("/login?denied=1");
  }

  return (
    <ToastProvider>
      <FamilyProvider meId={user.id} initialMembers={members}>
        <Shell>{children}</Shell>
      </FamilyProvider>
    </ToastProvider>
  );
}
