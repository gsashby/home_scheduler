// Called by the Settings page once a member has connected Google Calendar,
// to populate the "which calendars do you want to import" checklist.
// Fetches the member's Google calendarList live (not cached) and merges in
// which ones are already selected (google_calendar_subscriptions).
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { authorizeGoogleCalendarCaller } from "../_shared/google-auth-check.ts";
import { getValidAccessToken } from "../_shared/google-tokens.ts";

const CALENDAR_LIST_URL =
  "https://www.googleapis.com/calendar/v3/users/me/calendarList";

interface RequestBody {
  profile_id?: string;
}

interface GoogleCalendarListEntry {
  id: string;
  summary?: string;
  primary?: boolean;
}

async function fetchAllCalendars(
  accessToken: string,
): Promise<{ items?: GoogleCalendarListEntry[]; error?: string }> {
  const items: GoogleCalendarListEntry[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(CALENDAR_LIST_URL);
    url.searchParams.set("maxResults", "250");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      return { error: `Google Calendar API error: ${await res.text()}` };
    }
    const body = (await res.json()) as {
      items?: GoogleCalendarListEntry[];
      nextPageToken?: string;
    };
    items.push(...(body.items ?? []));
    pageToken = body.nextPageToken;
  } while (pageToken);

  return { items };
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

    const tokenResult = await getValidAccessToken(ctx.supabaseAdmin, profileId);
    if (!tokenResult.ok) {
      return Response.json({ connected: false, error: tokenResult.error });
    }

    const { items, error } = await fetchAllCalendars(tokenResult.accessToken);
    if (error) {
      return Response.json({ error }, { status: 502 });
    }

    const { data: subscriptions } = await ctx.supabaseAdmin
      .from("google_calendar_subscriptions")
      .select("google_calendar_id, enabled, is_export_target")
      .eq("profile_id", profileId);

    const byCalendarId = new Map(
      (subscriptions ?? []).map((s) => [s.google_calendar_id, s]),
    );

    const calendars = (items ?? []).map((cal) => {
      const existing = byCalendarId.get(cal.id);
      return {
        id: cal.id,
        name: cal.summary ?? cal.id,
        primary: cal.primary ?? false,
        enabled: existing?.enabled ?? false,
        is_export_target: existing?.is_export_target ?? false,
      };
    });

    return Response.json({ connected: true, calendars });
  }),
};
