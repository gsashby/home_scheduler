# Frontend

Next.js App Router, all pages under `src/app/`. TypeScript throughout;
`src/lib/supabase/database.types.ts` provides typed table/RPC shapes for
both the browser and server Supabase clients.

## Route map

| Route                | File                                 | Notes                                                                                  |
| -------------------- | ------------------------------------ | -------------------------------------------------------------------------------------- |
| `/login`             | `src/app/login/page.tsx`             | Google OAuth or email/password sign-in                                                 |
| `/signup`            | `src/app/signup/page.tsx`            | Google OAuth or email/password sign-up                                                 |
| `/auth/callback`     | `src/app/auth/callback/route.ts`     | Exchanges the Google OAuth `code` for a session                                        |
| `/auth/confirm`      | `src/app/auth/confirm/route.ts`      | Verifies `token_hash` links from Supabase emails (invites, etc.)                       |
| `/onboarding/choose` | `src/app/onboarding/choose/page.tsx` | "Create a family" vs "Join a family" — shown to any signed-in user with no `family_id` |
| `/onboarding/create` | `src/app/onboarding/create/page.tsx` | Calls `create_family()`, then → `/onboarding/invite`                                   |
| `/onboarding/join`   | `src/app/onboarding/join/page.tsx`   | Calls `join_family_by_code()`, then → `/`                                              |
| `/onboarding/invite` | `src/app/onboarding/invite/page.tsx` | Optional "invite your family" step after creating a family (uses `InviteForm`)         |
| `/`                  | `src/app/(app)/page.tsx`             | **Today** tab                                                                          |
| `/calendar`          | `src/app/(app)/calendar/page.tsx`    | **Calendar** tab                                                                       |
| `/tasks`             | `src/app/(app)/tasks/page.tsx`       | **Tasks** tab                                                                          |
| `/zones`             | `src/app/(app)/zones/page.tsx`       | **Zones** tab (parent-only nav entry)                                                  |
| `/jobs`              | `src/app/(app)/jobs/page.tsx`        | **Job Board** tab                                                                      |
| `/settings`          | `src/app/(app)/settings/page.tsx`    | **Settings** tab (parent-only nav entry)                                               |

The `(app)` route group shares one layout (`src/app/(app)/layout.tsx`)
that provides auth + family context to every tab below it.

## The `(app)` layout: auth guard + data hydration

`src/app/(app)/layout.tsx` runs on the server for every request under the
group:

1. Get the current user (`supabase.auth.getUser()`); if none, redirect to
   `/login`.
2. Load the caller's own `profiles` row. If it's missing entirely, that's
   an unexpected state (every signup should get one via the
   `on_auth_user_created` trigger — see
   [04-auth-and-onboarding.md](./04-auth-and-onboarding.md)), so redirect
   to `/auth/error`.
3. If `profiles.family_id` is `null`, redirect to `/onboarding/choose` —
   this is the normal "signed up, hasn't picked a family yet" state.
4. Otherwise, fetch the `families` row and every `profiles` row in that
   family, and render `FamilyProvider` → `Shell` → the tab's `children`.

Nothing under `(app)/` needs to re-check auth or re-fetch "who's in my
family" — it's all provided by context.

## `FamilyProvider` (`src/lib/family-context.tsx`)

Client-side context wrapping every `(app)` page. Exposes:

```ts
{
  (me, members, family, isParent, isFamilyAdmin, memberById(id));
}
```

`members` is seeded from the server-fetched list and kept live via a
Realtime subscription on `profiles` `UPDATE` events filtered to the
family (`filter: family_id=eq.<id>`) — e.g. so everyone sees a role change
made in Settings without a refresh.

Access via the `useFamily()` hook. Throws if called outside the provider
(all `(app)/**` pages are inside it; `/login`, `/signup`, and
`/onboarding/**` are not).

## Shared UI components

- **`src/components/ui.tsx`** — `Button` (variants: primary/secondary/
  ok/warn/danger, sizes sm/md), `Card`, `Chip`, `Swatch` (color dot),
  `Tag`, `StatusBadge` (task status pill), `Empty` (empty-state box).
- **`src/components/modal.tsx`** — `Modal`, `Field` (labeled form row),
  `TextInput`, `Select`, `TextArea`.
- **`src/components/shell.tsx`** — top bar (family name/privacy badge,
  current user, notifications bell, sign out) + tab nav. Tab visibility:
  Zones and Settings only render as nav links for `isParent`. Sign out
  calls `supabase.auth.signOut()` then hard-redirects to `/login`
  (`window.location.href`, not client-side routing, so no stale
  `FamilyProvider` state survives into the next session on a shared
  device).
- **`src/components/notifications-bell.tsx`** — loads the caller's last
  100 notifications, subscribes to `INSERT`/`UPDATE` on `notifications`
  filtered to `to_profile_id=eq.<me>`, renders an unread-count badge and a
  slide-over panel; "mark all read" calls the `mark_all_read()` RPC.
- **`src/components/invite-form.tsx`** — `InviteForm`, shared between the
  Settings "Invite a family member" card and the
  `/onboarding/invite` step. Collects email/name/role/color and calls
  `create_family_invite()`; doesn't need to know which context it's
  rendered in since the RPC itself is admin-gated and family-scoped.
- **`src/components/service-worker-register.tsx`** — client component
  that registers `/sw.js` on mount; mounted from the root layout.

## Library helpers (`src/lib/`)

- **`date.ts`** — `todayISO()`, `fmtDay()`, `fmtTime()`, `relDay()`
  (formatting helpers for dates/times as they appear in the UI).
- **`categories.ts`** — `CATEGORY_LABELS`, `categoryLabel()` (handles the
  "School · {subject}" special case), `TOP_CATEGORIES` (the four
  top-level groupings — School/Work/Home/Personal — the Tasks tab buckets
  tasks under; `zone` tasks group under Home, `goal` under Personal).
- **`notifications.ts`** — `NOTIF_KIND_LABELS` (human labels for each
  `notif_kind`).
- **`export.ts`** — `toCSV()` / `toICS()` / `downloadFile()`: client-side
  CSV/ICS export, no server round-trip (the data is already RLS-scoped to
  the caller's own family — these just format what's in memory and
  trigger a browser download via a Blob object URL). Used by the "Export
  .ics" button on Calendar (all events, honoring the member filter chip,
  across every date — not just the visible view) and "Export CSV" on
  Tasks and Jobs. ICS events are emitted as floating local time (no
  timezone), matching the app's single-family-timezone assumption (see
  [05-notifications-and-push.md](./05-notifications-and-push.md)).
- **`toast.tsx`** — `ToastProvider` / `useToast()`, mounted once in the
  `(app)` layout.
- **`family-context.tsx`** — see above.
- **`supabase/client.ts`** — `createClient()` for Client Components
  (`createBrowserClient`).
- **`supabase/server.ts`** — `createClient()` for Server Components/Route
  Handlers (`createServerClient`, cookie-backed). Note the `setAll` no-op
  wrapped in a `try`/`catch`: cookie writes from a Server Component during
  rendering are a no-op by design — session refresh persistence happens in
  `src/proxy.ts` instead.
- **`supabase/database.types.ts`** — hand-written to mirror the migrations
  (see the note in [06-setup-guide.md](./06-setup-guide.md) about
  regenerating it once a real Supabase project exists).

## `src/proxy.ts`

This Next.js version's equivalent of `middleware.ts` (see the version note
in [01-architecture.md](./01-architecture.md)) — refreshes the Supabase
auth session cookie on every request matching its `config.matcher`
(everything except static assets/PWA files), so Server Components always
see a non-expired session.

## Data-fetching conventions

Every `(app)` tab is currently a **Client Component** (`"use client"`)
that fetches its own data in a `useEffect` via the browser Supabase
client, rather than fetching in the Server Component and passing props
down. Pattern used throughout (see `tasks/page.tsx`, `zones/page.tsx`,
`jobs/page.tsx`, `calendar/page.tsx`):

1. `load()` — `Promise.all([...])` of `.from(...).select(...)` /
   `.rpc(...)` calls, `setState` on the results.
2. `useEffect(() => { load(); }, [])` on mount.
3. A Realtime `.channel(...).on("postgres_changes", { event: "*", ... },
load)` subscription that just re-runs `load()` wholesale on any
   change to the relevant table(s) — simple, not incremental, but keeps
   client state consistent with RLS-filtered server state without manual
   merge logic.
4. Mutations call the relevant RPC via `supabase.rpc(fn, args)`, then
   either optimistically update local state or just re-call `load()`.
   `jobs/page.tsx` and `tasks/page.tsx` both use a small generic
   `act(fn: string, ...)` / dispatcher pattern for their multiple
   single-arg RPCs (`take_job`/`job_done`/`pay_job`/`delete_job`, etc.)
   rather than one handler per action.

## PWA

- `public/manifest.webmanifest` + icons in `public/icons/`.
- `public/sw.js`: hand-rolled (Turbopack doesn't fit the usual
  webpack-based PWA plugins cleanly). Handles:
  - App-shell caching: network-first for navigations (falls back to
    cached shell, then `/offline.html`), cache-first for static assets.
    Cache writes are `await`ed inside the promise passed to
    `respondWith()` — not fire-and-forget — because a service worker can
    be killed the instant that promise resolves; an unawaited
    `cache.put()` is a real race, not a style nit (this exact bug meant
    visited pages were never reliably cached until it was fixed).
  - Supabase REST reads (`/rest/v1/*`, cross-origin): network-first with
    a cache fallback, same reasoning — every `(app)` tab re-fetches its
    own data on mount (see above), and without this, going offline
    doesn't just skip a refresh, it makes that re-fetch reject and blank
    the page's state to `[]`. Cache keys are salted with a hash of the
    `Authorization` header (not just the URL), since RLS scopes rows by
    the caller's JWT, not anything in the URL — two different signed-in
    users hitting the same table+filter would otherwise share one cache
    entry, which matters on a shared family device.
  - `push` event → `showNotification()` using the payload's
    `title`/`body`/`url` (set by the `send-push` Edge Function).
  - `notificationclick` → focuses an existing tab at that URL or opens a
    new one.
- `src/components/offline-banner.tsx` (`OfflineBanner`, mounted in
  `Shell`): a `navigator.onLine` + `online`/`offline` event listener that
  shows "You're offline — showing the last data that loaded" so users
  understand why data might be stale and why actions won't save.
