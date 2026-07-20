# Architecture

## Stack

- **Next.js 16** (App Router, Turbopack) + **React 19** + **TypeScript**
- **Tailwind CSS v4**
- **Supabase**: Postgres, Auth, Realtime, Edge Functions, `pg_cron` /
  `pg_net`
- **Vercel** for hosting (target — free tier)
- **Web Push (VAPID)** for notifications, via `web-push` in an Edge
  Function
- PWA: `public/manifest.webmanifest` + a hand-rolled `public/sw.js`
  (no build-time PWA plugin — see [03-frontend.md](./03-frontend.md))

Everything is designed to run at **$0/month** at family scale (free tiers
across Supabase, Vercel, and Web Push).

> **Note on Next.js version**: this project pins a newer Next.js than most
> training data covers. One concrete difference: middleware is named
> `src/proxy.ts` (exporting `proxy()`), not `middleware.ts`. Check
> `node_modules/next/dist/docs/` before assuming an API matches an older
> Next.js version — see [`AGENTS.md`](../AGENTS.md) at the project root.

## Core design principle: logic lives in Postgres

Every multi-step business operation — marking a task done, verifying it,
rotating chore zones, taking a paid job, sending an invite — is a
`SECURITY DEFINER` RPC function defined in a SQL migration
(`supabase/migrations/`), not application code. Each function is named
after (and mirrors the behavior of) the equivalent function in the
original prototype's embedded JS — e.g. `mark_task_done()` ≈ `markDone()`,
`zone_assignee()` ≈ `zoneAssignee()`.

Why: it keeps the state machine in **one auditable place** instead of
duplicated between client and server, and it means permission checks
(who's allowed to do this?) can't be bypassed by calling the REST API
directly — the check is inside the function the API calls, re-executed on
every invocation with `auth.uid()` as the source of truth for identity.

Two access patterns coexist:

1. **Simple, side-effect-free tables** (`calendar_events`, `subjects`,
   `push_subscriptions`) — the client reads and writes them directly
   through Supabase's PostgREST layer, gated only by RLS policies.
2. **Tables with business logic** (`tasks`, `zones`, `zone_rotation`,
   `jobs`, `notifications`, `family_invites`) — RLS grants `SELECT` only;
   `INSERT`/`UPDATE`/`DELETE` are revoked from the `authenticated` role
   entirely. All writes go through RPC functions, which re-check the
   caller's role/family membership before doing anything.

See [02-database-schema.md](./02-database-schema.md) for the full function
reference.

## Multi-tenancy model

The app started as a single-household, closed-allowlist tool and was
migrated (see `supabase/migrations/20260720000001_multi_tenant_families.sql`)
into an isolated-tenant-per-family model. Key points:

- A `families` table holds one row per family, with a unique
  human-readable `invite_code` (e.g. `MAPLE-2481`).
- Every family-scoped table has a `family_id` column: `profiles`,
  `subjects`, `calendar_events`, `zones`, `zone_rotation`,
  `zone_dismissals`, `jobs`, `tasks`, `subtasks`, `notifications`,
  `push_subscriptions`, `google_tokens`, `family_invites`.
- `family_id` is **never accepted as an RPC parameter from the client**.
  It's always derived server-side via `current_family_id()`, a
  `SECURITY DEFINER` function that looks up `family_id` from the caller's
  own `profiles` row (`auth.uid()`). This closes off client-supplied
  tenant spoofing as an attack vector — a malicious client literally
  cannot ask to write to a `family_id` it doesn't belong to.
- RLS policies filter on `family_id = current_family_id()` (or the
  equivalent) everywhere, in addition to the pre-existing
  parent/kid-role checks.

Two role dimensions exist and are orthogonal:

| Enum | Values | Governs |
| --- | --- | --- |
| `family_role` | `parent`, `kid` | Chore-app permissions *within* a family (who can verify tasks, manage zones, post jobs, etc.) |
| `family_member_role` | `admin`, `member` | Who can manage the family itself (send/revoke invites, regenerate the invite code) |

A family's creator becomes `family_member_role = 'admin'` and
`family_role = 'parent'` automatically (see `create_family()`).

## Request flow (typical write)

1. Client component calls `supabase.rpc("some_function", { ...args })`
   (browser Supabase client, `src/lib/supabase/client.ts`).
2. PostgREST invokes the `SECURITY DEFINER` SQL function as the
   `postgres` role, but `auth.uid()` still resolves to the calling user
   (Supabase sets this from the JWT).
3. The function checks `is_member()` / `is_parent()` /
   `is_family_admin()` and `family_id = current_family_id()` as needed,
   raises an exception (surfaced to the client as a Postgres error) if not
   allowed, then performs the write(s) — often several in one
   transaction (e.g. `verify_task()` updates the task, may create a
   `zone_dismissals` row, may update a `jobs` row, and inserts a
   `notifications` row, all atomically).
4. Any `notifications` insert fires a trigger
   (`trigger_send_push` / `trigger_send_invite`) that does a
   fire-and-forget `net.http_post` to the relevant Edge Function. See
   [05-notifications-and-push.md](./05-notifications-and-push.md).
5. Realtime: tables added to the `supabase_realtime` publication
   (`profiles`, `calendar_events`, `tasks`, `subtasks`, `zones`,
   `zone_rotation`, `jobs`, `notifications`) push `postgres_changes`
   events to subscribed clients, still filtered by RLS — this is how the
   notifications bell and several tabs update live without polling.

## Authorization surface, summarized

- `is_member()` — caller has a `profiles` row (belongs to *some* family
  or, pre-onboarding, none yet — see `current_family_id()` below).
- `is_parent()` — caller's `profiles.role = 'parent'`.
- `is_family_admin()` — caller's `profiles.family_member_role = 'admin'`
  **and** `family_id is not null`.
- `current_family_id()` — the caller's own `family_id` (`null` if they
  haven't joined/created a family yet).

Every RPC function that mutates data calls one or more of these near the
top and raises an exception if the check fails — see
[02-database-schema.md](./02-database-schema.md) for the per-function
authorization rules.
