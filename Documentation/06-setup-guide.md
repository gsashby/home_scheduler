# Setup Guide

For a condensed version of this, see the top-level [`README.md`](../README.md).
This doc adds detail on *why* each step exists.

## Prerequisites

- Node.js 20.9+ (Next.js 16 requirement)
- A free [Supabase](https://supabase.com) project
- A [Google Cloud](https://console.cloud.google.com) OAuth client (for
  Google sign-in; later also the Calendar API for two-way sync)
- The [Supabase CLI](https://supabase.com/docs/guides/cli) (`npx supabase`)
- Docker, only if you want the fully-local dev stack (`supabase start`)

## Environment variables (`.env.local`, copy from `.env.example`)

| Variable | Used by | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser + server Supabase clients | Public — the project's REST/Auth endpoint |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser + server Supabase clients | Public — RLS still governs what it can do |
| `VAPID_PUBLIC_KEY` | `send-push` Edge Function | From `npx web-push generate-vapid-keys` |
| `VAPID_PRIVATE_KEY` | `send-push` Edge Function | Same command — **secret**, never expose to the client |

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
```

In **Supabase Auth settings**, enable the **Google** provider with your
OAuth client id/secret, and set the redirect URL to
`<your-app-url>/auth/callback`.

```bash
npx web-push generate-vapid-keys   # → VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
cp .env.example .env.local         # fill in the values above
```

Deploy the two Edge Functions and set their secrets:

```bash
npx supabase functions deploy send-push
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
the Vercel project settings, with `NEXT_PUBLIC_SITE_URL` set to the
production URL. Add `<production-url>/auth/callback` to the Google OAuth
client's authorized redirect URIs alongside the localhost one.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run start` | Run the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run format` | Prettier, writes changes |
| `npm run format:check` | Prettier, check only (CI) |
