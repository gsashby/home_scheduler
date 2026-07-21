# Backups & Disaster Recovery

This app runs on Supabase's **Free tier** by design (see the top-level
[`README.md`](../README.md): "$0 running cost"). Free-tier projects don't
come with the automated daily backups / point-in-time recovery that Pro
gives you — so, unlike schema, **data backup here is manual** and is the
project owner's (a parent's) responsibility. This doc covers what that
means in practice and how to recover if the project is ever lost, paused
for inactivity, or badly corrupted by a bug.

## What's already backed up, and what isn't

| What                                                                                                                             | Backed up?                                                                                                                                               | Where                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Schema, RLS policies, RPC functions                                                                                              | **Yes**                                                                                                                                                  | `supabase/migrations/*.sql`, in git. Restoring = `supabase db push` against a fresh project. |
| App code, email/config templates                                                                                                 | **Yes**                                                                                                                                                  | This repo (GitHub).                                                                          |
| Family data (profiles, calendar, tasks, jobs, zones, notifications, `google_tokens`, `push_subscriptions`, etc.)                 | **No** — needs a manual dump                                                                                                                             | `scripts/backup-db.sh` (below)                                                               |
| `auth.users` (accounts, password hashes)                                                                                         | **No** — needs a manual dump                                                                                                                             | Same script, `-s public,auth`                                                                |
| Edge Function secrets (`VAPID_PUBLIC_KEY`/`_PRIVATE_KEY`, `SITE_URL`, `GOOGLE_CLIENT_ID`/`_SECRET`, `GOOGLE_OAUTH_STATE_SECRET`) | **No** — not in Postgres at all                                                                                                                          | See "Secrets checklist" below                                                                |
| Vault secret (`supabase_secret_key`)                                                                                             | **No** — technically inside Postgres, but encrypted with a key tied to _this_ project; doesn't reliably decrypt after restoring into a different project | Same checklist                                                                               |
| Vercel env vars (`.env.local` equivalents in production)                                                                         | **No** — only variable _names_ are documented (`.env.example`); real values live only in the Vercel dashboard                                            | Same checklist                                                                               |
| Google Cloud OAuth client (redirect URIs)                                                                                        | **No** — lives in Google Cloud Console, outside both Supabase and this repo                                                                              | Same checklist                                                                               |

The pattern: anything that's _code_ is already safe in git. Anything
that's _data or a secret_ lives only in the live Supabase project /
Vercel dashboard / Google Cloud Console, and is what this doc addresses.

## Data backups

`scripts/backup-db.sh` wraps the Supabase CLI's built-in dump command:

```bash
npm run backup
```

Equivalent to:

```bash
npx supabase db dump --linked --data-only -s public,auth -f backups/<timestamp>.sql
```

- **`--data-only`**: schema is already version-controlled in migrations —
  dumping it again would just create conflicts when restoring into an
  already-migrated project. This captures rows, not table definitions.
- **`-s public,auth`**: `public` is all the app's own tables; `auth` adds
  Supabase Auth's own `users` table (accounts + password hashes) — without
  it, restoring elsewhere gives you all the family's data with no way for
  anyone to sign back into it. (`storage` is deliberately omitted — this
  app doesn't use Supabase Storage; see `06-setup-guide.md`.)
- Requires `npx supabase link --project-ref <ref>` to have been run once
  (same as every other Supabase CLI command in this repo).

**Treat every dump file as a secret.** It contains real names, real
Google Calendar OAuth access/refresh tokens (`google_tokens`, stored as
plaintext columns — see `02-database-schema.md`), and password hashes
(`auth.users.encrypted_password`). `backups/` is gitignored as a safety
net, but the actual file should live somewhere encrypted and
access-restricted — a password manager's secure file storage, an
encrypted disk image, etc. — never a plain cloud folder or email
attachment.

### Cadence

There's no CI/scheduled job doing this automatically (no `.github/workflows`
exist in this repo, and adding one means giving GitHub Actions its own
copy of Supabase credentials as secrets — a real tradeoff, not a free
convenience). Given the low stakes of a family scheduling app, manual is
the pragmatic choice:

- Run `npm run backup` before anything risky: a schema migration against
  production, a bulk data edit, a Supabase project upgrade/downgrade.
- Run it periodically anyway — monthly is reasonable for this app's rate
  of change — as a rolling safety net independent of any specific change.
- Keep at least the last 2-3 backups, not just the latest one, in case a
  bug corrupts data silently and isn't noticed until a later backup would
  already have it baked in.

If this ever needs to be truly automated, the shape would be a scheduled
GitHub Actions workflow running `scripts/backup-db.sh` with
`SUPABASE_ACCESS_TOKEN`/`SUPABASE_DB_PASSWORD` as repo secrets, uploading
the result to encrypted storage (not a workflow artifact — those aren't
private in the way a family's data warrants). Not implemented here;
flagging the shape for whoever picks it up later.

### Secrets checklist

Not a backup file — a list of what to have on hand (in a password
manager, not in git) so a fresh project can be reconfigured after a
restore. Values, not names, are the sensitive part; names are already
documented in `06-setup-guide.md`:

- Edge Function secrets: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
  `SITE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
  `GOOGLE_OAUTH_STATE_SECRET`
- Vault secret: `supabase_secret_key` (the project's own `sb_secret_...`
  API key)
- Vercel project env vars: everything in `.env.example`, plus
  `NEXT_PUBLIC_SITE_URL`
- Google Cloud OAuth client ID/secret, and its two authorized redirect
  URIs (sign-in + Calendar-scoped — see README setup steps 3 and 7)

## Disaster recovery runbook

Starting from nothing but this repo, a data dump, and the secrets
checklist above:

1. **Create the Supabase project** (or reuse the existing one if it's
   just corrupted data, not a lost project) and apply the schema:

   ```bash
   npx supabase link --project-ref <ref>
   npx supabase db push
   ```

2. **Restore data.** Get the direct (non-pooler) connection string from
   the Supabase dashboard (Settings → Database → Connection string → URI)
   — pg_dump/restore need a session-level connection, not the transaction
   pooler used elsewhere in the app:

   ```bash
   psql "<direct-connection-string>" -f backups/<timestamp>.sql
   ```

   The dump's `INSERT`s already respect FK order (`auth.users` before
   `public.profiles`, etc.) since `pg_dump` resolves table dependencies
   itself.

3. **Re-set secrets** from the checklist above:

   ```bash
   npx supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=...
   npx supabase secrets set SITE_URL=...
   npx supabase secrets set GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... GOOGLE_OAUTH_STATE_SECRET=...
   ```

   and set the real `supabase_secret_key` Vault value via
   `vault.update_secret()` in the SQL editor (see `06-setup-guide.md`).

4. **Redeploy every Edge Function** (a fresh project has none deployed
   yet):

   ```bash
   npx supabase functions deploy send-push send-invite google-calendar-connect google-calendar-callback google-calendar-list google-calendar-select google-calendar-sync
   ```

5. **Update Vercel** with the (possibly new) project's
   `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` and
   redeploy.

6. **If the project ref or site URL changed**, update the Google Cloud
   OAuth client's authorized redirect URIs to match (both the sign-in one
   and the Calendar-scoped one — README setup steps 3 and 7), and update
   the `SITE_URL` secret from step 3 accordingly.

7. **Verify**: sign in, confirm a known family's data is present, post a
   test task/event, and check that Google Calendar sync and push still
   fire — each depends on a secret from step 3 being right.

This hasn't been exercised end-to-end against a real second project (no
Supabase/Docker stack available in the environment these docs were
authored in — see the verification-methodology note in
[07-project-status.md](./07-project-status.md)). Treat it as a reviewed
runbook, not a tested one, until someone actually runs it once.
