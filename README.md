# Home Scheduler

A shared family calendar, task-assignment workflow, chore-zone rotation, and
paid job board for one household (2 parents, 3 kids) — an installable web
app (PWA), not a native app, so it works the same on iPhones and laptops
with no App Store and no paid developer account.

**Spec**: [`home-scheduler-prototype.html`](./home-scheduler-prototype.html)
is the approved, fully-interactive UI/behavior spec (open it directly in a
browser). This app replicates it exactly, with every simulated piece
(sign-in, Google Calendar sync, push, the 7am scheduler) made real.

**Stack**: Next.js (App Router) PWA + Supabase (Postgres/Auth/Realtime) +
Vercel — all free tier, $0 running cost. Web Push (VAPID) for notifications,
Supabase pg_cron + Edge Functions for scheduled jobs, Google Calendar API
for two-way sync.

## Architecture

The business logic (assign → done → verify, zone rotation math, job↔task
sync, notification fan-out) lives entirely in Postgres as `SECURITY
DEFINER` RPC functions — see `supabase/migrations/20260719000001_init_schema.sql`.
Each function mirrors a function of the same purpose in the prototype's
embedded JS (e.g. `mark_task_done()` ~= `markDone()`, `zone_assignee()` ~=
`zoneAssignee()`). Reads go through Row Level Security; every write goes
through one of these functions, which re-checks the caller's role
explicitly. This keeps the state machine in one auditable place instead of
duplicated between client and server.

Access rules enforced in Postgres (not just hidden in the UI):

- Kids see everyone's calendar, but only their own tasks.
- Only parents can verify/delete assigned tasks, manage zones, manage
  settings, post/pay jobs, or send nudges.
- A closed allowlist: there is no signup flow. A row only exists in
  `public.profiles` for the 5 real family members. Anyone else who signs in
  with Google gets an `auth.users` row but no `profiles` row, and
  `is_member()` makes every policy and RPC fail closed for them.

## What's here

- Next.js 16 App Router, TypeScript, Tailwind v4, PWA (manifest + service
  worker for offline app-shell + push display)
- Full Postgres schema + RLS + RPC functions
  (`supabase/migrations/20260719000001_init_schema.sql`) — validated by
  running it against a real local Postgres and exercising every RPC
  end-to-end (zone rotation math, dismiss-on-verify, job↔task sync,
  cross-role permission checks)
- `supabase/seed.sql` — local dev seed matching the prototype's demo data
  exactly, for `supabase db reset`
- `supabase/bootstrap.sql.example` — the one-time production setup template
  (see "First-run family setup" below)
- Supabase client wiring: `src/lib/supabase/{client,server}.ts`,
  `src/proxy.ts` (session refresh), `src/app/auth/callback/route.ts`

## Prerequisites

- Node.js 20.9+ (Next.js 16 requirement)
- A free [Supabase](https://supabase.com) project
- A [Google Cloud](https://console.cloud.google.com) OAuth client (sign-in,
  and the Calendar API for two-way sync — see setup step 7)
- The [Supabase CLI](https://supabase.com/docs/guides/cli) (`npx supabase`)

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a Supabase project, then apply the schema:

   ```bash
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```

3. In Supabase Auth settings, enable the **Google** provider using your
   Google OAuth client ID/secret, with redirect URL
   `<your-app-url>/auth/callback`.

4. Generate a Web Push (VAPID) key pair, deploy the `send-push` Edge
   Function, and give it the keys as secrets (the Edge Function reads
   these from its own Supabase secrets, not from `.env.local`):

   ```bash
   npx web-push generate-vapid-keys
   npx supabase functions deploy send-push
   npx supabase secrets set VAPID_PUBLIC_KEY=<the-public-key> VAPID_PRIVATE_KEY=<the-private-key>
   ```

5. Copy `.env.example` to `.env.local` and fill in the values from steps
   2–4, including `NEXT_PUBLIC_VAPID_PUBLIC_KEY` — the same public key as
   above, just also given to the browser so it can call
   `pushManager.subscribe()` (VAPID public keys aren't secret):

   ```bash
   cp .env.example .env.local
   ```

6. **First-run family setup** (one time, in the Supabase SQL editor, as
   service role — bypasses RLS): have all 5 family members sign in once via
   `/login` (creates `auth.users` rows but no access yet — no `profiles`
   row means `is_member()` denies everything). Look up their ids with
   `select id, email from auth.users;`, then copy
   `supabase/bootstrap.sql.example`, fill in the real ids, and run it once.
   This creates the 5 `profiles` rows, default school subjects, the zone
   rotation order, and starter zones.

   After this one-time bootstrap, use **Settings → Invite a family
   member** (parent only) to add anyone else — it emails them a Supabase
   Auth invite link and creates their `profiles` row automatically once
   accepted (see `supabase/migrations/20260719130000_family_invites.sql`).
   That flow needs the `send-invite` Edge Function deployed and a `SITE_URL`
   secret set so the invite email links back to this app instead of
   Supabase's default page:

   ```bash
   npx supabase functions deploy send-invite
   npx supabase secrets set SITE_URL=<your-app-url>
   ```

7. **Google Calendar two-way sync** (optional — each family member connects
   their own account from Settings once this is set up): in Google Cloud
   Console, enable the **Google Calendar API**, then add an authorized
   redirect URI to your OAuth client for
   `https://<project-ref>.supabase.co/functions/v1/google-calendar-callback`
   (separate from the sign-in redirect URI from step 3 — this one is for
   Calendar-scoped access, not login). Deploy the five
   `google-calendar-*` Edge Functions and set their secrets:

   ```bash
   npx supabase functions deploy google-calendar-connect google-calendar-callback google-calendar-list google-calendar-select google-calendar-sync
   npx supabase secrets set GOOGLE_CLIENT_ID=<your-oauth-client-id>
   npx supabase secrets set GOOGLE_CLIENT_SECRET=<your-oauth-client-secret>
   npx supabase secrets set GOOGLE_OAUTH_STATE_SECRET=<a-long-random-string>
   ```

   `google-calendar-sync` also needs the same `supabase_secret_key` Vault
   secret (the project's real `sb_secret_...` key) that `send-push` already
   depends on — see `supabase/migrations/20260719120000_web_push_cron.sql`
   — set once via `vault.update_secret()` in the SQL editor, not through
   `supabase secrets set`.

8. Run the dev server:

   ```bash
   npm run dev
   ```

For local development without a real Supabase project, `npx supabase
start` (requires Docker) spins up a local stack and auto-applies
`supabase/seed.sql`, which seeds 5 fake accounts with the prototype's exact
demo data.

## Scripts

| Command                | Purpose                   |
| ---------------------- | ------------------------- |
| `npm run dev`          | Start the dev server      |
| `npm run build`        | Production build          |
| `npm run start`        | Run the production build  |
| `npm run lint`         | ESLint                    |
| `npm run typecheck`    | `tsc --noEmit`            |
| `npm run format`       | Prettier, writes changes  |
| `npm run format:check` | Prettier, check only (CI) |

Once you have a Supabase project linked, regenerate typed database types
with:

```bash
npx supabase gen types typescript --project-id <project-ref> > src/lib/supabase/database.types.ts
```

(`src/lib/supabase/database.types.ts` is hand-written to match the
migration exactly until a real project exists to generate from — diff
before overwriting, since some function arg/return shapes may need
re-applying.)

## Deployment

Deploy to [Vercel](https://vercel.com) (Hobby tier is $0 and covers family
scale). Set the same environment variables from `.env.local` in the Vercel
project settings. `NEXT_PUBLIC_SITE_URL` should be your production URL, and
the Google OAuth client's authorized redirect URI needs
`<production-url>/auth/callback` added alongside the localhost one.

## Build status

Following the phased build order from the handoff spec:

- [x] **Phase 1** — Postgres schema, RLS, and RPC business logic (done,
      tested against a real local Postgres instance)
- [x] **Phase 2** — Next.js app shell: Today / Calendar / Tasks tabs
- [x] **Phase 3** — Zones tab, Job Board tab, Settings tab (all six tabs from
      the prototype now exist and build clean — `npm run lint` / `typecheck`
      / `build` all pass with zero errors)
- [x] **Phase 4** — Real web push (VAPID) + Edge Functions + pg_cron (`send-push`
      Edge Function delivers via web-push/VAPID; `supabase/migrations/20260719120000_web_push_cron.sql`
      wires the `notifications` insert trigger to it over pg_net and schedules
      the 7am daily brief + 5-minute deadline-alert checks via pg_cron)
- [x] **Phase 5** — Google Calendar two-way sync: each family member connects
      their own account from Settings ("My Google Calendar"), picks which
      calendars to import and which one new app events export to.
      `google-calendar-connect`/`-callback` handle the OAuth consent flow
      (signed `state` param, tokens stored in `google_tokens`);
      `google-calendar-list`/`-select` populate and save the per-calendar
      checklist (`google_calendar_subscriptions`); `google-calendar-sync`
      runs on a 10-minute pg_cron schedule, importing Google's changes via
      each calendar's incremental sync token and draining an outbox
      (`google_calendar_outbox`, filled by a trigger on `calendar_events`)
      to push app-created/edited/deleted events back to Google — see
      `supabase/migrations/20260720000004_google_calendar_sync.sql` through
      `20260720000006_google_calendar_sync_cron.sql`. Requires the Google
      Cloud Console + secrets setup in step 7 above; not yet exercised
      against a real Google account (no live Supabase project in this
      environment — see "What done means so far" below).
- [ ] **Phase 6** — CSV/ICS export, the backups doc, and a first
      Playwright suite (`npm run test:e2e` — public pages + auth guards;
      authenticated-flow coverage is a documented gap, see
      `tests/e2e/authenticated/README.md`) are done; offline support
      beyond the Phase 2 app-shell cache is not started — see
      `Documentation/07-project-status.md` for current detail.

**What "done" means so far**: the schema was validated by applying it to a
real local Postgres instance and exercising every RPC function directly
(zone rotation math, dismiss-on-verify, job↔task sync, cross-role
permission denials — see the commit history for the test script). The
Next.js app has no live Supabase project to run against in this
environment, so it's verified via `npm run typecheck`, `npm run lint`, and
`npm run build` (all clean) plus careful manual review against the
prototype's behavior — it has **not** been exercised in a browser against a
real backend yet. Do that before considering the UI itself done: `supabase
start` (needs Docker) + `npm run dev`, or point `.env.local` at a real
Supabase project with the schema applied.
