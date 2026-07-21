# Setup Guide

For a condensed version of this, see the top-level [`README.md`](../README.md).
This doc adds detail on _why_ each step exists.

## Prerequisites

- Node.js 20.9+ (Next.js 16 requirement)
- A free [Supabase](https://supabase.com) project
- A [Google Cloud](https://console.cloud.google.com) OAuth client (for
  Google sign-in; later also the Calendar API for two-way sync)
- The [Supabase CLI](https://supabase.com/docs/guides/cli) (`npx supabase`)
- Docker, only if you want the fully-local dev stack (`supabase start`)

## Environment variables (`.env.local`, copy from `.env.example`)

| Variable                        | Used by                                 | Notes                                                                                                                                                                                 |
| ------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Browser + server Supabase clients       | Public — the project's REST/Auth endpoint                                                                                                                                             |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser + server Supabase clients       | Public — RLS still governs what it can do                                                                                                                                             |
| `VAPID_PUBLIC_KEY`              | `send-push` Edge Function               | From `npx web-push generate-vapid-keys`. Listed here for reference — the Edge Function actually reads it from its own Supabase secret (`supabase secrets set`), not from `.env.local` |
| `VAPID_PRIVATE_KEY`             | `send-push` Edge Function               | Same command — **secret**, never expose to the client. Same caveat: set via `supabase secrets set`, not read from `.env.local`                                                        |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`  | Browser (`push-notifications-card.tsx`) | Same value as `VAPID_PUBLIC_KEY` above, exposed to the client so `pushManager.subscribe()` can use it — VAPID public keys aren't secret                                               |

Two more secrets live outside `.env.local`, set directly against the
Supabase project (not via Next.js env vars):

- **`supabase_secret_key`** (Supabase Vault secret) — the project's
  `sb_secret_...` API key, used by the `trigger_send_push` /
  `trigger_send_invite` Postgres triggers to authenticate their
  `net.http_post` calls to Edge Functions. The migration creates the
  Vault entry with a `REPLACE_ME` placeholder; set the real value once
  via `vault.update_secret()` in the SQL editor.
- **`SITE_URL`** (Edge Function secret, `npx supabase secrets set
SITE_URL=<url>`) — so invite emails link back to this app's
  `/auth/confirm` instead of Supabase's default confirmation page.

## First-time project setup

```bash
npm install
npx supabase link --project-ref <your-project-ref>
npx supabase db push        # applies every migration in order
npx supabase config push    # syncs supabase/config.toml itself -- see the
                             # note below on site_url before running this
```

`db push` and `config push` are separate and both needed: migrations
(tables/RLS/functions) vs. everything in `config.toml` (auth settings,
`additional_redirect_urls`, and — once SMTP is configured — the custom
invite/password-reset email templates in `[auth.email.template.*]`,
pointing at `supabase/templates/*.html`). Confirmed directly against a
real project: `config push` doesn't silently skip the parts it can't
apply, it **fails outright** — free-tier projects on Supabase's default
email provider reject the whole push with "Email template modification
is not available for free tier projects using the default email
provider" the moment `[auth.email.template.*]` is present, even if
everything else in the file is fine. That's why those two sections are
commented out in the committed `config.toml` (re-enable once
`[auth.email.smtp]` is configured and working) — otherwise `config push`
never gets past them to apply anything else, including
`additional_redirect_urls`, which the app's actual auth flows depend on
(see the comment above that setting in `config.toml`). Re-run
`config push` any time `config.toml` changes, not just once at setup.

In **Supabase Auth settings**, enable the **Google** provider with your
OAuth client id/secret, and set the redirect URL to
`<your-app-url>/auth/callback`.

```bash
npx web-push generate-vapid-keys   # → VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
cp .env.example .env.local         # fill in the values above, including
                                    # NEXT_PUBLIC_VAPID_PUBLIC_KEY = the same public key
```

Deploy the two Edge Functions and set their secrets:

```bash
npx supabase functions deploy send-push
npx supabase secrets set VAPID_PUBLIC_KEY=<the-public-key> VAPID_PRIVATE_KEY=<the-private-key>
npx supabase functions deploy send-invite
npx supabase secrets set SITE_URL=<your-app-url>
```

Set the real `supabase_secret_key` Vault value (SQL editor, service
role):

```sql
select vault.update_secret(
  (select id from vault.secrets where name = 'supabase_secret_key'),
  '<your-project-secret-api-key>'
);
```

Run the app:

```bash
npm run dev
```

Access it via `http://localhost:3000`, not `http://127.0.0.1:3000` —
Next.js 16's dev-mode `allowedDevOrigins` check silently rejects requests
from origins it doesn't recognize as "the same machine," and `127.0.0.1`
apparently doesn't count as equivalent to `localhost` out of the box. The
visible symptom is narrow ("Blocked cross-origin request to Next.js dev
resource" in the server log) but the actual effect is much bigger: client
hydration fails entirely and silently — the page still renders (SSR HTML
is unaffected), but no `onClick`/`onSubmit`/`useEffect` ever runs, so
nothing on the page actually works. Found while getting
`tests/e2e/` running in this repo — see `playwright.config.ts`, which
uses `localhost` for exactly this reason.

## First-time family setup

Two options, since the multi-tenant self-serve flow now covers what used
to require manual SQL — see
[04-auth-and-onboarding.md](./04-auth-and-onboarding.md) for the full
flow:

1. **Normal path (recommended)**: sign up at `/signup`, then
   **Create a new family** on `/onboarding/choose`. You become the family
   admin automatically; invite the rest of the family from Settings or
   the optional invite step right after creating the family. No SQL
   needed.
2. **Manual/legacy path**: `supabase/bootstrap.sql.example` — a template
   for hand-provisioning `profiles` rows, subjects, zone rotation order,
   and starter zones for a specific family directly in the SQL editor
   (service role). Documented as superseded for new households, kept for
   recovery scenarios. Never commit a filled-in copy — it contains real
   emails/UUIDs.

Note that a fresh `create_family()` call creates an **empty**
`zone_rotation.member_order` — there's no UI yet to set the rotation
order, so zones with no pin (`zones.assigned_to is null`) won't resolve
an assignee until that's populated (via the bootstrap template, or
directly in SQL). See [07-project-status.md](./07-project-status.md).

## Local development without a real Supabase project

```bash
npx supabase start   # requires Docker
```

Spins up a full local Postgres + Auth + Storage + Realtime stack and
auto-applies every migration plus `supabase/seed.sql` on `supabase db
reset` (or first `start`). The seed data creates **two fully separate
families** specifically to exercise multi-tenant isolation locally, not
just single-household behavior:

- **"The Petersons"** (`invite_code: MAPLE-1234`) — 5 people (Dad, Mom,
  Sara, David, JJ), mirroring the original prototype's demo data exactly,
  plus a sample in-progress paid job.
- **"The Second Family"** (`invite_code: CEDAR-5678`) — 2 people (Alex,
  Riley), included purely to prove that a second tenant's data never
  leaks alongside the first's.

Seeded `auth.users` rows have empty `encrypted_password`, so they aren't
directly usable with password sign-in as-is — use Supabase Studio (the
local dashboard `supabase start` prints a URL for) to set a password or
generate a magic link for whichever seeded account you want to sign in
as. Never run `seed.sql` against the real production project.

## Regenerating database types

```bash
npx supabase gen types typescript --project-id <project-ref> > src/lib/supabase/database.types.ts
```

`database.types.ts` is currently **hand-written** to match the migrations
(there's no real project to generate it from during initial development).
Diff before overwriting — some RPC function argument/return shapes may
need manually re-applying after a real generation.

## Deployment

Deploy to [Vercel](https://vercel.com) (Hobby tier is $0 and covers
family scale). Set the same environment variables from `.env.local` in
the Vercel project settings — **for every environment that needs them**;
`NEXT_PUBLIC_*` vars must be set for Preview as well as Production if
preview deployments (e.g. one per PR) should work, not just Production
alone — with `NEXT_PUBLIC_SITE_URL` set to the production URL. Add
`<production-url>/auth/callback` to the Google OAuth client's authorized
redirect URIs alongside the localhost one.

If you're forking this repo for your own family's own Supabase project
(rather than using the original author's — see the comment above
`site_url` in `config.toml`), update `supabase/config.toml`'s `[auth]`
`site_url` and `additional_redirect_urls` to your real production URL
and re-run `npx supabase config push`. `site_url` is what gets baked
into the invite/password-reset email links (`{{ .SiteURL }}` in
`supabase/templates/*.html`) and what `additional_redirect_urls` gates
for OAuth/magic-link/reset `redirectTo` values — get this wrong and
those emails link back to someone else's app instead of yours.
`additional_redirect_urls` needs the _exact subpaths_ the app actually
redirects to (`/auth/callback`, `/auth/confirm`,
`/auth/update-password` — see the comment above that setting in
`config.toml`), not just the bare origin.

## Scripts

| Command                | Purpose                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`          | Start the dev server                                                                                                                                    |
| `npm run build`        | Production build                                                                                                                                        |
| `npm run start`        | Run the production build                                                                                                                                |
| `npm run lint`         | ESLint                                                                                                                                                  |
| `npm run typecheck`    | `tsc --noEmit`                                                                                                                                          |
| `npm run format`       | Prettier, writes changes                                                                                                                                |
| `npm run format:check` | Prettier, check only (CI)                                                                                                                               |
| `npm run backup`       | Dumps family data + accounts from the linked Supabase project (`scripts/backup-db.sh`) — see [08-backups-and-recovery.md](./08-backups-and-recovery.md) |
| `npm run test:e2e`     | Playwright — public pages + auth-guard redirects only; see `tests/e2e/authenticated/README.md` for what's deliberately not covered yet                  |
