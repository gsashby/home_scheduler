# Project Status

This reflects a direct read of the code as of **2026-07-21**, including
the `accept_family_invite()` wiring, the Web Push subscribe flow, the
password reset flow, CSV/ICS export, the backups doc, and a first
Playwright suite. The project is under active development — treat this
as a snapshot, not a permanent contract. Cross-check against `git log` /
`git status` before relying on specifics.

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
- [ ] **Phase 6** — partially done. CSV/ICS export, the backups doc, and
      a first Playwright suite are now shipped (see below); offline
      support is still only what Phase 2 shipped (service worker caches
      the app shell, nothing more).

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

Only what's left of Phase 6 (above): offline support beyond the
app-shell cache, and authenticated-flow E2E coverage (sign-in, task/job/
calendar CRUD, invites) — see `tests/e2e/authenticated/README.md` for
that specific boundary. Every other previously tracked gap (`/auth/error`,
`accept_family_invite()` wiring, the Web Push subscribe flow, password
reset, CSV/ICS export, backups doc, a first Playwright suite) has been
resolved; see below.

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
