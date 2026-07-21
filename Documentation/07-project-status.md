# Project Status

This reflects a direct read of the code as of **2026-07-21**, including
the `accept_family_invite()` wiring, the Web Push subscribe flow, the
password reset flow, CSV/ICS export, the backups doc, a first Playwright
suite, offline support, and the `config.toml` → production sync fix. The
project is under active development — treat this as a snapshot, not a
permanent contract. Cross-check against `git log` / `git status` before
relying on specifics.

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
