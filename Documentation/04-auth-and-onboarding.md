# Auth & Onboarding

This flow replaced the original single-household "closed allowlist"
model (still available as a manual-recovery path — see
`supabase/bootstrap.sql.example`). Every new signup now gets a real
account and picks/creates a family itself; nobody needs an admin to
pre-provision their `profiles` row by hand anymore.

## Sign-in methods

Both `/login` and `/signup` (`src/app/login/page.tsx`,
`src/app/signup/page.tsx`) offer:

- **Google OAuth** — `supabase.auth.signInWithOAuth({ provider: "google",
  options: { redirectTo: "<origin>/auth/callback" } })`.
- **Email + password** — `supabase.auth.signUp()` /
  `signInWithPassword()` directly. Forgotten passwords go through
  `/auth/reset-password` — see "Password reset" below.

## What happens on signup

1. `auth.users` row is created (by Supabase Auth, either provider).
2. The `on_auth_user_created` trigger fires `handle_new_user()`
   (`supabase/migrations/20260720000001_multi_tenant_families.sql`),
   which inserts a matching `profiles` row **immediately**:
   `family_id = null`, `family_member_role = 'member'`, `role = 'kid'`,
   `display_name` derived from `display_name` → `full_name` → `name` in
   the signup metadata, falling back to the local part of the email.
   `color` is a deterministic hash of the user's id.
3. This makes "signed up, no family yet" a clean, always-present,
   centrally-checkable state (`profiles.family_id is null`) instead of
   the old "no `profiles` row at all" special case.

## Routing after signup/login

The `(app)` layout (`src/app/(app)/layout.tsx`) is the single place this
is enforced — see [03-frontend.md](./03-frontend.md#the-app-layout-auth-guard--data-hydration):

- No session → `/login`
- Session but no `profiles` row → `/auth/error` (shouldn't happen in
  normal use; would indicate the trigger didn't fire)
- `profiles.family_id is null` → `/onboarding/choose`
- Otherwise → the requested tab, with `FamilyProvider` populated

## Choosing a family (`/onboarding/*`)

`/onboarding/choose` offers two paths:

- **Create a new family** → `/onboarding/create` → calls
  `create_family(p_name)`, which:
  - Generates a unique `invite_code` (`generate_family_invite_code()`,
    picks from a 40-word list + a 4-digit suffix, retries on collision).
  - Sets the caller `family_member_role = 'admin'`, `role = 'parent'`.
  - Creates an empty `zone_rotation` row for the new family
    (`interval_days = 7`, `member_order = '{}'` — no rotation order until
    populated; see [07-project-status.md](./07-project-status.md)).
  - Redirects to `/onboarding/invite`, an optional step to send email
    invites right away (reuses `InviteForm` — see
    [03-frontend.md](./03-frontend.md)) before continuing into the app.

- **Join an existing family** → `/onboarding/join` → calls
  `join_family_by_code(p_code)`, which looks up `families.invite_code`
  and joins the caller as `role = 'kid'`, `family_member_role = 'member'`
  (least-privileged by design — `p_role` is deliberately not a client
  parameter, so nobody can self-elevate to `parent` via the code path;
  an admin promotes people afterward via `set_member_role()` in
  Settings).

Both RPCs reject the call if the caller is already in a family
(`family_id is not null`).

## Email invites (parent/admin invites someone specific)

Distinct from the invite-code join above — this is for inviting a
specific person by email, from **Settings → Invite a family member**
(admin-only — gated on `isFamilyAdmin` in the UI, and enforced again
server-side by `is_family_admin()` in `create_family_invite()`) or from
the optional `/onboarding/invite` step right after creating a family.

1. Admin fills in email/name/role/color (`InviteForm`,
   `src/components/invite-form.tsx`) → `create_family_invite(...)`.
2. That inserts a `pending` row in `family_invites`, which fires the
   `family_invites_send_invite` trigger →
   `supabase/functions/send-invite/index.ts` (fire-and-forget
   `net.http_post`, same pattern as push — see
   [05-notifications-and-push.md](./05-notifications-and-push.md)).
3. The Edge Function calls Supabase Auth's
   `admin.inviteUserByEmail(email, { redirectTo: "<SITE_URL>/auth/confirm?next=/" })`
   — this is a real Supabase Auth invite, so no third-party email
   service is needed. The email template is
   `supabase/templates/invite.html`.
4. The invitee clicks the link → lands on `/auth/confirm`
   (`src/app/auth/confirm/route.ts`), which calls
   `supabase.auth.verifyOtp({ type, token_hash })`. This signs them in —
   at this point they have an `auth.users` row and (via the same
   `on_auth_user_created` trigger as any signup) a `profiles` row with
   `family_id = null`.
5. From here they're in the normal "no family yet" state
   (`profiles.family_id is null`). The `(app)` layout
   (`src/app/(app)/layout.tsx`) handles this: before falling through to
   `/onboarding/choose`, it calls `accept_family_invite()`. If that
   invitee has a pending invite matching their email, it joins them
   directly and the layout continues rendering the app with their new
   family — `/onboarding/choose` is only reached for accounts with no
   matching invite (i.e. an organic signup).
6. `accept_family_invite()`: matches `auth.users.email` (lowercased)
   against the newest `pending` invite for that email, updates the
   caller's `display_name`/`color` from the invite, joins the family via
   the shared `_join_family()` helper using the invite's `role`, and
   marks the invite `accepted`. Raises (so the RPC call returns
   `data: null`) when there's no pending invite for the account's email —
   the `(app)` layout treats that as the normal "no invite, go pick a
   family" case rather than an error.

Invites can be revoked while still `pending` via
`cancel_family_invite()` (soft-delete — `status = 'revoked'`, keeps an
audit trail and frees the email for re-invite).

## Password reset

`/login` links to `/auth/reset-password` ("Forgot your password?"),
following the same server-verified `token_hash` pattern as the invite flow
above rather than Supabase's default hosted redirect:

1. `/auth/reset-password` (`src/app/auth/reset-password/page.tsx`) takes
   an email and calls `supabase.auth.resetPasswordForEmail(email, {
   redirectTo: "<origin>/auth/update-password" })`. The response is
   identical whether or not the email is registered — the UI never
   reveals which, to avoid leaking account existence.
2. The email uses the custom template
   `supabase/templates/recovery.html` (wired in via
   `supabase/config.toml`'s `[auth.email.template.recovery]`, same
   mechanism as `[auth.email.template.invite]`), linking to
   `/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/auth/update-password`.
3. `/auth/confirm/route.ts` — already generic over `type` — calls
   `supabase.auth.verifyOtp({ type: "recovery", token_hash })`, which
   establishes a (recovery) session, then redirects to `next`.
4. `/auth/update-password` (`src/app/auth/update-password/page.tsx`)
   checks for that session (`supabase.auth.getUser()`); if present, shows
   a new-password form and calls `supabase.auth.updateUser({ password })`
   on submit. No session (expired/already-used link, or a direct visit)
   shows an error with a link back to request a new one.

Like the invite template, `recovery.html`/`config.toml`'s
`[auth.email.template.recovery]` only take effect against a project once
applied there (`supabase config push`, or matched by hand in the
dashboard's Auth → Templates) — `supabase db push` alone doesn't sync
auth/email config, only migrations. This is the same pre-existing caveat
as the invite email template, not something new to the reset flow.

## Manual/legacy bootstrap path

`supabase/bootstrap.sql.example` is a template for hand-provisioning a
family's `profiles` rows directly in the Supabase SQL editor (service
role, bypasses RLS) — e.g. to recover a specific family's zone rotation
order or starter zones. It's explicitly marked superseded for *new*
households by the self-serve `create_family()` flow above; every account
already gets a placeholder `profiles` row from `on_auth_user_created`, so
there's no more manual `auth.users` id lookup needed for a fresh signup.
