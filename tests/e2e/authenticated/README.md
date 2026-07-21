# Authenticated E2E tests — not yet implemented

`playwright.config.ts` deliberately excludes this directory
(`testIgnore: ["**/authenticated/**"]`). Everything under `tests/e2e/`
outside this folder runs against a syntactically-valid but _unreachable_
`NEXT_PUBLIC_SUPABASE_URL` — no Docker, no Supabase project, no
network access needed. That covers public-page rendering and the
`(app)`/`onboarding` layout auth guards (both just check "is there a
session," and "no reachable backend" and "no session" look identical to
that check).

Everything _past_ the login screen — sign-in with real credentials,
RLS-scoped data, RPC calls (`mark_task_done`, `take_job`,
`accept_family_invite`, zone rotation, etc.), Realtime updates — needs an
actual Postgres behind it, which wasn't available in the environment this
suite was authored in (no Docker — see the verification-methodology note
in `Documentation/07-project-status.md`). Rather than write specs no one
has run and call them done, this is left as a clearly-marked gap.

## Shape this would take

1. **A real backend.** Either `npx supabase start` (local, uses
   `supabase/seed.sql`'s two seeded families) or a linked project with the
   schema applied.
2. **A test user with a real password.** The seed data's `auth.users`
   rows have empty `encrypted_password` (see `06-setup-guide.md`) — not
   directly usable with `signInWithPassword`. The standard fix is a
   Playwright `globalSetup` that uses the Supabase **service role key**
   (`supabase.auth.admin.createUser()` or `updateUserById()` to set a
   password on a seeded account) to get a signable-in account
   programmatically, then signs in via the UI or API and saves the
   resulting session as Playwright `storageState` (e.g.
   `tests/e2e/authenticated/.auth/user.json`, already gitignored) so
   individual specs don't each pay the login cost.
3. **Specs against the seeded "Petersons" family** (`supabase/seed.sql`):
   sign in → land on Today; parent assigns a task, kid marks it done,
   parent verifies it; add/edit/delete a calendar event; take and pay a
   job; zone rotation advances a cycle. Each of these already has a
   `SECURITY DEFINER` RPC backing it (see `02-database-schema.md`) — the
   point of these tests would be confirming the RPC + RLS + UI wiring
   together, not re-testing business logic already exercised directly
   against Postgres (per the top-level README's existing verification
   note).
4. Wire a second Playwright project/config (or drop `testIgnore` once
   `globalSetup` exists) so `npm run test:e2e` can pick these up whenever
   `SUPABASE_SERVICE_ROLE_KEY`/a linked project are present, and skip them
   cleanly otherwise.
