# Project Status

This reflects a direct read of the code as of **2026-07-20**. The project
is under active development — treat this as a snapshot, not a permanent
contract. Cross-check against `git log` / `git status` before relying on
specifics.

## Build phases (per the original handoff spec, see top-level README)

- [x] **Phase 1** — Postgres schema, RLS, RPC business logic
- [x] **Phase 2** — Next.js app shell: Today / Calendar / Tasks tabs
- [x] **Phase 3** — Zones, Job Board, Settings tabs (all six tabs exist)
- [x] **Phase 4** — Real Web Push (VAPID) + Edge Functions + `pg_cron`
      (delivery infra — see the client-side gap below)
- [ ] **Phase 5** — Google Calendar two-way sync (Settings has the
      sharing-preference UI wired to the database already; the OAuth
      connect flow itself is this phase — `google_tokens` table and
      `calendar_events.google_*` columns exist and are ready for it)
- [ ] **Phase 6** — Offline support (partial — the service worker already
      caches the app shell), CSV/ICS export, backups doc, Playwright tests

## Multi-tenant rework (in progress, on top of Phase 1–4)

Not part of the original phase list — a later architectural change
turning the single-household closed-allowlist app into a proper
multi-tenant, self-serve-signup product. Migrations
`20260720000001_multi_tenant_families.sql` and
`20260720000002_family_invites_generalize.sql`, plus new/changed
frontend under `src/app/onboarding/`, `src/app/signup/`,
`src/app/(app)/layout.tsx`, `src/app/login/page.tsx`,
`src/components/invite-form.tsx`. See
[04-auth-and-onboarding.md](./04-auth-and-onboarding.md) for the full
flow. This is mid-flight — several files touching it are uncommitted at
the time of writing (`git status`).

## Known gaps, verified by reading the code

These aren't guesses — each was confirmed either by grepping for the
missing piece or by a `tsc --noEmit` run.

- **`/auth/error` route doesn't exist.** It's the redirect target from
  `(app)/layout.tsx` (missing `profiles` row), `auth/callback/route.ts`,
  and `auth/confirm/route.ts` (any OAuth/OTP failure), but there's no
  `src/app/auth/error/` page — hitting any of those failure paths right
  now is a 404 instead of a friendly error screen.
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
  frontend** (confirmed: no references outside the generated
  `database.types.ts`). An invited user who clicks the emailed link and
  completes `/auth/confirm` currently lands as a normal new signup
  (`family_id = null` → `/onboarding/choose`) rather than being
  auto-joined to the family that invited them. The invite record and
  email delivery both work; only the final "match my email to my pending
  invite and join" step is unwired.
- **New families start with an empty zone rotation order.**
  `create_family()` inserts a `zone_rotation` row with
  `member_order = '{}'`. There's no Settings/Zones UI to populate it, so
  any non-pinned zone (`zones.assigned_to is null`) won't resolve an
  assignee for a brand-new family until `member_order` is set by hand in
  SQL (or via the bootstrap template). Zones pinned to a specific member
  work fine regardless.
- **Google Calendar sync is UI-only.** Settings renders the per-member
  sync toggle and sharing-preference selector, and they persist real
  values via `set_member_settings()`, but there's no actual Google OAuth
  connect flow or sync job yet (Phase 5, not started). The README's
  Settings copy says this explicitly.
- **No password reset flow.** `/login` states this outright.

## Things that look unfinished but are intentional

- `zone_rotation.member_order` has no editing UI *at all*, even for
  established families — the original prototype has none either; it's
  meant to be set once at setup time.
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
