// Called by the notifications_send_push Postgres trigger (see
// supabase/migrations/20260719120000_web_push_cron.sql) whenever a row is
// inserted into public.notifications. Looks up that recipient's Web Push
// subscriptions and delivers the notification via VAPID. Best-effort: the
// notifications row (read by the in-app bell) is already durable regardless
// of whether the push itself succeeds.
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import webpush from "npm:web-push@3";

const NOTIF_TITLES: Record<string, string> = {
  brief: "Daily brief",
  deadline: "Deadline alert",
  nudge: "Nudge",
  update: "Update",
  sync: "Google sync",
  job: "Job board",
};

const NOTIF_URLS: Record<string, string> = {
  brief: "/",
  deadline: "/tasks",
  nudge: "/tasks",
  update: "/tasks",
  sync: "/settings",
  job: "/jobs",
};

interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

interface RequestBody {
  notification_id: string;
  to_profile_id: string;
  kind: string;
  text: string;
}

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

export default {
  fetch: withSupabase({ auth: "secret" }, async (req, ctx) => {
    const { to_profile_id, kind, text } = (await req.json()) as RequestBody;

    const { data: subs, error } = await ctx.supabaseAdmin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("profile_id", to_profile_id)
      .returns<PushSubscriptionRow[]>();

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }
    if (!subs || subs.length === 0) {
      return Response.json({ sent: 0, pruned: 0 });
    }

    const payload = JSON.stringify({
      title: NOTIF_TITLES[kind] ?? "Home Scheduler",
      body: text,
      url: NOTIF_URLS[kind] ?? "/",
    });

    let sent = 0;
    const pruneIds: string[] = [];

    await Promise.all(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            payload,
          );
          sent++;
        } catch (err) {
          const statusCode = (err as { statusCode?: number }).statusCode;
          // 404/410: the browser unregistered or the subscription expired —
          // stop trying to push to it.
          if (statusCode === 404 || statusCode === 410) {
            pruneIds.push(sub.id);
          } else {
            console.error(`push failed for subscription ${sub.id}:`, err);
          }
        }
      }),
    );

    if (pruneIds.length > 0) {
      await ctx.supabaseAdmin
        .from("push_subscriptions")
        .delete()
        .in("id", pruneIds);
    }

    return Response.json({ sent, pruned: pruneIds.length });
  }),
};
