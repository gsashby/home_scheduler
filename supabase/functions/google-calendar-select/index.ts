// Called by the Settings page to save which Google calendars a member has
// selected for import (and which one, if any, app-created events should be
// pushed to), or to disconnect the account entirely.
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { authorizeGoogleCalendarCaller } from "../_shared/google-auth-check.ts";

const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

interface CalendarSelection {
  id: string;
  name: string;
  color?: string | null;
  enabled: boolean;
  is_export_target: boolean;
}

interface RequestBody {
  profile_id?: string;
  disconnect?: boolean;
  calendars?: CalendarSelection[];
}

export default {
  fetch: withSupabase<any>({ auth: "user" }, async (req, ctx) => {
    const body = (await req.json().catch(() => ({}))) as RequestBody;
    const profileId = body.profile_id ?? ctx.userClaims!.id;

    const authorized = await authorizeGoogleCalendarCaller(
      ctx.supabaseAdmin,
      ctx.userClaims!.id,
      profileId,
    );
    if (!authorized) {
      return Response.json({ error: "Not allowed" }, { status: 403 });
    }

    if (body.disconnect) {
      const { data: tokenRow } = await ctx.supabaseAdmin
        .from("google_tokens")
        .select("refresh_token")
        .eq("profile_id", profileId)
        .maybeSingle();

      if (tokenRow) {
        // Best-effort — an already-revoked/expired token shouldn't block
        // cleaning up our own tables.
        await fetch(
          `${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(tokenRow.refresh_token)}`,
          { method: "POST" },
        ).catch((err) => console.error("Google token revoke failed:", err));
      }

      await ctx.supabaseAdmin
        .from("google_calendar_subscriptions")
        .delete()
        .eq("profile_id", profileId);
      await ctx.supabaseAdmin
        .from("google_tokens")
        .delete()
        .eq("profile_id", profileId);

      return Response.json({ disconnected: true });
    }

    const calendars = body.calendars ?? [];
    const exportTargets = calendars.filter((c) => c.is_export_target);
    if (exportTargets.length > 1) {
      return Response.json(
        { error: "Only one calendar can be the export target" },
        { status: 400 },
      );
    }

    const { data: profile, error: profileErr } = await ctx.supabaseAdmin
      .from("profiles")
      .select("family_id")
      .eq("id", profileId)
      .maybeSingle();
    if (profileErr || !profile?.family_id) {
      return Response.json({ error: "Family not found" }, { status: 404 });
    }

    // Clear export-target flags first so the per-profile partial unique
    // index (at most one is_export_target per profile) can't momentarily
    // collide with the upsert below when the target calendar changes.
    await ctx.supabaseAdmin
      .from("google_calendar_subscriptions")
      .update({ is_export_target: false })
      .eq("profile_id", profileId);

    for (const cal of calendars) {
      const { error } = await ctx.supabaseAdmin
        .from("google_calendar_subscriptions")
        .upsert(
          {
            profile_id: profileId,
            family_id: profile.family_id,
            google_calendar_id: cal.id,
            calendar_name: cal.name,
            color: cal.color ?? null,
            enabled: cal.enabled,
            is_export_target: cal.is_export_target,
          },
          { onConflict: "profile_id,google_calendar_id" },
        );
      if (error) {
        return Response.json({ error: error.message }, { status: 500 });
      }
    }

    return Response.json({ saved: true });
  }),
};
