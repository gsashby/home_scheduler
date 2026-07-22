# Authenticated E2E tests

These specs exercise everything _past_ the login screen — real sign-in,
RLS-scoped data, and the `SECURITY DEFINER` RPCs (`create_task`,
`mark_task_done`, `verify_task`, `create_job`/`take_job`/`job_done`/`pay_job`,
calendar CRUD) — end to end through the UI, across two real sessions (a
parent and a kid). Unlike the offline tier one directory up, they need an
actual Postgres behind the app.

They are **gated**: `playwright.config.ts` only wires this project in when
`SUPABASE_SERVICE_ROLE_KEY` (plus the real `NEXT_PUBLIC_SUPABASE_URL` /
`NEXT_PUBLIC_SUPABASE_ANON_KEY`) is present. With none set, `npm run
test:e2e` runs exactly the original public/auth-guard tier and skips this
one — no failures, no Docker required.

> **Status:** authored and type-checked (`npm run typecheck` includes
> `tests/**`), and both config paths verified via `playwright test --list`.
> Not yet _executed_ here: this environment has no Docker, so
> `supabase start` can't run and no linked project was available. Run them
> against a real backend (below) before treating these flows as proven.

## Running them

1. **A real backend, seeded from `supabase/seed.sql`.** Either:
   - `npx supabase start` (local; auto-applies migrations + seed), or
   - a linked project with the schema applied and that seed loaded.

   The specs target the seeded **Petersons** family — specifically Mom
   (`mom@example.com`, parent) and Sara (`sara@example.com`, kid), by their
   stable seed UUIDs (see `helpers.ts`).

2. **Export the env and run:**

   ```bash
   export NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321"      # supabase start prints this
   export NEXT_PUBLIC_SUPABASE_ANON_KEY="<anon key>"             # ...and this
   export SUPABASE_SERVICE_ROLE_KEY="<service_role key>"         # ...and this
   npm run test:e2e
   ```

   > Next.js 16 dev-mode gotcha: use `localhost`, not `127.0.0.1`, for the
   > _app_ URL — see `Documentation/06-setup-guide.md`. (The Supabase URL
   > above is unrelated and can be `127.0.0.1`.)

## How it works

- **`auth.setup.ts`** (the `auth-setup` project, a dependency of the
  `authenticated` project) does two things once, up front:
  1. Uses the **service-role admin API** to set a known password on the
     seeded Mom/Sara accounts. The seed inserts them with an empty
     `encrypted_password`, so they can't be signed into otherwise — this is
     the standard fix.
  2. Signs each in through the real `/login` form (so the app's own
     `@supabase/ssr` browser client writes the session cookies the server
     layout reads back) and saves the result as Playwright `storageState`
     under `tests/e2e/.auth/{parent,kid}.json` (git-ignored).

- **The specs** then start already-authenticated from that `storageState`:
  - `smoke.spec.ts` — signed-in landing + role-scoped nav (a kid sees no
    Zones/Settings tab).
  - `tasks.spec.ts` — parent assigns → kid marks done → parent verifies,
    across two browser contexts.
  - `calendar.spec.ts` — add → edit → delete a calendar event.
  - `jobs.spec.ts` — parent posts → kid takes → kid finishes → parent pays.

  Where a session reads state changed by the _other_ session, the spec
  reloads rather than leaning on Realtime, so a Realtime hiccup can't make
  it flake; single-session reads rely on the page's own post-RPC refetch.
