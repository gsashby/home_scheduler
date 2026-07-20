# Notifications & Web Push

## Notification kinds

`notif_kind` enum, with UI labels from `src/lib/notifications.ts`:

| Kind | Label | Sent by |
| --- | --- | --- |
| `brief` | Daily brief | `cron_send_daily_brief()` (7am) or `send_daily_brief_all()` (manual) |
| `deadline` | Deadline alert | `cron_generate_deadline_alerts()` (every 5 min) |
| `nudge` | Nudge | `nudge_task()` (parent, on-demand) |
| `update` | Update | Various RPCs — task assigned/verified, zone assigned, member joined, etc. |
| `sync` | Google sync | Reserved for the not-yet-built Google Calendar sync |
| `job` | Job board | Job posted / claimed / done / paid |

## In-app delivery (always works)

Every notification is a row in `public.notifications`
(`to_profile_id`, `kind`, `text`, `dedupe_key`, `read`). The
`NotificationsBell` component
(`src/components/notifications-bell.tsx`) loads the caller's last 100 and
subscribes to Realtime `INSERT`/`UPDATE` events filtered to
`to_profile_id=eq.<me>` — so the bell and its badge count update live with
no polling. This channel is independent of Web Push; it works even if
push was never set up or the permission was denied.

## Web Push delivery (best-effort, additional channel)

Set up in `supabase/migrations/20260719120000_web_push_cron.sql`.

1. **Trigger**: `notifications_send_push` (`AFTER INSERT ON
   public.notifications`) calls `trigger_send_push()`, which does a
   fire-and-forget `net.http_post` to the `send-push` Edge Function,
   authenticated with the project's secret API key (`sb_secret_...`)
   stored in Supabase Vault as `supabase_secret_key` — never in a query
   or a committed file. `net.http_post` is async: it queues the request
   and returns immediately, so a slow/failed push call never blocks the
   insert that triggered it. This makes push explicitly best-effort — the
   `notifications` row (read by the in-app bell) is durable regardless of
   whether the push itself succeeds.
2. **Edge Function** (`supabase/functions/send-push/index.ts`): looks up
   the recipient's `push_subscriptions` rows, sends via `web-push` using
   `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` env vars, and
   prunes subscriptions that come back `404`/`410` (browser unregistered
   or subscription expired).
3. **Service worker** (`public/sw.js`): the `push` event handler shows the
   notification (title/body from `NOTIF_TITLES`/payload, deep-link `url`
   from `NOTIF_URLS` keyed by `kind` — e.g. `deadline`/`nudge`/`update` →
   `/tasks`, `job` → `/jobs`); `notificationclick` focuses or opens that
   URL.

### Known gap: nothing subscribes the client yet

The pieces above assume a `push_subscriptions` row already exists for the
recipient, but as of this writing there is **no code that calls
`pushManager.subscribe()`** and writes the resulting subscription (with
the `VAPID_PUBLIC_KEY`) into `push_subscriptions`.
`service-worker-register.tsx` only registers the service worker itself —
it doesn't request notification permission or create a push
subscription. Until that's added, `send-push` will find zero
subscriptions for every recipient and Web Push will silently deliver
nothing (in-app notifications still work fine). See
[07-project-status.md](./07-project-status.md).

## Scheduled jobs (`pg_cron` + `pg_net`)

Both extensions enabled in the same migration. Database and
`cron.timezone` are both set to `America/Denver` — none of the schema's
date/time logic (`current_date`, `localtime`, task deadlines, zone
rotation math) is per-user-timezone-aware; it assumes the database's own
timezone *is* the family's local time. If deploying for a family in
another timezone, this needs to change.

| Job name | Schedule | Calls |
| --- | --- | --- |
| `daily-brief` | `0 7 * * *` (7:00 AM local) | `cron_send_daily_brief()` — also re-materializes zone tasks for the day via `cron_ensure_zone_tasks()` |
| `deadline-alerts` | `*/5 * * * *` (every 5 min) | `cron_generate_deadline_alerts()` — dedupes per-task via `notify()`'s `dedupe_key` (`deadline:<task_id>`), so frequent polling is safe |

Both cron functions loop over **every family** (they run with no
`auth.uid()`, so they can't rely on `current_family_id()`). The migration
unschedules-then-reschedules both jobs by name, so re-running it (local
`supabase db reset`, or a repaired `db push`) is safe.

`cron_send_daily_brief()`'s notification includes a per-day dedupe key
(`brief:<member_id>:<date>`) specifically so a delayed cron tick or a
manual re-run doesn't double-send the morning brief.

## Manual "send now"

Settings has no button for this; it's on the **Today** tab, parent-only:
"Send daily brief to everyone" → `send_daily_brief_all()`, scoped to the
caller's own family only (rewritten during the multi-tenant migration —
the original version delegated straight to `cron_send_daily_brief()`,
which now loops every family and would have leaked every family's briefs
to everyone on any single click).
