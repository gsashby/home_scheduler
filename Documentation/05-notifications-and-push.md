# Notifications & Web Push

## Notification kinds

`notif_kind` enum, with UI labels from `src/lib/notifications.ts`:

| Kind       | Label          | Sent by                                                                   |
| ---------- | -------------- | ------------------------------------------------------------------------- |
| `brief`    | Daily brief    | `cron_send_daily_brief()` (7am) or `send_daily_brief_all()` (manual)      |
| `deadline` | Deadline alert | `cron_generate_deadline_alerts()` (every 5 min)                           |
| `nudge`    | Nudge          | `nudge_task()` (parent, on-demand)                                        |
| `update`   | Update         | Various RPCs — task assigned/verified, zone assigned, member joined, etc. |
| `sync`     | Google sync    | Reserved for the not-yet-built Google Calendar sync                       |
| `job`      | Job board      | Job posted / claimed / done / paid                                        |

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

## Client-side subscribe flow

`src/components/push-notifications-card.tsx` — rendered in Settings for
every member (parent and kid alike; push is per-device, not
role-gated) — is what actually creates the `push_subscriptions` row the
delivery pipeline above depends on:

1. Checks support (`"serviceWorker" in navigator && "PushManager" in
window`) and current `Notification.permission` / existing
   subscription (`registration.pushManager.getSubscription()`) on mount,
   rendering one of: unsupported, blocked (`denied`), not-yet-enabled, or
   enabled.
2. **Enable**: `Notification.requestPermission()` → on grant,
   `registration.pushManager.subscribe({ userVisibleOnly: true,
applicationServerKey: <NEXT_PUBLIC_VAPID_PUBLIC_KEY> })` → upserts
   `{ profile_id, endpoint, p256dh, auth }` into `push_subscriptions`
   (`onConflict: "endpoint"`, matching the table's `unique` constraint on
   `endpoint` — the same physical subscription re-enabled on the same
   device updates its row rather than erroring). `family_id` isn't sent
   from the client; the `push_subscriptions_force_family_id` trigger
   fills it from `current_family_id()`.
3. **Disable**: deletes the `push_subscriptions` row for the current
   subscription's `endpoint`, then calls `subscription.unsubscribe()`.

This needs `NEXT_PUBLIC_VAPID_PUBLIC_KEY` set in `.env.local` (and in
Vercel for production) to the _same_ public key given to the `send-push`
Edge Function as its `VAPID_PUBLIC_KEY` secret — see
[06-setup-guide.md](./06-setup-guide.md). VAPID public keys aren't
secret, so exposing this one to the browser is safe; only the matching
private key must stay server-side.

In-app notifications (the bell, via Realtime) never depend on any of
this and work regardless of whether push was ever enabled on a device.

## Scheduled jobs (`pg_cron` + `pg_net`)

Both extensions enabled in `20260719120000_web_push_cron.sql`. The
database's own `timezone` GUC is set to `America/Denver`
(`alter database postgres set timezone to 'America/Denver'`) — none of
the schema's date/time logic (`current_date`, `localtime`, task
deadlines, zone rotation math) is per-user-timezone-aware; it assumes
the database's own timezone _is_ the family's local time. If deploying
for a family in another timezone, this needs to change.

**`cron.timezone` itself could not be set** — it's a restart-only
parameter on this Supabase tier (`ALTER DATABASE ... SET "cron.timezone"
...` fails with `SQLSTATE 55P02`), so `cron.schedule()`'s schedule
strings are interpreted in UTC regardless of the database's own
timezone above. This is a _different_ setting from the one in the
previous paragraph — the database `timezone` GUC governs how
`now()`/`current_date`/etc. render (that part works correctly), while
`cron.timezone` governs what "7am" in a cron string means (that part
defaulted to UTC). This actually broke the daily brief for a while (see
`20260721000001_fix_daily_brief_timezone.sql`): the schedule read
`0 7 * * *` intending 7am Mountain, but ran at 7am UTC — midnight to 1am
Mountain depending on DST. Fixed by sidestepping `cron.timezone`
entirely: `daily-brief` now runs every 15 minutes (still scheduled in
UTC) and `cron_send_daily_brief()` itself checks
`extract(hour from now())` against the database's correctly-set
`timezone` GUC, only actually sending during the 7am _local_ hour —
correct across DST automatically, since `America/Denver` is a real IANA
zone, not a fixed offset.

| Job name          | Schedule                                           | Calls                                                                                                                                  |
| ----------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `daily-brief`     | `*/15 * * * *`, self-guarded to the 7am local hour | `cron_send_daily_brief()` — also re-materializes zone tasks for the day via `cron_ensure_zone_tasks()`                                 |
| `deadline-alerts` | `*/5 * * * *` (every 5 min)                        | `cron_generate_deadline_alerts()` — dedupes per-task via `notify()`'s `dedupe_key` (`deadline:<task_id>`), so frequent polling is safe |

Both cron functions loop over **every family** (they run with no
`auth.uid()`, so they can't rely on `current_family_id()`). Every
`daily-brief` tick within the 7am hour (there are ~4, every 15 minutes)
safely re-runs the same logic: `cron_ensure_zone_tasks()` is idempotent
per rotation cycle, and `cron_send_daily_brief()`'s `notify()` call
carries a per-day `dedupe_key` (`brief:<member_id>:<date>`) so only the
first tick's notification actually gets inserted — the rest are no-ops.
That dedupe_key was actually dropped by a later migration's rewrite of
this function (`20260720000001_multi_tenant_families.sql`, needed to
loop over every family instead of one hardcoded household) and restored
in the same fix; without it, moving to a 15-minute schedule would have
sent one duplicate "Good morning" push per tick. The migrations
unschedule-then-reschedule jobs by name, so re-running any of them
(local `supabase db reset`, or a repaired `db push`) is safe.

None of this has been exercised against a real `pg_cron` scheduler (no
Docker/live Supabase project available where this was written — see
07-project-status.md) — reviewed carefully against the existing,
already-relied-upon behavior of the database `timezone` GUC elsewhere in
the schema, not run.

## Manual "send now"

Settings has no button for this; it's on the **Today** tab, parent-only:
"Send daily brief to everyone" → `send_daily_brief_all()`, scoped to the
caller's own family only (rewritten during the multi-tenant migration —
the original version delegated straight to `cron_send_daily_brief()`,
which now loops every family and would have leaked every family's briefs
to everyone on any single click).
