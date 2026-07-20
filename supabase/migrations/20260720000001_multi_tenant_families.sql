-- Multi-tenant families: turns the single-household, closed-allowlist app
-- into an isolated-tenant-per-family app. Every family-scoped table gets a
-- `family_id` column; every RLS policy and RPC function gets a matching
-- `family_id = current_family_id()` check. `family_id` is never accepted as
-- an RPC parameter from the client — it's always derived server-side from
-- the caller's own profile (`current_family_id()`), which closes off
-- client-supplied tenant spoofing as an attack vector entirely.
--
-- `family_role` (parent/kid) is unchanged and stays orthogonal to the new
-- `family_member_role` (admin/member): the former governs chore-app
-- permissions within a family, the latter governs who can manage the
-- family itself (invite people, regenerate the invite code).
--
-- This migration also backfills the household that was live before this
-- change (5 profiles, no family concept) into a single family named
-- "Our Family", admin = the earliest-created profile. That's a placeholder,
-- renameable/reassignable afterward from Settings — the block is a no-op on
-- a fresh database with no existing profiles.

create type public.family_member_role as enum ('admin', 'member');
create type public.invite_status as enum ('pending', 'accepted', 'revoked');

-- ---------------------------------------------------------------------------
-- families
-- ---------------------------------------------------------------------------
create table public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger families_set_updated_at
  before update on public.families
  for each row execute function public.set_updated_at();

alter table public.profiles add column family_id uuid references public.families (id);
alter table public.profiles add column family_member_role public.family_member_role not null default 'member';
create index profiles_family_id_idx on public.profiles (family_id);

-- family_id added nullable everywhere first; backfilled below, then locked
-- to not null once every existing row has a value.
alter table public.subjects add column family_id uuid references public.families (id);
alter table public.calendar_events add column family_id uuid references public.families (id);
alter table public.zones add column family_id uuid references public.families (id);
alter table public.zone_rotation add column family_id uuid references public.families (id);
alter table public.zone_dismissals add column family_id uuid references public.families (id);
alter table public.jobs add column family_id uuid references public.families (id);
alter table public.tasks add column family_id uuid references public.families (id);
alter table public.subtasks add column family_id uuid references public.families (id);
alter table public.notifications add column family_id uuid references public.families (id);
alter table public.push_subscriptions add column family_id uuid references public.families (id);
alter table public.google_tokens add column family_id uuid references public.families (id);

-- =============================================================================
-- Helper functions (same shape as the existing is_member()/is_parent(): a
-- single SECURITY DEFINER lookup against profiles by auth.uid()).
-- =============================================================================
create function public.current_family_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select family_id from public.profiles where id = auth.uid();
$$;
revoke all on function public.current_family_id() from public;
grant execute on function public.current_family_id() to authenticated;

create function public.is_family_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and family_member_role = 'admin' and family_id is not null
  );
$$;
revoke all on function public.is_family_admin() from public;
grant execute on function public.is_family_admin() to authenticated;

-- Not granted to authenticated — only called internally from create_family()
-- and regenerate_invite_code().
create function public.generate_family_invite_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_words text[] := array[
    'MAPLE','CEDAR','RIVER','BIRCH','OCEAN','MEADOW','SUMMIT','HARBOR','WILLOW','CANYON',
    'PRAIRIE','GLACIER','COMET','ORCHARD','TIMBER','COBALT','AMBER','GRANITE','LAGOON','ZEPHYR',
    'JUNIPER','SPARROW','HORIZON','THISTLE','BOULDER','CRESCENT','ALPINE','SEQUOIA','TUNDRA','CORAL',
    'HOLLOW','RIDGE','BRAMBLE','FALCON','PEBBLE','MOSSY','CLOVER','QUARTZ','SAGE','TIDE'
  ];
  v_code text;
  v_attempts int := 0;
begin
  loop
    v_code := v_words[1 + floor(random() * array_length(v_words, 1))::int]
      || '-' || (1000 + floor(random() * 9000))::int;
    exit when not exists (select 1 from families where invite_code = v_code);
    v_attempts := v_attempts + 1;
    if v_attempts > 20 then
      raise exception 'Could not generate a unique invite code';
    end if;
  end loop;
  return v_code;
end;
$$;
revoke all on function public.generate_family_invite_code() from public;

-- Family-parameterized zone-rotation math, used both by the authenticated
-- per-caller wrappers below (cycle_num(), zone_assignee()) and by the
-- cron_* functions, which have no auth.uid() and so must loop over every
-- family explicitly instead of relying on current_family_id().
create function public._cycle_num_for(p_family_id uuid)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r record;
begin
  select * into r from zone_rotation where family_id = p_family_id;
  if not found then
    return 0;
  end if;
  if r.interval_days is null then
    return r.offset_cycles;
  end if;
  return floor((current_date - r.start_date)::numeric / r.interval_days)::int + r.offset_cycles;
end;
$$;
revoke all on function public._cycle_num_for(uuid) from public;

create function public._zone_assignee_for(p_zone_id uuid, p_family_id uuid, p_cycle int)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_pinned uuid;
  v_idx int;
  v_members uuid[];
  v_count int;
begin
  select assigned_to into v_pinned from zones where id = p_zone_id and family_id = p_family_id;
  if v_pinned is not null then
    return v_pinned;
  end if;

  select idx into v_idx from (
    select id, (row_number() over (order by created_at) - 1)::int as idx
    from zones where family_id = p_family_id
  ) ranked where ranked.id = p_zone_id;
  if v_idx is null then
    return null;
  end if;

  select member_order into v_members from zone_rotation where family_id = p_family_id;
  v_count := coalesce(array_length(v_members, 1), 0);
  if v_count = 0 then
    return null;
  end if;

  return v_members[((v_idx + p_cycle) % v_count + v_count) % v_count + 1];
end;
$$;
revoke all on function public._zone_assignee_for(uuid, uuid, int) from public;

create function public._ensure_zone_tasks_for(p_family_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cycle int := public._cycle_num_for(p_family_id);
  z record;
  v_who uuid;
  v_task_id uuid;
  v_existing record;
  v_sub text;
  v_pos int;
begin
  delete from tasks t
  where t.family_id = p_family_id
    and t.zone_id is not null
    and t.status <> 'verified'
    and (t.zone_cycle is distinct from v_cycle or not exists (select 1 from zones zz where zz.id = t.zone_id));

  for z in select * from zones where family_id = p_family_id loop
    if exists (select 1 from zone_dismissals d where d.zone_id = z.id and d.cycle = v_cycle) then
      continue;
    end if;
    v_who := public._zone_assignee_for(z.id, p_family_id, v_cycle);
    if v_who is null then
      continue;
    end if;

    select * into v_existing from tasks where zone_id = z.id and zone_cycle = v_cycle limit 1;
    if not found then
      insert into tasks (title, member_id, category, date, status, created_by, zone_id, zone_cycle, family_id)
      values ('Zone: ' || z.name, v_who, 'zone', current_date, 'assigned', v_who, z.id, v_cycle, p_family_id)
      returning id into v_task_id;

      v_pos := 0;
      foreach v_sub in array coalesce(z.subzones, '{}') loop
        insert into subtasks (task_id, title, position, family_id) values (v_task_id, v_sub, v_pos, p_family_id);
        v_pos := v_pos + 1;
      end loop;
    elsif v_existing.member_id <> v_who and v_existing.status = 'assigned' then
      update tasks set member_id = v_who where id = v_existing.id;
    end if;
  end loop;
end;
$$;
revoke all on function public._ensure_zone_tasks_for(uuid) from public;

-- Shared by the "force this row's family_id server-side" triggers on the
-- tables clients write to directly (subjects, calendar_events,
-- push_subscriptions) — everything else is written exclusively inside
-- SECURITY DEFINER RPCs, where family_id is just one more insert column.
--
-- Only overrides family_id when there's a real authenticated caller
-- (current_family_id() is non-null). Service-role/superuser contexts with
-- no auth.uid() — seed.sql, bootstrap.sql.example, migrations — have no
-- current_family_id() to force, so this trusts whatever they provided
-- instead of raising; those contexts already bypass RLS entirely, so
-- nothing is weakened. For an actual authenticated client with no
-- current_family_id() (signed up, no family yet), the row still can't
-- land: the table's "with check (family_id = current_family_id())" clause
-- rejects it regardless of what the trigger does, since that compares
-- against NULL.
create function public.force_own_family_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family_id uuid := public.current_family_id();
begin
  if v_family_id is not null then
    new.family_id := v_family_id;
  end if;
  return new;
end;
$$;

-- =============================================================================
-- One-time backfill: creates a family for the household that was already
-- live before this migration, and back-fills family_id everywhere. No-op if
-- there are no profiles yet (fresh/local database) or a families row
-- already exists (migration re-run).
-- =============================================================================
do $$
declare
  v_family_id uuid;
  v_admin_id uuid;
  v_code text;
begin
  if exists (select 1 from public.profiles) and not exists (select 1 from public.families) then
    select id into v_admin_id from public.profiles order by created_at limit 1;
    v_code := public.generate_family_invite_code();

    insert into public.families (name, invite_code, created_by)
    values ('Our Family', v_code, v_admin_id)
    returning id into v_family_id;

    update public.profiles set
      family_id = v_family_id,
      family_member_role = case when id = v_admin_id then 'admin' else 'member' end::public.family_member_role;

    update public.subjects set family_id = v_family_id where family_id is null;
    update public.calendar_events set family_id = v_family_id where family_id is null;
    update public.zones set family_id = v_family_id where family_id is null;
    update public.zone_rotation set family_id = v_family_id where family_id is null;
    update public.zone_dismissals set family_id = v_family_id where family_id is null;
    update public.jobs set family_id = v_family_id where family_id is null;
    update public.tasks set family_id = v_family_id where family_id is null;
    update public.subtasks set family_id = v_family_id where family_id is null;
    update public.notifications set family_id = v_family_id where family_id is null;
    update public.push_subscriptions set family_id = v_family_id where family_id is null;
    update public.google_tokens set family_id = v_family_id where family_id is null;
  end if;
end $$;

-- Lock family_id to not null everywhere now that existing rows (if any)
-- have been backfilled. profiles.family_id stays nullable — it's the only
-- legitimate "signed up, not yet in a family" state in the app.
alter table public.subjects alter column family_id set not null;
alter table public.calendar_events alter column family_id set not null;
alter table public.zones alter column family_id set not null;
alter table public.zone_dismissals alter column family_id set not null;
alter table public.jobs alter column family_id set not null;
alter table public.tasks alter column family_id set not null;
alter table public.subtasks alter column family_id set not null;
alter table public.notifications alter column family_id set not null;
alter table public.push_subscriptions alter column family_id set not null;
alter table public.google_tokens alter column family_id set not null;

create index subjects_family_id_idx on public.subjects (family_id);
create index calendar_events_family_id_idx on public.calendar_events (family_id);
create index zones_family_id_idx on public.zones (family_id);
create index zone_dismissals_family_id_idx on public.zone_dismissals (family_id);
create index jobs_family_id_idx on public.jobs (family_id);
create index tasks_family_id_idx on public.tasks (family_id);
create index subtasks_family_id_idx on public.subtasks (family_id);
create index notifications_family_id_idx on public.notifications (family_id);
create index push_subscriptions_family_id_idx on public.push_subscriptions (family_id);
create index google_tokens_family_id_idx on public.google_tokens (family_id);

-- zone_rotation was a literal singleton (id boolean primary key default
-- true) — that only ever worked for exactly one household. Swap the PK to
-- family_id now that every existing row has one from the backfill above.
alter table public.zone_rotation drop constraint zone_rotation_singleton;
alter table public.zone_rotation drop constraint zone_rotation_pkey;
alter table public.zone_rotation alter column family_id set not null;
alter table public.zone_rotation add constraint zone_rotation_pkey primary key (family_id);
alter table public.zone_rotation drop column id;

-- =============================================================================
-- Row Level Security — new table + family-scoping added to existing policies
-- =============================================================================
alter table public.families enable row level security;

create policy "families: select own family" on public.families
  for select using (id = public.current_family_id());
revoke insert, update, delete on public.families from authenticated;

-- is_member() now means "has an account AND has joined a family" — the
-- single highest-leverage change here, since most existing is_member()/
-- is_parent() call sites need no further edits: "not fully onboarded" is
-- now baked into what is_member() already means.
create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and family_id is not null);
$$;

-- Bootstrapping hazard the redefinition above creates: a freshly-signed-up
-- user with family_id is null now fails is_member(), so they couldn't even
-- select their own profiles row — which the onboarding gate needs. Split
-- the policy so "select my own row" always works regardless.
drop policy "profiles: select members" on public.profiles;
create policy "profiles: select own or family" on public.profiles
  for select using (id = auth.uid() or (public.is_member() and family_id = public.current_family_id()));

drop policy "subjects: select members" on public.subjects;
create policy "subjects: select family" on public.subjects
  for select using (public.is_member() and family_id = public.current_family_id());
drop policy "subjects: parent writes" on public.subjects;
create policy "subjects: parent writes" on public.subjects
  for all
  using (public.is_parent() and family_id = public.current_family_id())
  with check (public.is_parent() and family_id = public.current_family_id());
create trigger subjects_force_family_id
  before insert or update on public.subjects
  for each row execute function public.force_own_family_id();

drop policy "calendar_events: select members" on public.calendar_events;
create policy "calendar_events: select family" on public.calendar_events
  for select using (public.is_member() and family_id = public.current_family_id());
drop policy "calendar_events: owner or parent writes" on public.calendar_events;
create policy "calendar_events: owner or parent writes" on public.calendar_events
  for all
  using (public.is_member() and family_id = public.current_family_id() and (member_id = auth.uid() or public.is_parent()))
  with check (public.is_member() and family_id = public.current_family_id() and (member_id = auth.uid() or public.is_parent()));
create trigger calendar_events_force_family_id
  before insert or update on public.calendar_events
  for each row execute function public.force_own_family_id();

drop policy "zones: select members" on public.zones;
create policy "zones: select family" on public.zones
  for select using (public.is_member() and family_id = public.current_family_id());

drop policy "zone_rotation: select members" on public.zone_rotation;
create policy "zone_rotation: select family" on public.zone_rotation
  for select using (public.is_member() and family_id = public.current_family_id());

drop policy "zone_dismissals: select members" on public.zone_dismissals;
create policy "zone_dismissals: select family" on public.zone_dismissals
  for select using (public.is_member() and family_id = public.current_family_id());

drop policy "jobs: select members" on public.jobs;
create policy "jobs: select family" on public.jobs
  for select using (public.is_member() and family_id = public.current_family_id());

drop policy "tasks: select own or parent" on public.tasks;
create policy "tasks: select own or parent" on public.tasks
  for select using (public.is_member() and family_id = public.current_family_id() and (member_id = auth.uid() or public.is_parent()));

drop policy "subtasks: select via parent task" on public.subtasks;
create policy "subtasks: select via parent task" on public.subtasks
  for select using (
    family_id = public.current_family_id()
    and exists (
      select 1 from public.tasks t
      where t.id = task_id and (t.member_id = auth.uid() or public.is_parent())
    )
  );

-- notifications: unchanged — to_profile_id = auth.uid() already scopes each
-- caller to exactly their own inbox regardless of family, so no additional
-- family_id predicate is needed on top of it.

drop policy "push_subscriptions: owner only" on public.push_subscriptions;
create policy "push_subscriptions: owner only" on public.push_subscriptions
  for all
  using (profile_id = auth.uid() and family_id = public.current_family_id())
  with check (profile_id = auth.uid() and family_id = public.current_family_id());
create trigger push_subscriptions_force_family_id
  before insert or update on public.push_subscriptions
  for each row execute function public.force_own_family_id();

-- =============================================================================
-- RPC functions — family-scoped rewrites of every existing write path.
-- Pattern: row-mutating RPCs fetch-then-check `row.family_id <>
-- current_family_id()` and raise "not found" (never "forbidden", so
-- cross-tenant row existence isn't leaked); insert-type RPCs add family_id
-- to the insert list from current_family_id() and validate any
-- client-supplied target id belongs to the same family.
-- =============================================================================

-- notify()/notify_parents() were missing the explicit `revoke ... from
-- public` the rest of the RPCs have (their comment claims they're
-- internal-only, but nothing enforced that) — closed here while they're
-- already being touched for family scoping.
create or replace function public.notify(p_to uuid, p_kind public.notif_kind, p_text text, p_dedupe_key text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family_id uuid;
begin
  if p_dedupe_key is not null and exists (select 1 from notifications where dedupe_key = p_dedupe_key) then
    return;
  end if;
  select family_id into v_family_id from profiles where id = p_to;
  insert into notifications (to_profile_id, kind, text, dedupe_key, family_id) values (p_to, p_kind, p_text, p_dedupe_key, v_family_id);
end;
$$;
revoke all on function public.notify(uuid, public.notif_kind, text, text) from public;

create or replace function public.notify_parents(p_kind public.notif_kind, p_text text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p record;
  v_family_id uuid := public.current_family_id();
begin
  for p in select id from profiles where role = 'parent' and family_id = v_family_id loop
    perform public.notify(p.id, p_kind, p_text);
  end loop;
end;
$$;
revoke all on function public.notify_parents(public.notif_kind, text) from public;

-- ---- zone rotation math ----------------------------------------------------
create or replace function public.cycle_num()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select public._cycle_num_for(public.current_family_id());
$$;

create or replace function public.next_rotation_date()
returns date
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r record;
  v_days int;
  v_next int;
begin
  select * into r from zone_rotation where family_id = public.current_family_id();
  if not found or r.interval_days is null then
    return null;
  end if;
  v_days := current_date - r.start_date;
  v_next := (floor(v_days::numeric / r.interval_days)::int + 1) * r.interval_days;
  return r.start_date + v_next;
end;
$$;

create or replace function public.zone_assignee(p_zone_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select public._zone_assignee_for(
    p_zone_id,
    public.current_family_id(),
    public._cycle_num_for(public.current_family_id())
  );
$$;

create or replace function public.zones_with_assignee()
returns table (id uuid, name text, subzones text[], assigned_to uuid, assignee_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select z.id, z.name, z.subzones, z.assigned_to, public.zone_assignee(z.id) as assignee_id
  from zones z
  where z.family_id = public.current_family_id()
  order by z.created_at;
$$;

create or replace function public.ensure_zone_tasks()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family_id uuid := public.current_family_id();
begin
  if v_family_id is null then
    raise exception 'Not a family member';
  end if;
  perform public._ensure_zone_tasks_for(v_family_id);
end;
$$;

-- Cron-only entry point: no auth.uid() under pg_cron, so this loops every
-- family explicitly instead of relying on current_family_id().
create or replace function public.cron_ensure_zone_tasks()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  fam record;
begin
  for fam in select id from families loop
    perform public._ensure_zone_tasks_for(fam.id);
  end loop;
end;
$$;

create or replace function public.rotate_now()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family_id uuid := public.current_family_id();
  mid uuid;
  v_zone_names text;
begin
  if not public.is_parent() then
    raise exception 'Parent role required';
  end if;

  update zone_rotation set offset_cycles = offset_cycles + 1 where family_id = v_family_id;
  perform public.ensure_zone_tasks();

  for mid in select unnest(member_order) from zone_rotation where family_id = v_family_id loop
    select string_agg(z.name, ', ' order by z.name) into v_zone_names
    from zones z where z.family_id = v_family_id and public.zone_assignee(z.id) = mid;
    if v_zone_names is not null then
      perform public.notify(mid, 'update', 'Zone rotation: this week you have ' || v_zone_names);
    end if;
  end loop;
end;
$$;

create or replace function public.set_zone_interval(p_interval_days int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family_id uuid := public.current_family_id();
  v_cur_cycle int;
  v_days int;
  r record;
begin
  if not public.is_parent() then
    raise exception 'Parent role required';
  end if;

  select * into r from zone_rotation where family_id = v_family_id;
  v_cur_cycle := public.cycle_num();

  if p_interval_days is null then
    update zone_rotation set interval_days = null, offset_cycles = v_cur_cycle where family_id = v_family_id;
  else
    v_days := current_date - r.start_date;
    update zone_rotation set interval_days = p_interval_days,
      offset_cycles = v_cur_cycle - floor(v_days::numeric / p_interval_days)::int
    where family_id = v_family_id;
  end if;

  perform public.ensure_zone_tasks();
end;
$$;

create or replace function public.set_zone_assignee(p_zone_id uuid, p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family_id uuid := public.current_family_id();
  v_cycle int;
  v_who uuid;
  v_zone_name text;
begin
  if not public.is_parent() then
    raise exception 'Parent role required';
  end if;
  if not exists (select 1 from zones where id = p_zone_id and family_id = v_family_id) then
    raise exception 'Zone not found';
  end if;
  if p_member_id is not null and not exists (select 1 from profiles where id = p_member_id and family_id = v_family_id) then
    raise exception 'Not a family member';
  end if;

  update zones set assigned_to = p_member_id where id = p_zone_id and family_id = v_family_id;

  v_cycle := public.cycle_num();
  delete from tasks where zone_id = p_zone_id and zone_cycle = v_cycle and status <> 'verified';
  delete from zone_dismissals where zone_id = p_zone_id and cycle = v_cycle;

  perform public.ensure_zone_tasks();

  v_who := public.zone_assignee(p_zone_id);
  select name into v_zone_name from zones where id = p_zone_id;
  if v_who is not null then
    perform public.notify(v_who, 'update', 'You''ve been assigned the zone: ' || v_zone_name);
  end if;
end;
$$;

create or replace function public.save_zone(p_zone_id uuid, p_name text, p_subzones text[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family_id uuid := public.current_family_id();
  v_id uuid;
begin
  if not public.is_parent() then
    raise exception 'Parent role required';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'Zone name is required';
  end if;

  if p_zone_id is null then
    insert into zones (name, subzones, family_id) values (p_name, coalesce(p_subzones, '{}'), v_family_id) returning id into v_id;
  else
    if not exists (select 1 from zones where id = p_zone_id and family_id = v_family_id) then
      raise exception 'Zone not found';
    end if;
    update zones set name = p_name, subzones = coalesce(p_subzones, '{}') where id = p_zone_id returning id into v_id;
    delete from tasks where zone_id = v_id and zone_cycle = public.cycle_num() and status <> 'verified';
  end if;

  perform public.ensure_zone_tasks();
  return v_id;
end;
$$;

create or replace function public.delete_zone(p_zone_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_parent() then
    raise exception 'Parent role required';
  end if;
  if not exists (select 1 from zones where id = p_zone_id and family_id = public.current_family_id()) then
    return;
  end if;

  delete from tasks where zone_id = p_zone_id and status <> 'verified';
  delete from zones where id = p_zone_id;
end;
$$;

-- ---- tasks ------------------------------------------------------------
create or replace function public.create_task(
  p_title text,
  p_member_id uuid,
  p_category public.task_category,
  p_subject_id uuid,
  p_date date,
  p_deadline time,
  p_remind_minutes int,
  p_subtasks text[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family_id uuid := public.current_family_id();
  v_task_id uuid;
  v_sub text;
  v_pos int := 0;
begin
  if v_family_id is null then
    raise exception 'Not a family member';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception 'Title is required';
  end if;
  if not exists (select 1 from profiles where id = p_member_id and family_id = v_family_id) then
    raise exception 'Not a family member';
  end if;
  if p_subject_id is not null and not exists (select 1 from subjects where id = p_subject_id and family_id = v_family_id) then
    raise exception 'Subject not found';
  end if;
  if not public.is_parent() and p_member_id <> auth.uid() then
    raise exception 'Kids can only add items for themselves';
  end if;

  insert into tasks (title, member_id, category, subject_id, date, deadline, remind_minutes, status, created_by, family_id)
  values (p_title, p_member_id, p_category, p_subject_id, p_date, p_deadline, coalesce(p_remind_minutes, 0), 'assigned', auth.uid(), v_family_id)
  returning id into v_task_id;

  foreach v_sub in array coalesce(p_subtasks, '{}') loop
    insert into subtasks (task_id, title, position, family_id) values (v_task_id, v_sub, v_pos, v_family_id);
    v_pos := v_pos + 1;
  end loop;

  if p_member_id <> auth.uid() then
    perform public.notify(
      p_member_id, 'update',
      (select display_name from profiles where id = auth.uid()) || ' assigned you a task: "' || p_title || '"'
    );
  end if;

  return v_task_id;
end;
$$;

create or replace function public.toggle_subtask(p_subtask_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task record;
begin
  select t.id, t.member_id into v_task
  from subtasks s join tasks t on t.id = s.task_id
  where s.id = p_subtask_id and s.family_id = public.current_family_id();
  if not found then
    raise exception 'Subtask not found';
  end if;
  if not public.is_parent() and v_task.member_id <> auth.uid() then
    raise exception 'Not allowed';
  end if;

  update subtasks set done = not done where id = p_subtask_id;
end;
$$;

create or replace function public.mark_task_done(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task tasks%rowtype;
  v_name text;
begin
  select * into v_task from tasks where id = p_task_id;
  if not found or v_task.family_id <> public.current_family_id() then
    raise exception 'Task not found';
  end if;
  if v_task.member_id <> auth.uid() then
    raise exception 'Not your task';
  end if;
  if v_task.status <> 'assigned' then
    raise exception 'Task is not in assigned state';
  end if;

  update tasks set status = 'done' where id = p_task_id;

  if v_task.job_id is not null then
    update jobs set status = 'done' where id = v_task.job_id and status = 'taken';
  end if;

  select display_name into v_name from profiles where id = auth.uid();
  perform public.notify_parents('update', v_name || ' marked "' || v_task.title || '" as done — ready to verify');
end;
$$;

create or replace function public.verify_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task tasks%rowtype;
  v_job jobs%rowtype;
  v_parent_name text;
begin
  if not public.is_parent() then
    raise exception 'Parent role required';
  end if;

  select * into v_task from tasks where id = p_task_id;
  if not found or v_task.family_id <> public.current_family_id() then
    raise exception 'Task not found';
  end if;

  update tasks set status = 'verified' where id = p_task_id;

  if v_task.zone_id is not null then
    insert into zone_dismissals (zone_id, cycle, family_id) values (v_task.zone_id, v_task.zone_cycle, v_task.family_id) on conflict do nothing;
  end if;

  if v_task.job_id is not null then
    select * into v_job from jobs where id = v_task.job_id;
    if v_job.status <> 'paid' then
      update jobs set status = 'paid' where id = v_job.id;
      perform public.notify(v_job.taken_by, 'job', '"' || v_job.title || '" verified — you earned $' || v_job.amount || ' 🎉');
    end if;
  end if;

  select display_name into v_parent_name from profiles where id = auth.uid();
  perform public.notify(v_task.member_id, 'update', '"' || v_task.title || '" was verified by ' || v_parent_name || ' ✓');
end;
$$;

create or replace function public.delete_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task tasks%rowtype;
begin
  select * into v_task from tasks where id = p_task_id;
  if not found or v_task.family_id <> public.current_family_id() then
    return; -- idempotent, mirrors the prototype's filter-based delete
  end if;

  if not public.is_parent() then
    if not (v_task.member_id = auth.uid() and v_task.created_by = auth.uid() and v_task.zone_id is null) then
      raise exception 'Not allowed';
    end if;
  end if;

  if v_task.zone_id is not null then
    insert into zone_dismissals (zone_id, cycle, family_id) values (v_task.zone_id, v_task.zone_cycle, v_task.family_id) on conflict do nothing;
  end if;

  delete from tasks where id = p_task_id;
end;
$$;

create or replace function public.move_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task tasks%rowtype;
begin
  select * into v_task from tasks where id = p_task_id;
  if not found or v_task.family_id <> public.current_family_id() then
    raise exception 'Task not found';
  end if;
  if v_task.status = 'verified' then
    raise exception 'Task already verified';
  end if;

  if not public.is_parent() then
    if not (v_task.member_id = auth.uid() and v_task.created_by = auth.uid() and v_task.zone_id is null) then
      raise exception 'Not allowed';
    end if;
  end if;

  update tasks set date = date + 1 where id = p_task_id;
end;
$$;

create or replace function public.roll_all_tasks()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if not public.is_parent() then
    raise exception 'Parent role required';
  end if;

  with updated as (
    update tasks set date = current_date
    where date < current_date and status = 'assigned' and family_id = public.current_family_id()
    returning 1
  )
  select count(*) into v_count from updated;

  return v_count;
end;
$$;

create or replace function public.nudge_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task tasks%rowtype;
  v_parent_name text;
begin
  if not public.is_parent() then
    raise exception 'Parent role required';
  end if;

  select * into v_task from tasks where id = p_task_id;
  if not found or v_task.family_id <> public.current_family_id() then
    raise exception 'Task not found';
  end if;

  select display_name into v_parent_name from profiles where id = auth.uid();
  perform public.notify(
    v_task.member_id, 'nudge',
    'Reminder from ' || v_parent_name || ': please do "' || v_task.title || '"' ||
      case when v_task.deadline is not null then ' (due ' || to_char(v_task.deadline, 'HH24:MI') || ')' else '' end
  );
end;
$$;

-- ---- work-for-hire jobs -------------------------------------------------
create or replace function public.create_job(p_title text, p_amount numeric)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family_id uuid := public.current_family_id();
  v_id uuid;
  k record;
begin
  if not public.is_parent() then
    raise exception 'Parent role required';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception 'Job title is required';
  end if;

  insert into jobs (title, amount, status, family_id) values (p_title, p_amount, 'open', v_family_id) returning id into v_id;

  for k in select id from profiles where role = 'kid' and family_id = v_family_id loop
    perform public.notify(k.id, 'job', 'New paid job posted: "' || p_title || '" — $' || p_amount);
  end loop;

  return v_id;
end;
$$;

create or replace function public.take_job(p_job_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family_id uuid := public.current_family_id();
  v_job jobs%rowtype;
  v_task_id uuid;
  v_name text;
begin
  if not public.is_member() or public.is_parent() then
    raise exception 'Only kids can take jobs';
  end if;

  select * into v_job from jobs where id = p_job_id for update;
  if not found or v_job.family_id <> v_family_id then
    raise exception 'Job not found';
  end if;
  if v_job.status <> 'open' then
    raise exception 'Job is no longer open';
  end if;

  update jobs set status = 'taken', taken_by = auth.uid() where id = p_job_id;

  insert into tasks (title, member_id, category, date, status, created_by, job_id, family_id)
  values ('Job: ' || v_job.title || ' ($' || v_job.amount || ')', auth.uid(), 'work', current_date, 'assigned', auth.uid(), p_job_id, v_family_id)
  returning id into v_task_id;

  update jobs set task_id = v_task_id where id = p_job_id;

  select display_name into v_name from profiles where id = auth.uid();
  perform public.notify_parents('job', v_name || ' claimed the job "' || v_job.title || '" ($' || v_job.amount || ')');

  return v_task_id;
end;
$$;

create or replace function public.job_done(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job jobs%rowtype;
begin
  select * into v_job from jobs where id = p_job_id;
  if not found or v_job.family_id <> public.current_family_id() then
    raise exception 'Job not found';
  end if;
  if v_job.taken_by <> auth.uid() then
    raise exception 'Not your job';
  end if;
  if v_job.status <> 'taken' then
    raise exception 'Job is not in progress';
  end if;

  update jobs set status = 'done' where id = p_job_id;
  update tasks set status = 'done' where id = v_job.task_id and status = 'assigned';

  perform public.notify_parents(
    'job', (select display_name from profiles where id = auth.uid()) || ' finished "' || v_job.title || '" — verify & pay $' || v_job.amount
  );
end;
$$;

create or replace function public.pay_job(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job jobs%rowtype;
begin
  if not public.is_parent() then
    raise exception 'Parent role required';
  end if;

  select * into v_job from jobs where id = p_job_id;
  if not found or v_job.family_id <> public.current_family_id() then
    raise exception 'Job not found';
  end if;

  update jobs set status = 'paid' where id = p_job_id;
  update tasks set status = 'verified' where id = v_job.task_id;

  perform public.notify(v_job.taken_by, 'job', '"' || v_job.title || '" verified — you earned $' || v_job.amount || ' 🎉');
end;
$$;

create or replace function public.delete_job(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job jobs%rowtype;
begin
  if not public.is_parent() then
    raise exception 'Parent role required';
  end if;

  select * into v_job from jobs where id = p_job_id;
  if not found or v_job.family_id <> public.current_family_id() then
    return;
  end if;

  if v_job.task_id is not null then
    delete from tasks where id = v_job.task_id and status <> 'verified';
  end if;

  delete from jobs where id = p_job_id;
end;
$$;

-- ---- settings / notifications --------------------------------------------
create or replace function public.set_member_settings(p_member_id uuid, p_google_sync boolean, p_sharing public.calendar_sharing)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_parent() then
    raise exception 'Parent role required';
  end if;
  if not exists (select 1 from profiles where id = p_member_id and family_id = public.current_family_id()) then
    raise exception 'Not a family member';
  end if;

  update profiles set
    google_sync_enabled = coalesce(p_google_sync, google_sync_enabled),
    calendar_sharing = coalesce(p_sharing, calendar_sharing)
  where id = p_member_id;
end;
$$;

-- New: lets a family admin promote/demote a member between the parent/kid
-- chore-permission role. Someone who joins by invite code always starts as
-- 'kid' (least-privileged default); this is how an admin corrects that.
create function public.set_member_role(p_member_id uuid, p_role public.family_role)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_family_admin() then
    raise exception 'Admin role required';
  end if;
  if not exists (select 1 from profiles where id = p_member_id and family_id = public.current_family_id()) then
    raise exception 'Not a family member';
  end if;

  update profiles set role = p_role where id = p_member_id;
end;
$$;
revoke all on function public.set_member_role(uuid, public.family_role) from public;
grant execute on function public.set_member_role(uuid, public.family_role) to authenticated;

-- mark_all_read() is unchanged — to_profile_id = auth.uid() already scopes
-- it to exactly the caller's own inbox.

-- ---- daily brief + deadline alerts ---------------------------------------
create or replace function public.brief_line_for(p_member_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_family_id uuid;
  v_cycle int;
  v_ev_count int;
  v_task_count int;
  v_zone_names text;
  v_parts text[] := '{}';
begin
  select family_id into v_family_id from profiles where id = p_member_id;
  if v_family_id is null then
    return 'nothing scheduled — free day!';
  end if;
  v_cycle := public._cycle_num_for(v_family_id);

  select count(*) into v_ev_count from calendar_events where date = current_date and member_id = p_member_id;
  select count(*) into v_task_count from tasks where date <= current_date and member_id = p_member_id and status <> 'verified';
  select string_agg(z.name, ', ' order by z.name) into v_zone_names
  from zones z where z.family_id = v_family_id and public._zone_assignee_for(z.id, v_family_id, v_cycle) = p_member_id;

  if v_ev_count > 0 then
    v_parts := v_parts || (v_ev_count || ' event' || case when v_ev_count > 1 then 's' else '' end);
  end if;
  if v_task_count > 0 then
    v_parts := v_parts || (v_task_count || ' task' || case when v_task_count > 1 then 's' else '' end);
  end if;
  if v_zone_names is not null then
    v_parts := v_parts || ('zone: ' || v_zone_names);
  end if;

  if array_length(v_parts, 1) is null then
    return 'nothing scheduled — free day!';
  end if;
  return array_to_string(v_parts, ' · ');
end;
$$;

-- Cron-only: iterates every family via profiles.family_id, since
-- brief_line_for() derives its own per-member family scoping now.
create or replace function public.cron_send_daily_brief()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
begin
  perform public.cron_ensure_zone_tasks();
  for m in select id, display_name from profiles where family_id is not null loop
    perform public.notify(m.id, 'brief', 'Good morning ' || m.display_name || '! Today: ' || public.brief_line_for(m.id));
  end loop;
end;
$$;

-- Parent-triggered "send now" button — rewritten to only touch the caller's
-- own family. The original delegated straight to cron_send_daily_brief(),
-- which (now that it loops every family) would have sent every family's
-- briefs to everyone every time any parent clicked the button.
create or replace function public.send_daily_brief_all()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family_id uuid := public.current_family_id();
  m record;
begin
  if not public.is_parent() then
    raise exception 'Parent role required';
  end if;

  perform public._ensure_zone_tasks_for(v_family_id);
  for m in select id, display_name from profiles where family_id = v_family_id loop
    perform public.notify(m.id, 'brief', 'Good morning ' || m.display_name || '! Today: ' || public.brief_line_for(m.id));
  end loop;
end;
$$;

-- cron_generate_deadline_alerts() is unchanged — it operates per-task and
-- notifies task.member_id directly, which is already implicitly
-- family-scoped (a task's member always belongs to the task's own family).

-- =============================================================================
-- Family creation / joining
-- =============================================================================
create function public.create_family(p_name text)
returns public.families
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family families%rowtype;
  v_code text;
begin
  if not exists (select 1 from profiles where id = auth.uid()) then
    raise exception 'Not signed in';
  end if;
  if exists (select 1 from profiles where id = auth.uid() and family_id is not null) then
    raise exception 'Already in a family';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'Family name is required';
  end if;

  v_code := public.generate_family_invite_code();

  insert into families (name, invite_code, created_by)
  values (btrim(p_name), v_code, auth.uid())
  returning * into v_family;

  update profiles
  set family_id = v_family.id, family_member_role = 'admin', role = 'parent'
  where id = auth.uid();

  insert into zone_rotation (family_id, start_date, interval_days, offset_cycles, member_order)
  values (v_family.id, date_trunc('week', current_date)::date, 7, 0, '{}');

  return v_family;
end;
$$;
revoke all on function public.create_family(text) from public;
grant execute on function public.create_family(text) to authenticated;

-- Shared by both join paths (invite-code self-serve and email-invite
-- accept in the next migration) so "join a specific family" is defined
-- exactly once.
create function public._join_family(p_family_id uuid, p_role public.family_role, p_member_role public.family_member_role)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile profiles%rowtype;
begin
  update profiles
  set family_id = p_family_id, role = p_role, family_member_role = p_member_role
  where id = auth.uid()
  returning * into v_profile;

  perform public.notify_parents('update', v_profile.display_name || ' joined the family');

  return v_profile;
end;
$$;
revoke all on function public._join_family(uuid, public.family_role, public.family_member_role) from public;

-- Self-serve join: anyone with the code joins as a 'kid'/'member' by
-- default (least-privileged — an admin can promote from Settings
-- afterward via set_member_role()). p_role is deliberately not a
-- parameter here so a client can't request 'parent' for itself.
create function public.join_family_by_code(p_code text)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family_id uuid;
begin
  if exists (select 1 from profiles where id = auth.uid() and family_id is not null) then
    raise exception 'Already in a family';
  end if;
  if p_code is null or btrim(p_code) = '' then
    raise exception 'Enter an invite code';
  end if;

  select id into v_family_id from families where invite_code = upper(btrim(p_code));
  if v_family_id is null then
    raise exception 'Invalid invite code';
  end if;

  return public._join_family(v_family_id, 'kid', 'member');
end;
$$;
revoke all on function public.join_family_by_code(text) from public;
grant execute on function public.join_family_by_code(text) to authenticated;

create function public.regenerate_invite_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if not public.is_family_admin() then
    raise exception 'Admin role required';
  end if;

  v_code := public.generate_family_invite_code();
  update families set invite_code = v_code, updated_at = now() where id = public.current_family_id();
  return v_code;
end;
$$;
revoke all on function public.regenerate_invite_code() from public;
grant execute on function public.regenerate_invite_code() to authenticated;

-- Creates a minimal profiles row for every new auth.users signup (password
-- or Google) immediately, with family_id = null. This is what makes "not
-- yet in a family" a clean, always-present, centrally-checkable state
-- instead of the old "no profiles row at all" special case.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_display_name text;
begin
  v_display_name := coalesce(
    nullif(btrim(new.raw_user_meta_data->>'display_name'), ''),
    nullif(btrim(new.raw_user_meta_data->>'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data->>'name'), ''),
    split_part(new.email, '@', 1)
  );

  insert into public.profiles (id, display_name, role, color, family_id, family_member_role)
  values (new.id, v_display_name, 'kid', '#' || substr(md5(new.id::text), 1, 6), null, 'member')
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
