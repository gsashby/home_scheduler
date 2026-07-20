import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Central onboarding gate: mirrors (app)/layout.tsx's gate in the other
// direction. No user -> /login. Already has a family -> can't re-enter
// onboarding, back to the app.
export default async function OnboardingLayout({
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
    .select("family_id")
    .eq("id", user.id)
    .maybeSingle();

  if (me?.family_id) {
    redirect("/");
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
