# Project Status

This reflects a direct read of the code as of **2026-07-21**, including
the `accept_family_invite()` wiring, the Web Push subscribe flow, the
password reset flow, CSV/ICS export, the backups doc, a first Playwright
suite, offline support, the `config.toml` → production sync fix, the
daily-brief timezone/dedupe fix, and a sign-out flow. The project is
under active development — treat this as a snapshot, not a permanent
contract. Cross-check against `git log` / `git status` before relying on
specifics.

## Build phases (per the original handoff spec, see top-level README)

- [x] **Phase 1** — Postgres schema, RLS, RPC business logic
- [x] **Phase 2** — Next.js app shell: Today / Calendar / Tasks tabs
- [x] **Phase 3** — Zones, Job Board, Settings tabs (all six tabs exist)
- [x] **Phase 4** — Real Web Push (VAPID) + Edge Functions + `pg_cron`,
      including the client-side subscribe flow
      (`src/components/push-notifications-card.tsx`, in Settings for
      every member)
- [x] **Phase 5** — Google Calendar two-way sync. All five
      `google-calendar-{connect,callback,list,select,sync}` Edge Functions
      exist, and `src/components/google-calendar-card.tsx` (wired into
      Settings) drives a real OAuth connect → pick calendar → enable sync
      flow against `set_member_settings()`. Substantially complete, not a
      stub.
- [x] **Phase 6** — CSV/ICS export, the backups doc, a first Playwright
      suite, and offline support (app-shell caching, a Supabase REST read
      cache, an offline banner) are all shipped — see below.

## Multi-tenant rework (in progress, on top of Phase 1–4)

Not part of the original phase list — a later architectural change turning
the single-household closed-allowlist app into a proper multi-tenant,
self-serve-signup product. Migrations
`20260720000001_multi_tenant_families.sql` and
`20260720000002_family_invites_generalize.sql`, plus frontend under
`src/app/onboarding/{layout,choose,join,invite,create}/page.tsx`,
`src/app/signup/page.tsx`, `src/app/(app)/layout.tsx`,
`src/app/login/page.tsx`, `src/components/invite-form.tsx`. See
[04-auth-and-onboarding.md](./04-auth-and-onboarding.md) for the full flow.
This is now fully committed (`git status` clean) and the onboarding/signup
pages are complete, functional flows — not stubs, including the email
invite auto-join (see "Resolved" below).

## Known gaps, verified by reading the code

Every phase-list item is now done. What remains: authenticated-flow E2E
coverage (sign-in, task/job/calendar CRUD, invites) — see
`tests/e2e/authenticated/README.md` — and the actual runtime behavior of
the offline caching in `public/sw.js`, which is code-reviewed and
reasoned about but not exercised through an automated test (see the note
under "Offline support" below). Both are documented gaps, not silent
ones.

## Production readiness checklist

A pass specifically asking "what's needed before a real family uses
this," done after every phase-list item above was complete. Two real
bugs surfaced and were fixed (see "Resolved" below); the rest is either
mechanical setup (already covered in
[06-setup-guide.md](./06-setup-guide.md)) or things worth knowing before
launch rather than blocking it.

This checklist was later actually exercised against the real project
(`myzejnyxkzyxebaxyzko`, "Home Manager") and the real Vercel deployment —
see "Live-verified" below for what changed as a result. Keeping the
original pass's notes below since some items are still open.

**Fixed as part of the code-review pass:**

- The daily brief previously fired at the wrong time entirely (UTC, not
  Mountain) — see `20260721000001_fix_daily_brief_timezone.sql` and
  "Resolved" below.
- No sign-out flow existed anywhere in the app — added to `Shell`.

**Fixed live, against the real project (see "Live-verified" below for
detail):** custom SMTP scaffolded (not yet activated — needs a real
Resend account), the redirect-URL allowlist (was missing every actual
subpath the app uses — confirmed broken, not just a placeholder issue),
`storage.vector` blocking all of `config push`, `send-push` never having
been deployed, and `NEXT_PUBLIC_VAPID_PUBLIC_KEY` never having been set
in Vercel.

**Still open:**

- Actually sign up for an SMTP provider (Resend recommended, scaffolded
  in `config.toml`) and set `RESEND_API_KEY`, then uncomment
  `[auth.email.smtp]` and the two `[auth.email.template.*]` sections and
  run `config push` again — custom invite/password-reset emails still
  fall back to Supabase's generic default templates until this happens.
- Confirm the family's actual timezone if not Mountain — same
  `alter database postgres set timezone` mechanism as the daily-brief
  fix uses.
- Google Calendar sync has still never been exercised against a real
  Google account (everything else now has been — see below).
- Basic error monitoring (none exists — a production error is currently
  invisible until a person notices something's wrong).
- No CI (`.github/workflows` doesn't exist) — lint/typecheck/build/tests
  only run when someone remembers to run them locally.
- Run `npm run backup` once real family data exists, and periodically
  after (see [08-backups-and-recovery.md](./08-backups-and-recovery.md)).

### Live-verified (2026-07-21) — what was actually run against the real project

Everything above this heading, in every doc in this repo, was previously
"reviewed but not run" for lack of a live backend. That changed: the
Supabase CLI in this environment turned out to already be linked to the
real project (`myzejnyxkzyxebaxyzko`, "Home Manager"), and a Vercel
preview deployment already existed for this branch. With the project
owner's explicit go-ahead, this pass actually touched the real
infrastructure — read-only reconnaissance first, then fixes, in this
order:

1. **Migration history had already drifted.**
   `supabase migration list` showed `20260720000007_calendar_event_details.sql`
   as un-applied locally, but attempting `db push` failed with `column
"location" of relation "calendar_events" already exists`. Read-only
   introspection via the PostgREST OpenAPI root (service-role key,
   `GET /rest/v1/`) confirmed the _entire_ migration's schema (columns
   and the `calendar_event_attendees` table) already existed remotely —
   it had been applied outside the tracked migration flow at some point.
   Reconciled with `supabase migration repair --status applied
20260720000007` (no schema changes; just fixes the tracking) rather
   than risk re-running DDL that had already succeeded.
2. **`db push` then applied `20260721000001_fix_daily_brief_timezone.sql`
   cleanly.** Not independently verified that the cron actually fires at
   the right time yet (would need to wait for a real 7am Mountain tick).
3. **`config push` failed twice more, for two unrelated reasons,
   before succeeding:**
   - `"Email template modification is not available for free tier
projects using the default email provider."` — confirms the custom
     invite/recovery templates had _never_ successfully applied to this
     project, ever, at any point before now. Both
     `[auth.email.template.*]` sections were commented out (not
     deleted) in `config.toml` to unblock everything else, with
     instructions to re-enable once SMTP is configured.
   - `"Please upgrade the project to a paid tier to enable vector
buckets."` — `[storage.vector] enabled = true` was a leftover
     default from whatever `supabase init` template generated this
     `config.toml`; this app uses no vector/embedding features at all.
     Set to `false`.
   - Once past both, `config push` succeeded and is now idempotent
     (confirmed by running it twice — both `up_to_date`).
4. **The redirect-URL allowlist was actually broken, not just carrying a
   placeholder risk.** `additional_redirect_urls` had two bare origins
   (no paths). Researched Supabase's actual glob-matching rules (`.`
   and `/` are separators; a bare origin does _not_ match any subpath)
   and grepped every `redirectTo`/`emailRedirectTo` call in the codebase
   to get the real list: `/auth/callback`, `/auth/confirm`,
   `/auth/update-password`. None of the three were covered before this
   fix — meaning Google sign-in, email/OAuth confirmation, and password
   reset would all have been rejected or silently misrouted by Supabase
   in production. Fixed in `config.toml`, confirmed pushed.
5. **`send-push` had never been deployed to this project at all**
   (`supabase functions list` showed `send-invite` and all five
   `google-calendar-*` functions, but not `send-push`) — deployed now.
   All required secrets (`VAPID_PUBLIC_KEY`/`_PRIVATE_KEY`/`_SUBJECT`,
   `GOOGLE_CLIENT_ID`/`_SECRET`, `GOOGLE_OAUTH_STATE_SECRET`, `SITE_URL`)
   were already set.
6. **A real end-to-end browser run, via a Vercel preview deployment for
   this exact PR branch** (found via `gh pr view`'s Vercel bot comment):
   sign up with a real (test) email/password → landed on
   `/onboarding/choose` (confirms `handle_new_user()` trigger fires
   correctly) → created a family → landed on Today with the real daily
   brief card, correct family name, correct tab set for a parent/admin →
   signed out (confirmed the new `Shell` button both redirects _and_
   actually ends the server-side session — re-visiting `/` after
   bounced back to `/login`) → signed back in with the same
   email/password → requested a password reset for a nonexistent
   account at a real domain and confirmed the anti-enumeration message
   (a request to `...@example.com` was separately rejected by Supabase
   itself as an invalid/undeliverable domain — expected, unrelated to
   this app's code) → opened Settings and found `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
   was never set in Vercel at all (the toggle correctly reported "Push
   isn't configured for this deployment yet" rather than failing
   silently). Since `push_subscriptions` had zero rows in production
   (confirmed via a read-only count query — this feature had never been
   exercised by a real user), rotated the VAPID key pair fresh rather
   than trying to extract the existing one, updated the Supabase Edge
   Function secrets to match, and added `NEXT_PUBLIC_VAPID_PUBLIC_KEY` to
   both Preview and Production in Vercel. Requires a fresh deployment to
   take effect — not yet re-verified live as of this writing (Vercel env
   var changes don't apply to already-built deployments).
7. **The redeploy landed and the fix is confirmed** — re-tested on the
   fresh preview build: clicking "Enable push notifications" no longer
   shows "Push isn't configured for this deployment yet," confirming
   `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is now actually reaching the browser.
   What's _not_ confirmed: an actual subscription being created and a
   push notification being received. `Notification.requestPermission()`
   opens a native OS-level permission dialog outside the page's DOM —
   there's no human present in this environment to click "Allow," so
   browser automation can't drive this part any further than confirming
   the button no longer fails immediately. This needs a person to click
   through it once, for real, same caveat as Google Calendar OAuth
   connect and invite emails (still blocked on SMTP) and the daily-brief
   cron actually firing at the right wall-clock time (would need to wait
   for a real 7am Mountain tick to observe).

## Resolved since the previous snapshot (2026-07-20)

- **`/auth/error` route now exists** (`src/app/auth/error/page.tsx`),
  handling `oauth` / `otp` / `missing_profile` failure reasons with a
  friendly message and a link back to `/login`.
- **Google Calendar sync is no longer UI-only** — see Phase 5 above.
- **`accept_family_invite()` is now wired up.** `src/app/(app)/layout.tsx`
  calls it whenever a signed-in user has `family_id is null`, before
  falling through to `/onboarding/choose`. An invitee who clicks the
  emailed link and completes `/auth/confirm` is now auto-joined to the
  inviting family and lands straight in the app; only accounts with no
  matching pending invite (an organic signup) reach the
  create-or-join screen. See
  [04-auth-and-onboarding.md](./04-auth-and-onboarding.md).
- **Web Push now has a client-side subscribe flow.**
  `src/components/push-notifications-card.tsx` (Settings, every member)
  requests notification permission, calls `pushManager.subscribe()`, and
  upserts the resulting `{ endpoint, p256dh, auth }` into
  `push_subscriptions`. Setup now also deploys `send-push` and sets its
  `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` secrets (previously missing from
  the README/setup guide entirely) and adds
  `NEXT_PUBLIC_VAPID_PUBLIC_KEY` for the browser. See
  [05-notifications-and-push.md](./05-notifications-and-push.md).
- **New families no longer start with an unfixable empty zone rotation.**
  `create_family()` populates `zone_rotation.member_order` on creation,
  and `src/app/(app)/zones/page.tsx` now has UI for parents to reorder or
  pin zone assignees. (There is still no UI to edit the rotation order
  independent of zone assignment — see "intentional" section below for
  why that's by design.)
- **Calendar events gained location, notes, all-day toggle, edit/delete,
  and per-event sharing** (`src/app/(app)/calendar/page.tsx`, ~715
  lines). "Sharing" here means a per-event member picker controlling
  which family members see/attend a given event — distinct from the
  family-level invite/join system above.
- **Password reset is now implemented.** `/login` → `/auth/reset-password`
  → `resetPasswordForEmail()` → custom `recovery.html` email →
  `/auth/confirm` (`type=recovery`) → `/auth/update-password` →
  `updateUser({ password })`. See "Password reset" in
  [04-auth-and-onboarding.md](./04-auth-and-onboarding.md).
- **CSV/ICS export is now implemented** (`src/lib/export.ts`). "Export
  .ics" on Calendar exports every event (all dates, honoring the member
  filter chip) as a floating-local-time iCalendar file importable into
  Google/Apple/Outlook calendars. "Export CSV" on Tasks and Jobs exports
  the currently-filtered list. All client-side — no new Edge Function or
  RPC needed, since the data is already RLS-scoped to the caller's family.
  See [03-frontend.md](./03-frontend.md#library-helpers-srclib).
- **A backups doc now exists**
  ([08-backups-and-recovery.md](./08-backups-and-recovery.md)), since
  Free-tier Supabase has no automated backups/PITR. Covers what is/isn't
  already backed up (schema via git, nothing else), a manual data-backup
  script (`npm run backup` → `scripts/backup-db.sh`, wraps
  `supabase db dump --data-only -s public,auth`), a checklist of secrets
  that live outside Postgres entirely, and a disaster recovery runbook.
  Not yet exercised against a real second project.
- **A first Playwright E2E suite now exists** (`npm run test:e2e`,
  16 tests, all passing as of this writing): public-page rendering
  (`/login`, `/signup`, `/auth/reset-password`, `/auth/update-password`)
  and every protected route's auth-guard redirect to `/login`. Runs
  against a syntactically-valid but unreachable Supabase URL — no
  Docker/real project needed for this tier. Authenticated-flow coverage
  (sign-in, task/job/calendar CRUD, invites) is a deliberate, documented
  gap — see `tests/e2e/authenticated/README.md` — since writing untested
  specs against a backend this environment can't run would be worse than
  not having them. Along the way, found and documented a real Next.js 16
  dev-mode gotcha: accessing the dev server via `127.0.0.1` instead of
  `localhost` silently breaks client hydration entirely (see
  [06-setup-guide.md](./06-setup-guide.md)).
- **Offline support now goes beyond the app-shell cache** (`public/sw.js`):
  Supabase REST `GET`s (`/rest/v1/*`) are now cached network-first,
  auth-header-salted (so a shared device can't
  serve one signed-in family member's cached data to another), so an
  `(app)` tab that loses network doesn't blank its own state to `[]` when
  its on-mount re-fetch rejects. `src/components/offline-banner.tsx`
  shows "You're offline — showing the last data that loaded" so this
  isn't silent. Writing the Playwright test for this
  (`tests/e2e/offline.spec.ts`) also surfaced and fixed a real,
  independent bug that predates this change: the navigation cache-write
  in `sw.js` was `caches.open().then(...)`, detached from the promise
  passed to `respondWith()`, so a service worker killed right after
  responding could silently drop the write — pages visited while online
  were never reliably ending up cached for offline use at all. Now
  `await`ed everywhere. **Caveat**: Playwright could not verify the
  fetch-interception behavior itself in this environment — even a
  trivial, unconditional `fetch` event listener never received an event
  for a navigation or an in-page `fetch()` call, in both headless and
  headed mode, despite the worker reporting itself active/controlling.
  This matches a known class of Playwright/CDP limitation around service
  worker fetch dispatch, not a bug in the app; see the comment atop
  `tests/e2e/offline.spec.ts`. Verify by hand (Chrome DevTools →
  Application → Service Workers, or Network → Offline) before treating
  the caching behavior itself as proven, as distinct from "the worker
  registers and activates," which _is_ covered by that test.
- **`config.toml` now has a documented, scripted path to the real
  project.** `supabase db push` only ever applied migrations —
  `supabase/config.toml` itself (the custom invite/recovery email
  templates, `site_url`, `additional_redirect_urls`, rate limits, etc.)
  needed `npx supabase config push`, a separate command, which wasn't in
  setup docs anywhere. Added to both README.md and
  [06-setup-guide.md](./06-setup-guide.md), run right after `db push`.
  Also flagged a second, related trap while in there:
  `supabase/config.toml`'s `site_url`/`additional_redirect_urls` are
  hardcoded to the original author's own Vercel URL
  (`home-scheduler-xi.vercel.app`) as a committed placeholder — anyone
  standing this app up for their own family needs to change those to
  their own deployment URL _before_ running `config push`, or their
  invite/reset emails and OAuth redirects point at someone else's app.
  Now called out both in a comment above `site_url` in `config.toml`
  itself and in the setup guide's Deployment section.
- **The daily brief now actually fires at 7am local, and doesn't
  double-send.** Two bugs, found in the same production-readiness pass:
  (1) `cron.timezone` was never actually set (restart-only parameter on
  this Supabase tier, fails with `SQLSTATE 55P02` — see the comment in
  `20260719120000_web_push_cron.sql`), so the `0 7 * * *` schedule ran
  at 7am UTC, not 7am Mountain — the brief was firing around
  midnight–1am local the whole time. (2) `cron_send_daily_brief()`'s
  per-day `dedupe_key` was silently dropped by a later migration's
  rewrite of the function (`20260720000001_multi_tenant_families.sql`,
  needed to loop over every family) — harmless while the job only ran
  once a day at the wrong time, but would have sent duplicate pushes
  once fix #1 changed the schedule to poll more often. Both fixed in
  `20260721000001_fix_daily_brief_timezone.sql`: the job now runs every
  15 minutes and the function itself guards on the database's own
  (correctly-set) `timezone` GUC, only actually sending during the 7am
  local hour, with the dedupe key restored. See
  [05-notifications-and-push.md](./05-notifications-and-push.md). Not
  run against a real `pg_cron` scheduler (no Docker/live project
  available here) — reviewed, not tested live.
- **A sign-out flow now exists.** `Shell` (top bar, every `(app)` page)
  has a "Sign out" button — `supabase.auth.signOut()` then a hard
  redirect (`window.location.href`, not client routing) to `/login`, so
  no stale `FamilyProvider` state survives into whoever signs in next on
  the same device. Wasn't tracked as a gap anywhere before this pass;
  found by grepping for `signOut` and finding nothing.

## Things that look unfinished but are intentional

- `zone_rotation.member_order` has no _dedicated_ editing UI — the
  original prototype has none either; it's meant to be set once at setup
  time (now via `create_family()` at family creation, or the bootstrap
  template for the original single-household flow).
- `home-scheduler-prototype.html` at the project root is the frozen,
  approved UI/behavior spec, kept intentionally as a reference — it is
  not dead code to clean up.
- `supabase/bootstrap.sql.example` is deliberately kept even though
  superseded for new households — it's the documented manual-recovery
  path (see [04-auth-and-onboarding.md](./04-auth-and-onboarding.md)).

## Verification methodology so far

Per the top-level README: the schema has been validated against a real
local Postgres instance, exercising every RPC directly (zone rotation
math, dismiss-on-verify, job↔task sync, cross-role permission denials).
The Next.js app itself is verified via `npm run typecheck` / `npm run
lint` / `npm run build` plus manual review against the prototype's
behavior — it has **not** been exercised end-to-end in a browser against
a real backend. Do that (`supabase start` + `npm run dev`, or point
`.env.local` at a real linked project) before treating any UI flow as
done, especially the newer onboarding/invite paths described above.
