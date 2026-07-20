// Called by the family_invites_send_invite Postgres trigger (see
// supabase/migrations/20260719130000_family_invites.sql, extended for
// family scoping in 20260720000002_family_invites_generalize.sql) whenever
// a family admin creates a pending row in public.family_invites. Delivers
// the actual invite email via Supabase Auth's admin invite API — no
// third-party email service needed, so this stays inside the app's
// $0-cost stack.
//
// The invite link points at /auth/confirm (see
// supabase/templates/invite.html), which verifies the token server-side and
// signs the person in with no family joined yet (handle_new_user() already
// gave them a profiles row with family_id = null). From there,
// accept_family_invite() (called by src/app/(app)/layout.tsx via the
// onboarding gate on first load) matches their email against this pending
// invite and joins them into the invite's specific family.
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

interface RequestBody {
  invite_id: string;
  email: string;
  display_name: string;
  invited_by_name: string | null;
  family_name: string | null;
}

export default {
  fetch: withSupabase({ auth: "secret" }, async (req, ctx) => {
    const { email, display_name, invited_by_name, family_name } =
      (await req.json()) as RequestBody;

    const siteUrl = Deno.env.get("SITE_URL");
    if (!siteUrl) {
      return Response.json(
        { error: "SITE_URL secret is not set for this Edge Function" },
        { status: 500 },
      );
    }

    const { error } = await ctx.supabaseAdmin.auth.admin.inviteUserByEmail(
      email,
      {
        redirectTo: `${siteUrl}/auth/confirm?next=/`,
        data: {
          display_name,
          invited_by_name,
          family_name,
        },
      },
    );

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }
    return Response.json({ sent: true });
  }),
};
