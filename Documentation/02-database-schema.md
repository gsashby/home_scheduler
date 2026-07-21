# Database Schema Reference

Source of truth: `supabase/migrations/`, applied in order:

1. `20260719000001_init_schema.sql` — base schema, RLS, and RPC functions (single-household model)
2. `20260719120000_web_push_cron.sql` — Web Push delivery + `pg_cron` scheduled jobs
3. `20260719130000_family_invites.sql` — email-based invite flow (single-household version)
4. `20260720000001_multi_tenant_families.sql` — multi-tenant rework: `families` table, `family_id` everywhere, self-serve signup/create/join
5. `20260720000002_family_invites_generalize.sql` — makes email invites family-scoped and admin-gated, reusing the invite-code join path's plumbing

Where a later migration redefines a function (`create or replace`), this
doc describes the **current** (final) behavior.

## Enums

| Enum                 | Values                                                |
| -------------------- | ----------------------------------------------------- |
| `family_role`        | `parent`, `kid`                                       |
| `family_member_role` | `admin`, `member`                                     |
| `task_status`        | `assigned`, `done`, `verified`                        |
| `task_category`      | `school`, `work`, `home`, `personal`, `goal`, `zone`  |
| `event_source`       | `app`, `google`                                       |
| `job_status`         | `open`, `taken`, `done`, `paid`                       |
| `notif_kind`         | `brief`, `deadline`, `nudge`, `update`, `sync`, `job` |
| `calendar_sharing`   | `family`, `parents`, `private`                        |
| `invite_status`      | `pending`, `accepted`, `revoked`                      |

## Tables

All tables below have RLS enabled. "Client writes" means direct
`INSERT`/`UPDATE`/`DELETE` via the Supabase client is possible for
permitted rows; "RPC only" means those grants are `REVOKE`d and all writes
must go through a function in this doc.

### `families`

One row per tenant. `invite_code` is a unique, human-readable code
(`WORD-1234`, generated from a 40-word list) used for self-serve join.

| Column                      | Notes                            |
| --------------------------- | -------------------------------- |
| `id`, `name`, `invite_code` |                                  |
| `created_by`                | FK → `profiles`                  |
| `created_at`, `updated_at`  | `updated_at` auto-set by trigger |

No client-facing RLS write policy — updates go through
`regenerate_invite_code()` (and family renaming, if/when built — see
[07-project-status.md](./07-project-status.md)).

### `profiles`

One row per `auth.users` row, created automatically by the
`on_auth_user_created` trigger (`handle_new_user()`) on signup —
**every** authenticated user has a `profiles` row, even before they've
joined a family (`family_id` starts `null`).

| Column                                    | Notes                                              |
| ----------------------------------------- | -------------------------------------------------- |
| `id`                                      | = `auth.users.id`                                  |
| `display_name`, `color`                   |                                                    |
| `role`                                    | `family_role` — kid by default                     |
| `family_id`                               | nullable; `null` = "signed up, not onboarded yet"  |
| `family_member_role`                      | `family_member_role` — member by default           |
| `google_sync_enabled`, `calendar_sharing` | Settings tab controls, via `set_member_settings()` |

**RLS**: every family member can `SELECT` every other member's profile in
the same family (kids need names/colors to render everyone's calendar).
**RPC only** for writes — no direct client writes to role/color/family
membership.

### `subjects`

Parent-customizable school subjects, scoped by `family_id`. Deleting one
leaves referencing tasks with `subject_id = null`, shown as
"School · Other". **Client writes**: everyone reads, only parents write
directly (no RPC needed — it's a simple CRUD table).

### `calendar_events`

In-person appointments/events. **Client writes**: everyone in the family
reads everyone's events; only the event's owner or a parent can write.
Has a unique index on `(google_calendar_id, google_event_id)` for the
not-yet-built Google Calendar sync (see
[07-project-status.md](./07-project-status.md)).

### `zones` / `zone_rotation` / `zone_dismissals`

Chore-zone rotation. **RPC only** for writes.

- `zones` — one row per chore area (e.g. "Kitchen"), with a `subzones
text[]` checklist and an optional `assigned_to` pin (non-null =
  permanently assigned to one member, overriding rotation).
- `zone_rotation` — one row per family. `member_order uuid[]` is the fixed
  rotation order (set once at family creation, currently empty until
  populated manually or via bootstrap — see
  [07-project-status.md](./07-project-status.md)). `interval_days = null`
  means manual rotation (only "Rotate now" advances the cycle);
  otherwise it's a day count from `start_date`. `offset_cycles` absorbs
  manual rotations and interval changes without reshuffling current
  assignments.
- `zone_dismissals` — `(zone_id, cycle)` pairs marking "this zone's task
  was verified/deleted for this cycle, don't regenerate it until the next
  cycle."

### `jobs`

Paid work-for-hire board. **RPC only** for writes.
`amount numeric(10,2)`, must be `> 0`. `task_id` links to the `tasks` row
created when a kid takes the job (nullable FK, set after creation to
avoid a circular dependency at table-creation time).

### `tasks` / `subtasks`

**RPC only** for writes. A task belongs to one `member_id` and has a
`category`; `subject_id` is only valid when `category = 'school'`
(enforced by a `check` constraint). `zone_id` + `zone_cycle` link a task
back to the zone/cycle that generated it (for zone-type tasks);
`job_id` links back to a job (for work-for-hire tasks).

**RLS**: kids see only their own tasks; parents see every task in their
family. Subtasks inherit visibility from their parent task.

### `notifications`

Single delivery record, read by the in-app bell and by the Web Push
trigger. **RPC only** for writes (`notify()` / `notify_parents()`
internally; `mark_all_read()` is the only client-callable write).
`dedupe_key` (unique when non-null) prevents duplicate alerts — e.g.
`deadline:<task_id>` or `brief:<member_id>:<date>`.

**RLS**: everyone reads only their own inbox (`to_profile_id = auth.uid()`).

### `push_subscriptions`

Web Push (VAPID) subscription records (`endpoint`, `p256dh`, `auth`).
**Client writes**: owner-only, direct read/write, no RPC needed (no
side effects beyond being read by the `send-push` Edge Function).

### `google_tokens`

OAuth tokens for the not-yet-built Google Calendar sync. **No RLS
policies at all** — zero access for `anon`/`authenticated`; only the
service role (used by Edge Functions) can touch it.

### `family_invites`

Email-based invite flow (parent/admin invites someone who isn't a member
yet). **RPC only** for writes.

| Column                                   | Notes                                                 |
| ---------------------------------------- | ----------------------------------------------------- |
| `email`, `display_name`, `role`, `color` | Pre-filled profile the invitee will get on acceptance |
| `invited_by`                             | FK → `profiles`                                       |
| `family_id`                              | which family they're being invited into               |
| `status`                                 | `pending` / `accepted` / `revoked`                    |
| `accepted_at`                            | set on acceptance                                     |

Unique partial index on `(family_id, lower(email)) where status =
'pending'` — only one live invite per email per family at a time;
revoking (`cancel_family_invite()`) frees the email up for re-invite.

**RLS**: `SELECT` limited to parents in the same family
(`is_parent() and family_id = current_family_id()`).

## RPC function reference

Grouped by feature area. "Auth" = the check(s) the function performs
before doing anything; a caller that fails the check gets a Postgres
exception back as an error from `supabase.rpc(...)`.

### Family creation / joining

| Function                      | Args        | Auth                               | Does                                                                                                                         |
| ----------------------------- | ----------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `create_family(p_name)`       | name        | signed in, not already in a family | Creates a `families` row with a generated invite code, sets caller as `admin`/`parent`, creates an empty `zone_rotation` row |
| `join_family_by_code(p_code)` | invite code | not already in a family            | Looks up `families.invite_code`, joins caller as `kid`/`member` (least-privilege; an admin promotes later)                   |
| `regenerate_invite_code()`    | —           | `is_family_admin()`                | Replaces the family's `invite_code`                                                                                          |
| `current_family_id()`         | —           | any signed-in user                 | Returns caller's `family_id` (or `null`)                                                                                     |
| `is_family_admin()`           | —           | —                                  | Boolean helper                                                                                                               |

### Zone rotation math

| Function                                                  | Notes                                                                                                                                                            |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cycle_num()`                                             | Current rotation cycle number for the caller's family, from `zone_rotation.interval_days`/`start_date`/`offset_cycles`                                           |
| `next_rotation_date()`                                    | Next auto-rotation date, or `null` in manual mode                                                                                                                |
| `zone_assignee(p_zone_id)`                                | Resolves who has a zone this cycle: the pin (`zones.assigned_to`) if set, else `member_order[(zone_index + cycle) mod count]`                                    |
| `zones_with_assignee()`                                   | All zones + computed assignee in one round trip (used by Today and Zones tabs)                                                                                   |
| `ensure_zone_tasks()`                                     | Idempotent: materializes each zone as a `tasks` row for its current assignee, drops stale ones from prior cycles/deleted zones. Safe to call on every page load. |
| `rotate_now()` (parent only)                              | Advances `offset_cycles`, re-materializes tasks, notifies each newly-assigned member                                                                             |
| `set_zone_interval(p_interval_days)` (parent only)        | Changes the rotation cadence (or sets manual mode with `null`) without reshuffling the current cycle's assignments                                               |
| `set_zone_assignee(p_zone_id, p_member_id)` (parent only) | Pins a zone to a member, or `null` to return it to rotation                                                                                                      |
| `save_zone(p_zone_id, p_name, p_subzones)` (parent only)  | Create or update a zone; `null` id = create                                                                                                                      |
| `delete_zone(p_zone_id)` (parent only)                    | Deletes a zone and its non-verified tasks                                                                                                                        |

Cron-only counterparts (no `auth.uid()` available, not granted to
`authenticated`): `cron_ensure_zone_tasks()`. See
[05-notifications-and-push.md](./05-notifications-and-push.md).

### Tasks

| Function                                                                                          | Auth                                                       | Does                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_task(title, member_id, category, subject_id, date, deadline, remind_minutes, subtasks[])` | member; kids can only assign to themselves                 | Inserts task + subtasks; notifies the assignee if assigned by someone else                                                                            |
| `toggle_subtask(p_subtask_id)`                                                                    | owner or parent                                            | Flips `subtasks.done`                                                                                                                                 |
| `mark_task_done(p_task_id)`                                                                       | must be the task's own member, task must be `assigned`     | Sets `done`; if job-linked, marks the job `done` too; notifies all parents                                                                            |
| `verify_task(p_task_id)`                                                                          | parent                                                     | Sets `verified`; if zone-linked, records a `zone_dismissals` row; if job-linked, marks job `paid` and notifies the earner; notifies the task's member |
| `delete_task(p_task_id)`                                                                          | parent, or (owner **and** creator **and** not zone-linked) | Idempotent delete; records a `zone_dismissals` row first if zone-linked                                                                               |
| `move_task(p_task_id)`                                                                            | same rule as delete, task must not be `verified`           | Pushes `date` forward one day                                                                                                                         |
| `roll_all_tasks()`                                                                                | parent                                                     | Bulk-moves every overdue `assigned` task to today; returns count                                                                                      |
| `nudge_task(p_task_id)`                                                                           | parent                                                     | Sends a `nudge` notification to the task's member                                                                                                     |

### Jobs (work-for-hire board)

| Function                    | Auth                                   | Does                                                           |
| --------------------------- | -------------------------------------- | -------------------------------------------------------------- |
| `create_job(title, amount)` | parent                                 | Creates `open` job; notifies every kid                         |
| `take_job(p_job_id)`        | non-parent member, job must be `open`  | Claims it (`taken`), creates a linked task, notifies parents   |
| `job_done(p_job_id)`        | must be the taker, job must be `taken` | Marks job + linked task `done`, notifies parents to verify/pay |
| `pay_job(p_job_id)`         | parent                                 | Marks job `paid`, task `verified`, notifies the earner         |
| `delete_job(p_job_id)`      | parent                                 | Deletes job and its non-verified linked task                   |

### Settings / notifications

| Function                                               | Auth                   | Does                                                                                                                                                                                                              |
| ------------------------------------------------------ | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `set_member_settings(member_id, google_sync, sharing)` | parent                 | Updates another member's sync/sharing prefs (either arg `null` leaves it unchanged)                                                                                                                               |
| `set_member_role(member_id, role)`                     | `is_family_admin()`    | Changes a member's `family_role` (parent/kid) within the same family. Refuses to demote a family's last remaining parent to kid (raises "Every family needs at least one parent..." — see `07-project-status.md`) |
| `mark_all_read()`                                      | self only              | Marks caller's own unread notifications read                                                                                                                                                                      |
| `brief_line_for(member_id)`                            | any (stable/read-only) | Composes the "today" summary line (events/tasks/zone) for one person                                                                                                                                              |
| `send_daily_brief_all()`                               | parent                 | Manually triggers today's brief for the caller's whole family (also re-materializes zone tasks)                                                                                                                   |

### Family invites (email-based)

| Function                                                 | Auth                               | Does                                                                                                                                         |
| -------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_family_invite(email, display_name, role, color)` | `is_family_admin()`                | Validates email/dupes, inserts a `pending` invite; a trigger fires the `send-invite` Edge Function                                           |
| `cancel_family_invite(p_invite_id)`                      | `is_family_admin()`                | Soft-revoke (`status = 'revoked'`), only while still `pending`                                                                               |
| `accept_family_invite()`                                 | signed in, not already in a family | Matches caller's `auth.users.email` to a pending invite, joins that family (via the shared `_join_family()` helper), marks invite `accepted` |

### Cron-only functions

Not granted to `authenticated`/`anon` — callable only by `pg_cron` jobs
(which run with no `auth.uid()`), so they loop over every family
explicitly instead of relying on `current_family_id()`. See
[05-notifications-and-push.md](./05-notifications-and-push.md) for the
schedule.

- `cron_ensure_zone_tasks()`
- `cron_send_daily_brief()`
- `cron_generate_deadline_alerts()`

### Internal-only helpers

Not granted to `authenticated` at all — only callable from inside other
`SECURITY DEFINER` functions: `notify()`, `notify_parents()`,
`generate_family_invite_code()`, `_join_family()`,
`_cycle_num_for()`, `_zone_assignee_for()`, `_ensure_zone_tasks_for()`,
`set_updated_at()` (trigger function), `handle_new_user()` (trigger
function), `trigger_send_push()` / `trigger_send_invite()` (trigger
functions).

## Realtime

Supabase's `supabase_realtime` publication starts empty on new projects.
The init migration adds: `profiles`, `calendar_events`, `tasks`,
`subtasks`, `zones`, `zone_rotation`, `jobs`, `notifications`. RLS still
applies to what each subscribed client actually receives. (The migration
guards this with an `exists` check so it also applies cleanly to a plain,
non-Supabase Postgres instance for local testing.)
