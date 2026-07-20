-- Generalizes the single-household "invite a member by email" feature
-- (originally supabase/migrations/20260719130000_family_invites.sql) to be
-- family-scoped, reusing its real Supabase-Auth-based mailer
-- (supabase/functions/send-invite/) rather than building a second,
-- parallel invite system alongside the invite-code join path added in
-- 20260720000001_multi_tenant_families.sql.
--
-- Kept as its own migration (rather than folded into the file above)
-- because it's the piece most coupled to that pre-existing, separately
-- authored work.

alter table public.family_invites add column family_id uuid references public.families (id);

-- Backfill from the inviting parent's own family — the only correct source
-- of truth here, since current_family_id() depends on auth.uid(), which
-- doesn't exist during a migration run.
update public.family_invites fi
set family_id = p.family_id
from public.profiles p
where p.id = fi.invited_by and fi.family_id is null;

-- Safety net: drop any row that still couldn't be resolved (would only
-- happen for orphaned/test data — every real profile got a family_id in
-- the previous migration's backfill).
delete from public.family_invites where family_id is null;

alter table public.family_invites alter column family_id set not null;
create index family_invites_family_id_idx on public.family_invites (family_id);

alter table public.family_invites add column status public.invite_status not null default 'pending';
update public.family_invites set status = (case when accepted_at is not null then 'accepted' else 'pending' end)::public.invite_status;

drop index public.family_invites_pending_email_idx;
create unique index family_invites_pending_email_idx
  on public.family_invites (family_id, lower(email)) where status = 'pending';

drop policy "family_invites: select parents" on public.family_invites;
create policy "family_invites: select family" on public.family_invites
  for select using (public.is_parent() and family_id = public.current_family_id());

-- Per the locked-in decision: only the family admin (not any parent) can
-- send invites or revoke them.
create or replace function public.create_family_invite(
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
  v_family_id uuid := public.current_family_id();
  v_email text := lower(btrim(p_email));
  v_id uuid;
begin
  if not public.is_family_admin() then
    raise exception 'Admin role required';
  end if;
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address';
  end if;
  if p_display_name is null or btrim(p_display_name) = '' then
    raise exception 'Name is required';
  end if;
  if exists (
    select 1 from public.profiles p join auth.users u on u.id = p.id
    where lower(u.email) = v_email and p.family_id = v_family_id
  ) then
    raise exception 'That email is already a family member';
  end if;
  if exists (
    select 1 from family_invites where lower(email) = v_email and family_id = v_family_id and status = 'pending'
  ) then
    raise exception 'An invite is already pending for that email';
  end if;

  insert into family_invites (email, display_name, role, color, invited_by, family_id)
  values (v_email, btrim(p_display_name), p_role, p_color, auth.uid(), v_family_id)
  returning id into v_id;

  return v_id;
end;
$$;

-- Soft-revoke instead of delete, now that there's a status column to keep
-- an audit trail on — frees the email up for re-invite via the partial
-- unique index (which only covers status = 'pending').
create or replace function public.cancel_family_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_family_admin() then
    raise exception 'Admin role required';
  end if;

  update family_invites
  set status = 'revoked'
  where id = p_invite_id and family_id = public.current_family_id() and status = 'pending';
end;
$$;

-- Rewritten: every new signup already gets a profiles row from
-- handle_new_user() (added in the previous migration), so this now UPDATEs
-- the caller's existing row via the shared _join_family() helper instead
-- of INSERTing one. Deliberately NOT gated by is_member()/is_parent() — the
-- whole point is the caller isn't in a family yet. Joins the invite's own
-- family_id; never a caller-supplied one.
create or replace function public.accept_family_invite()
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_invite family_invites%rowtype;
  v_profile public.profiles;
begin
  if exists (select 1 from profiles where id = auth.uid() and family_id is not null) then
    raise exception 'Already in a family';
  end if;

  select email into v_email from auth.users where id = auth.uid();
  if v_email is null then
    raise exception 'Not signed in';
  end if;

  select * into v_invite from family_invites
  where lower(email) = lower(v_email) and status = 'pending'
  order by created_at desc
  limit 1;
  if not found then
    raise exception 'No pending invite for this account';
  end if;

  update profiles
  set display_name = v_invite.display_name, color = v_invite.color
  where id = auth.uid();

  v_profile := public._join_family(v_invite.family_id, v_invite.role, 'member');

  update family_invites set status = 'accepted', accepted_at = now() where id = v_invite.id;

  return v_profile;
end;
$$;

-- Include the family's name in the payload sent to the send-invite Edge
-- Function, so the invite email can say which family the person is being
-- invited into (see supabase/functions/send-invite/index.ts and
-- supabase/templates/invite.html).
create or replace function public.trigger_send_invite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_invited_by_name text;
  v_family_name text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'supabase_secret_key';
  select display_name into v_invited_by_name from profiles where id = NEW.invited_by;
  select name into v_family_name from families where id = NEW.family_id;

  perform net.http_post(
    url := 'https://myzejnyxkzyxebaxyzko.supabase.co/functions/v1/send-invite',
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', v_secret),
    body := jsonb_build_object(
      'invite_id', NEW.id,
      'email', NEW.email,
      'display_name', NEW.display_name,
      'invited_by_name', v_invited_by_name,
      'family_name', v_family_name
    )
  );
  return NEW;
end;
$$;
