-- Family invites: lets a parent add a new family member from Settings
-- without hand-editing SQL (see bootstrap.sql.example for the original
-- one-time 5-person setup). A parent fills in email/name/role/color; this
-- creates a pending row and (via the trigger below) fires the send-invite
-- Edge Function, which calls Supabase Auth's admin.inviteUserByEmail() to
-- deliver the actual email — no third-party email service needed.
--
-- Acceptance: whoever clicks the emailed link ends up authenticated with no
-- profiles row (same "closed allowlist" gate as everyone else — see
-- is_member()). accept_family_invite() below is what the (app) layout
-- calls in that situation: it looks up the caller's own email from
-- auth.users, matches it against a pending invite, and — only if found —
-- creates their profiles row from the invite's details. This deliberately
-- is NOT gated by is_member()/is_parent(), since the whole point is the
-- caller isn't a member yet.
create table public.family_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  display_name text not null,
  role public.family_role not null,
  color text not null,
  invited_by uuid not null references public.profiles (id),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

-- Only one live (unaccepted) invite per email at a time; cancel_family_invite()
-- below frees it up for a re-invite.
create unique index family_invites_pending_email_idx
  on public.family_invites (lower(email))
  where accepted_at is null;

create index family_invites_invited_by_idx on public.family_invites (invited_by);

alter table public.family_invites enable row level security;

-- Read-only to clients (parents only, so Settings can list pending invites);
-- all writes go through the RPC functions below.
create policy "family_invites: select parents" on public.family_invites
  for select using (public.is_parent());
revoke insert, update, delete on public.family_invites from authenticated;

create function public.create_family_invite(
  p_email text,
  p_display_name text,
  p_role public.family_role,
  p_color text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(p_email));
  v_id uuid;
begin
  if not public.is_parent() then
    raise exception 'Parent role required';
  end if;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address';
  end if;
  if p_display_name is null or btrim(p_display_name) = '' then
    raise exception 'Name is required';
  end if;
  if exists (
    select 1 from public.profiles p join auth.users u on u.id = p.id
    where lower(u.email) = v_email
  ) then
    raise exception 'That email is already a family member';
  end if;
  if exists (
    select 1 from family_invites where lower(email) = v_email and accepted_at is null
  ) then
    raise exception 'An invite is already pending for that email';
  end if;

  insert into family_invites (email, display_name, role, color, invited_by)
  values (v_email, btrim(p_display_name), p_role, p_color, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;
revoke all on function public.create_family_invite(text, text, public.family_role, text) from public;
grant execute on function public.create_family_invite(text, text, public.family_role, text) to authenticated;

create function public.cancel_family_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_parent() then
    raise exception 'Parent role required';
  end if;

  delete from family_invites where id = p_invite_id and accepted_at is null;
end;
$$;
revoke all on function public.cancel_family_invite(uuid) from public;
grant execute on function public.cancel_family_invite(uuid) to authenticated;

create function public.accept_family_invite()
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_invite family_invites%rowtype;
  v_profile profiles%rowtype;
begin
  select email into v_email from auth.users where id = auth.uid();
  if v_email is null then
    raise exception 'Not signed in';
  end if;

  select * into v_invite from family_invites
  where lower(email) = lower(v_email) and accepted_at is null
  order by created_at desc
  limit 1;
  if not found then
    raise exception 'No pending invite for this account';
  end if;

  insert into profiles (id, display_name, role, color)
  values (auth.uid(), v_invite.display_name, v_invite.role, v_invite.color)
  on conflict (id) do nothing
  returning * into v_profile;

  if v_profile.id is null then
    select * into v_profile from profiles where id = auth.uid();
  end if;

  update family_invites set accepted_at = now() where id = v_invite.id;

  perform public.notify_parents('update', v_profile.display_name || ' joined the family — invite accepted');

  return v_profile;
end;
$$;
revoke all on function public.accept_family_invite() from public;
grant execute on function public.accept_family_invite() to authenticated;

-- ---------------------------------------------------------------------------
-- Fire-and-forget HTTP call to the send-invite Edge Function whenever a
-- family_invites row is created — mirrors trigger_send_push() in
-- supabase/migrations/20260719120000_web_push_cron.sql (same vault secret,
-- same fire-and-forget net.http_post pattern).
-- ---------------------------------------------------------------------------
create function public.trigger_send_invite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_invited_by_name text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'supabase_secret_key';
  select display_name into v_invited_by_name from profiles where id = NEW.invited_by;

  perform net.http_post(
    url := 'https://myzejnyxkzyxebaxyzko.supabase.co/functions/v1/send-invite',
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', v_secret),
    body := jsonb_build_object(
      'invite_id', NEW.id,
      'email', NEW.email,
      'display_name', NEW.display_name,
      'invited_by_name', v_invited_by_name
    )
  );
  return NEW;
end;
$$;

create trigger family_invites_send_invite
  after insert on public.family_invites
  for each row execute function public.trigger_send_invite();
