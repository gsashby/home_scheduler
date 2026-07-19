# Home Scheduler

A shared family calendar, task-assignment workflow, and rotating chore-zone
tracker — an installable web app (PWA), not a native app, so it works the
same on iPhones and laptops with no App Store and no paid developer account.

See the product requirements this scaffold implements in the original
requirements doc (shared separately) for the full feature list and rationale.
In short: **Next.js (App Router) + Supabase (Postgres/Auth/Realtime) +
Vercel**, chosen to stay at $0 running cost while keeping the whole thing
maintainable by one person.

## What's here

This is a **dev environment scaffold**, not a finished app. It sets up the
architecture and wiring; the actual calendar/task/zone features are
placeholders that read from (but mostly don't yet write to) real tables.

- Next.js 16 App Router, TypeScript, Tailwind v4
- PWA basics: `public/manifest.webmanifest`, a hand-rolled `public/sw.js`
  (offline app-shell caching + web push display), placeholder icons in
  `public/icons/`
- Supabase client wiring: `src/lib/supabase/{client,server}.ts`,
  `src/proxy.ts` (session refresh), `src/app/auth/callback/route.ts` (Google
  OAuth callback)
- Initial Postgres schema + Row Level Security in
  `supabase/migrations/20260719000001_init_schema.sql` — families, profiles
  (parent/kid role + per-person color), calendar_events, tasks + subtasks,
  personal lists, chore zones + rotating assignments, push subscriptions
- Route skeleton: `/login`, and an authenticated shell at `/calendar`,
  `/tasks`, `/lists`, `/zones`

## Prerequisites

- Node.js 20.9+ (Next.js 16 requirement)
- A free [Supabase](https://supabase.com) project
- A [Google Cloud](https://console.cloud.google.com) OAuth client (for
  sign-in, and later the Calendar API for two-way sync)

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a Supabase project, then run the migration against it:

   ```bash
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```

   (Or paste `supabase/migrations/20260719000001_init_schema.sql` into the
   Supabase SQL editor.)

3. In Supabase Auth settings, enable the **Google** provider using your
   Google OAuth client ID/secret, with redirect URL
   `<your-app-url>/auth/callback`.

4. Generate a Web Push (VAPID) key pair for notifications:

   ```bash
   npx web-push generate-vapid-keys
   ```

5. Copy `.env.example` to `.env.local` and fill in the values from steps 2–4:

   ```bash
   cp .env.example .env.local
   ```

6. After creating a family + first parent profile row in the `profiles`
   table (see the schema — `role = 'parent'`), run the dev server:

   ```bash
   npm run dev
   ```

## Scripts

| Command                | Purpose                   |
| ---------------------- | ------------------------- |
| `npm run dev`          | Start the dev server      |
| `npm run build`        | Production build          |
| `npm run start`        | Run the production build  |
| `npm run lint`         | ESLint                    |
| `npm run typecheck`    | `tsc --noEmit`            |
| `npm run format`       | Prettier, writes changes  |
| `npm run format:check` | Prettier, check only (CI) |

Once you have a Supabase project linked, regenerate typed database types with:

```bash
npx supabase gen types typescript --project-id <project-ref> > src/lib/supabase/database.types.ts
```

(`src/lib/supabase/database.types.ts` ships as an untyped placeholder until
you do this.)

## Deployment

Deploy to [Vercel](https://vercel.com) (Hobby tier is $0 and covers family
scale). Set the same environment variables from `.env.local` in the Vercel
project settings. `NEXT_PUBLIC_SITE_URL` should be your production URL, and
the Google OAuth client's authorized redirect URI needs
`<production-url>/auth/callback` added alongside the localhost one.

## Not yet built

Two-way Google Calendar sync, notification scheduling (daily brief,
deadline alerts, on-demand nudges — needs a Supabase Edge Function + pg_cron
job), the actual task assign/verify/delete UI, zone rotation automation, and
photo/file schedule import are all still open. The schema and route
skeleton are laid out to support them without a rework.
