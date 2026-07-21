# Project Status

This reflects a direct read of the code as of **2026-07-21** (commit
`23dcb4e`). The project is under active development — treat this as a
snapshot, not a permanent contract. Cross-check against `git log` /
`git status` before relying on specifics.

## Build phases (per the original handoff spec, see top-level README)

- [x] **Phase 1** — Postgres schema, RLS, RPC business logic
- [x] **Phase 2** — Next.js app shell: Today / Calendar / Tasks tabs
- [x] **Phase 3** — Zones, Job Board, Settings tabs (all six tabs exist)
- [x] **Phase 4** — Real Web Push (VAPID) + Edge Functions + `pg_cron`
      (delivery infra — see the client-side gap below)
- [x] **Phase 5** — Google Calendar two-way sync. All five
      `google-calendar-{connect,callback,list,select,sync}` Edge Functions
      exist, and `src/components/google-calendar-card.tsx` (wired into
      Settings) drives a real OAuth connect → pick calendar → enable sync
      flow against `set_member_settings()`. Substantially complete, not a
      stub.
- [ ] **Phase 6** — Offline support (partial — the service worker already
      caches the app shell), CSV/ICS export, backups doc, Playwright tests.
      No progress beyond what Phase 2 shipped: no Playwright config/tests,
      no CSV/ICS export code, no backups doc found anywhere in the repo.

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
pages are complete, functional flows — not stubs. One gap remains, see
below.

## Known gaps, verified by reading the code

These aren't guesses — each was confirmed either by grepping for the
missing piece or by a `tsc --noEmit` run.

- **Web Push has no client-side subscribe flow.** The full delivery
  pipeline (cron → `notifications` insert → trigger → `send-push` Edge
  Function → `web-push`) is built and wired, but nothing in the frontend
  calls `pushManager.subscribe()` or writes a `push_subscriptions` row —
  `service-worker-register.tsx` only registers the service worker. Until
  a subscribe UI/flow is added, push notifications won't reach any
  device, even though the backend is fully functional. In-app
  notifications (the bell) are unaffected. See
  [05-notifications-and-push.md](./05-notifications-and-push.md).
- **`accept_family_invite()` is defined but never called from the
  frontend** (confirmed: the only reference outside
  `database.types.ts` is zero — no calls anywhere in `src/`, including
  `src/app/onboarding/join/page.tsx`). An invited user who clicks the
  emailed link and completes `/auth/confirm` currently lands as a normal
  new signup (`family_id = null` → `/onboarding/choose`) rather than
  being auto-joined to the family that invited them. The invite record
  and email delivery both work; only the final "match my email to my
  pending invite and join" step is unwired.
- **No password reset flow.** `/login` states this outright, and no
  reset/forgot-password page or logic exists anywhere under `src/app`.

## Resolved since the previous snapshot (2026-07-20)

- **`/auth/error` route now exists** (`src/app/auth/error/page.tsx`),
  handling `oauth` / `otp` / `missing_profile` failure reasons with a
  friendly message and a link back to `/login`.
- **Google Calendar sync is no longer UI-only** — see Phase 5 above.
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

## Things that look unfinished but are intentional

- `zone_rotation.member_order` has no *dedicated* editing UI — the
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
