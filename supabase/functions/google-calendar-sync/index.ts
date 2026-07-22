// Invoked by pg_cron via pg_net on a schedule (see supabase/migrations),
// same secret-key pattern as send-push/send-invite. Two-way sync in one
// pass per run:
//   1. Import: pull each enabled google_calendar_subscriptions row's
//      events from Google (incremental via sync_token, or a full sync)
//      and upsert into calendar_events.
//   2. Export: drain pending google_calendar_outbox rows, pushing
//      app-created/edited/deleted events to Google.
// Writes to calendar_events go through SECURITY DEFINER RPCs
// (sync_upsert_imported_event / sync_delete_imported_event /
// sync_link_calendar_event) rather than plain table writes — see
// supabase/migrations/20260720000005_google_calendar_sync_rpcs.sql for why.
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { getValidAccessToken } from "../_shared/google-tokens.ts";
import {
  fromGoogleEventTime,
  toGoogleEventTime,
  type GoogleEventTime,
} from "../_shared/google-calendar-time.ts";

const EVENTS_BASE = "https://www.googleapis.com/calendar/v3/calendars";
const CALENDAR_LIST_URL =
  "https://www.googleapis.com/calendar/v3/users/me/calendarList";

// Each Google calendar's own display color (calendarList.backgroundColor),
// keyed by calendar id, so imported events can be color-coded by source
// calendar instead of only by member. One list call per profile per sync
// run — cheap next to the per-calendar events.list calls below.
async function fetchCalendarColors(
  accessToken: string,
): Promise<Map<string, string>> {
  const colors = new Map<string, string>();
  let pageToken: string | undefined;

  do {
    const url = new URL(CALENDAR_LIST_URL);
    url.searchParams.set("maxResults", "250");
    url.searchParams.set("fields", "items(id,backgroundColor),nextPageToken");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      console.error("Failed to fetch calendar colors:", await res.text());
      return colors;
    }
    const body = (await res.json()) as {
      items?: { id: string; backgroundColor?: string }[];
      nextPageToken?: string;
    };
    for (const item of body.items ?? []) {
      if (item.backgroundColor) colors.set(item.id, item.backgroundColor);
    }
    pageToken = body.nextPageToken;
  } while (pageToken);

  return colors;
}

interface GoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  start?: GoogleEventTime;
  end?: GoogleEventTime;
}

interface ListResult {
  items: GoogleEvent[];
  nextSyncToken?: string;
  syncTokenInvalid?: boolean;
  error?: string;
}

async function listGoogleEvents(
  accessToken: string,
  calendarId: string,
  syncToken: string | null,
): Promise<ListResult> {
  const items: GoogleEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;

  do {
    const url = new URL(`${EVENTS_BASE}/${encodeURIComponent(calendarId)}/events`);
    url.searchParams.set("maxResults", "250");
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("showDeleted", "true");
    if (syncToken) {
      url.searchParams.set("syncToken", syncToken);
    } else {
      url.searchParams.set("timeMin", new Date().toISOString());
    }
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 410) {
      return { items: [], syncTokenInvalid: true };
    }
    if (!res.ok) {
      return { items: [], error: await res.text() };
    }
    const body = (await res.json()) as {
      items?: GoogleEvent[];
      nextPageToken?: string;
      nextSyncToken?: string;
    };
    items.push(...(body.items ?? []));
    pageToken = body.nextPageToken;
    nextSyncToken = body.nextSyncToken;
  } while (pageToken);

  return { items, nextSyncToken };
}

interface SubscriptionRow {
  id: string;
  profile_id: string;
  family_id: string;
  google_calendar_id: string;
  sync_token: string | null;
}

async function importSubscription(
  supabaseAdmin: any,
  accessToken: string,
  sub: SubscriptionRow,
  color: string | null,
): Promise<void> {
  let result = await listGoogleEvents(
    accessToken,
    sub.google_calendar_id,
    sub.sync_token,
  );

  if (result.syncTokenInvalid) {
    // Google invalidated the cursor (410) — drop it and do a full resync.
    result = await listGoogleEvents(accessToken, sub.google_calendar_id, null);
  }

  if (result.error) {
    console.error(
      `Import failed for subscription ${sub.id} (${sub.google_calendar_id}):`,
      result.error,
    );
    return;
  }

  for (const item of result.items) {
    if (item.status === "cancelled") {
      await supabaseAdmin.rpc("sync_delete_imported_event", {
        p_google_calendar_id: sub.google_calendar_id,
        p_google_event_id: item.id,
      });
      continue;
    }
    if (!item.start || !item.end) continue; // defensive — malformed event

    const { date, startTime, endTime } = fromGoogleEventTime(
      item.start,
      item.end,
    );
    await supabaseAdmin.rpc("sync_upsert_imported_event", {
      p_family_id: sub.family_id,
      p_member_id: sub.profile_id,
      p_google_calendar_id: sub.google_calendar_id,
      p_google_event_id: item.id,
      p_title: item.summary ?? "(untitled)",
      p_date: date,
      p_start_time: startTime,
      p_end_time: endTime,
      p_color: color,
    });
  }

  const subUpdate: Record<string, unknown> = {};
  if (result.nextSyncToken) subUpdate.sync_token = result.nextSyncToken;
  if (color !== null) subUpdate.color = color;
  if (Object.keys(subUpdate).length > 0) {
    await supabaseAdmin
      .from("google_calendar_subscriptions")
      .update(subUpdate)
      .eq("id", sub.id);
  }
}

interface OutboxRow {
  id: string;
  profile_id: string;
  calendar_event_id: string | null;
  google_calendar_id: string;
  google_event_id: string | null;
  operation: "create" | "update" | "delete";
  title: string;
  date: string;
  start_time: string;
  end_time: string;
}

async function markOutbox(
  supabaseAdmin: any,
  id: string,
  status: "done" | "error",
  errorMessage?: string,
): Promise<void> {
  await supabaseAdmin
    .from("google_calendar_outbox")
    .update({ status, error_message: errorMessage ?? null, processed_at: new Date().toISOString() })
    .eq("id", id);
}

async function processOutboxRow(
  supabaseAdmin: any,
  accessToken: string,
  row: OutboxRow,
): Promise<void> {
  const eventBody = {
    summary: row.title,
    start: toGoogleEventTime(row.date, row.start_time),
    end: toGoogleEventTime(row.date, row.end_time),
  };

  if (row.operation === "create") {
    const res = await fetch(
      `${EVENTS_BASE}/${encodeURIComponent(row.google_calendar_id)}/events`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(eventBody),
      },
    );
    if (!res.ok) {
      await markOutbox(supabaseAdmin, row.id, "error", await res.text());
      return;
    }
    const created = (await res.json()) as { id: string };
    if (row.calendar_event_id) {
      await supabaseAdmin.rpc("sync_link_calendar_event", {
        p_calendar_event_id: row.calendar_event_id,
        p_google_calendar_id: row.google_calendar_id,
        p_google_event_id: created.id,
      });
    }
    await markOutbox(supabaseAdmin, row.id, "done");
    return;
  }

  if (row.operation === "update") {
    const res = await fetch(
      `${EVENTS_BASE}/${encodeURIComponent(row.google_calendar_id)}/events/${encodeURIComponent(row.google_event_id!)}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(eventBody),
      },
    );
    if (!res.ok) {
      await markOutbox(supabaseAdmin, row.id, "error", await res.text());
      return;
    }
    await markOutbox(supabaseAdmin, row.id, "done");
    return;
  }

  // delete
  const res = await fetch(
    `${EVENTS_BASE}/${encodeURIComponent(row.google_calendar_id)}/events/${encodeURIComponent(row.google_event_id!)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } },
  );
  // 404/410/2xx all mean "gone from Google", which is the desired end state.
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    await markOutbox(supabaseAdmin, row.id, "error", await res.text());
    return;
  }
  await markOutbox(supabaseAdmin, row.id, "done");
}

export default {
  fetch: withSupabase<any>({ auth: "secret" }, async (_req, ctx) => {
    const accessTokenCache = new Map<string, string | null>();
    async function accessTokenFor(profileId: string): Promise<string | null> {
      if (accessTokenCache.has(profileId)) {
        return accessTokenCache.get(profileId)!;
      }
      const result = await getValidAccessToken(ctx.supabaseAdmin, profileId);
      const token = result.ok ? result.accessToken : null;
      if (!result.ok) {
        console.error(`No valid Google token for profile ${profileId}:`, result.error);
      }
      accessTokenCache.set(profileId, token);
      return token;
    }

    // ---- Import: Google -> app ----
    const { data: subs, error: subsErr } = await ctx.supabaseAdmin
      .from("google_calendar_subscriptions")
      .select("id, profile_id, family_id, google_calendar_id, sync_token")
      .eq("enabled", true)
      .returns<SubscriptionRow[]>();

    if (subsErr) {
      return Response.json({ error: subsErr.message }, { status: 500 });
    }

    const profileIds = [...new Set((subs ?? []).map((s) => s.profile_id))];
    const { data: profiles } = await ctx.supabaseAdmin
      .from("profiles")
      .select("id, google_sync_enabled")
      .in("id", profileIds.length > 0 ? profileIds : [""]);
    const syncEnabled = new Set(
      (profiles ?? []).filter((p) => p.google_sync_enabled).map((p) => p.id),
    );

    const colorCache = new Map<string, Map<string, string>>();
    async function colorsFor(
      profileId: string,
      accessToken: string,
    ): Promise<Map<string, string>> {
      if (colorCache.has(profileId)) return colorCache.get(profileId)!;
      const colors = await fetchCalendarColors(accessToken);
      colorCache.set(profileId, colors);
      return colors;
    }

    let imported = 0;
    for (const sub of subs ?? []) {
      if (!syncEnabled.has(sub.profile_id)) continue;
      const token = await accessTokenFor(sub.profile_id);
      if (!token) continue;
      const colors = await colorsFor(sub.profile_id, token);
      const color = colors.get(sub.google_calendar_id) ?? null;
      await importSubscription(ctx.supabaseAdmin, token, sub, color);
      imported++;
    }

    // ---- Export: app -> Google ----
    const { data: outboxRows, error: outboxErr } = await ctx.supabaseAdmin
      .from("google_calendar_outbox")
      .select(
        "id, profile_id, calendar_event_id, google_calendar_id, google_event_id, operation, title, date, start_time, end_time",
      )
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .returns<OutboxRow[]>();

    if (outboxErr) {
      return Response.json({ error: outboxErr.message }, { status: 500 });
    }

    let exported = 0;
    for (const row of outboxRows ?? []) {
      const token = await accessTokenFor(row.profile_id);
      if (!token) {
        await markOutbox(
          ctx.supabaseAdmin,
          row.id,
          "error",
          "No valid Google token for this person",
        );
        continue;
      }
      await processOutboxRow(ctx.supabaseAdmin, token, row);
      exported++;
    }

    return Response.json({
      subscriptions: subs?.length ?? 0,
      imported,
      outboxProcessed: exported,
    });
  }),
};
