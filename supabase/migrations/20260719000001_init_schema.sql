-- Home Scheduler: full schema + RLS + business-logic RPC functions.
--
-- Architecture: every table has RLS enabled. Simple, side-effect-free tables
-- (calendar_events, subjects, push_subscriptions) allow direct client
-- read/write through RLS. Tables with multi-step business logic (tasks,
-- zones, zone_rotation, jobs, notifications) are read-only to clients via
-- RLS SELECT policies; every write goes through a SECURITY DEFINER RPC
-- function below, each named after and mirroring the reference prototype's
-- JS function of the same behavior (mark_task_done ~= markDone(), etc).
-- This keeps the state machine in one auditable place instead of duplicated
-- in the client.
--
-- Single household, closed allowlist: there is no signup flow. A row only
-- exists in `profiles` for the 5 real family members, inserted once by an
-- admin (service role) after each person's first Google sign-in — see
-- README "First-run family setup". Anyone else who signs in via Google gets
-- an auth.users row but no profiles row, and is_member() below makes every
-- policy and RPC fail closed for them.

create type public.family_role as enum ('parent', 'kid');
create type public.task_status as enum ('assigned', 'done', 'verified');
create type public.task_category as enum ('school', 'work', 'home', 'personal', 'goal', 'zone');
create type public.event_source as enum ('app', 'google');
create type public.job_status as enum ('open', 'taken', 'done', 'paid');
create type public.notif_kind as enum ('brief', 'deadline', 'nudge', 'update', 'sync', 'job');
create type public.calendar_sharing as enum ('family', 'parents', 'private');

create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles — one row per real family member, id = auth.users.id.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  role public.family_role not null,
  color text not null,
  google_sync_enabled boolean not null default true,
  calendar_sharing public.calendar_sharing not null default 'family',
  created_at timestamptz not null default now()
);

create function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid());
$$;

create function public.is_parent()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'parent');
$$;

-- ---------------------------------------------------------------------------
-- subjects — parent-customizable school subjects. Deleting one leaves tasks
-- with subject_id = null, which the app labels "School · Other".
-- ---------------------------------------------------------------------------
create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  position int not null default 0,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- calendar_events — in-person appointments. Direct client read/write (no
-- side effects beyond the Google sync webhook added in a later migration).
-- ---------------------------------------------------------------------------
create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  date date not null,
  start_time time not null,
  end_time time not null,
  source public.event_source not null default 'app',
  google_calendar_id text,
  google_event_id text,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index calendar_events_member_id_idx on public.calendar_events (member_id);
create index calendar_events_date_idx on public.calendar_events (date);
create unique index calendar_events_google_event_idx
  on public.calendar_events (google_calendar_id, google_event_id)
  where google_event_id is not null;

create trigger calendar_events_set_updated_at
  before update on public.calendar_events
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- zones + rotation. zone_rotation is a singleton row (id = true is the only
-- allowed value). member_order is the fixed, ordered list of kid ids that
-- zones rotate among — set once at bootstrap, never edited by the app (the
-- prototype has no UI for it either).
-- ---------------------------------------------------------------------------
create table public.zones (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subzones text[] not null default '{}',
  assigned_to uuid references public.profiles (id) on delete set null, -- parent pin; null = rotation
  created_at timestamptz not null default now()
);

create table public.zone_rotation (
  id boolean primary key default true,
  constraint zone_rotation_singleton check (id),
  start_date date not null,
  interval_days int, -- null = manual (only "Rotate now" advances the cycle)
  offset_cycles int not null default 0,
  member_order uuid[] not null default '{}'
);

-- Cycle a zone was marked verified/deleted in, so it doesn't regenerate
-- until the next cycle. Mirrors the prototype's S.zoneDone map.
create table public.zone_dismissals (
  zone_id uuid not null references public.zones (id) on delete cascade,
  cycle int not null,
  primary key (zone_id, cycle)
);

-- ---------------------------------------------------------------------------
-- jobs — paid work-for-hire board. tasks.job_id FK added after this table.
-- ---------------------------------------------------------------------------
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  amount numeric(10, 2) not null check (amount > 0),
  status public.job_status not null default 'open',
  taken_by uuid references public.profiles (id) on delete set null,
  task_id uuid, -- FK added after tasks table exists (circular reference)
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- tasks + subtasks.
-- ---------------------------------------------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  member_id uuid not null references public.profiles (id) on delete cascade,
  category public.task_category not null,
  subject_id uuid references public.subjects (id) on delete set null,
  date date not null,
  deadline time,
  remind_minutes int not null default 0 check (remind_minutes >= 0),
  status public.task_status not null default 'assigned',
  created_by uuid not null references public.profiles (id),
  zone_id uuid references public.zones (id) on delete set null,
  zone_cycle int,
  job_id uuid references public.jobs (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subject_only_for_school check (subject_id is null or category = 'school')
);

alter table public.jobs
  add constraint jobs_task_id_fkey foreign key (task_id) references public.tasks (id) on delete set null;

create index tasks_member_id_idx on public.tasks (member_id);
create index tasks_date_idx on public.tasks (date);
create index tasks_status_idx on public.tasks (status);
create index tasks_zone_idx on public.tasks (zone_id, zone_cycle);

create trigger tasks_set_updated_at
  before update on public.tasks
  for each row execute function public.set_updated_at();

create table public.subtasks (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  title text not null,
  done boolean not null default false,
  position int not null default 0
);

create index subtasks_task_id_idx on public.subtasks (task_id);

-- ---------------------------------------------------------------------------
-- notifications — single delivery record for in-app inbox + (later
-- migration) the web-push trigger. dedupe_key prevents duplicate deadline
-- alerts for the same task.
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  to_profile_id uuid not null references public.profiles (id) on delete cascade,
  kind public.notif_kind not null,
  text text not null,
  dedupe_key text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index notifications_to_profile_id_idx on public.notifications (to_profile_id, read);
create unique index notifications_dedupe_key_idx on public.notifications (dedupe_key) where dedupe_key is not null;

-- ---------------------------------------------------------------------------
-- push_subscriptions — Web Push (VAPID). Direct client read/write, no side
-- effects.
-- ---------------------------------------------------------------------------
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create index push_subscriptions_profile_id_idx on public.push_subscriptions (profile_id);

-- ---------------------------------------------------------------------------
-- google_tokens — server-only (no RLS policies at all; only the service
-- role, used by Edge Functions, can read/write). One row per person with
-- Google Calendar sync connected.
-- ---------------------------------------------------------------------------
create table public.google_tokens (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  access_token text not null,
  refresh_token text not null,
  expiry timestamptz not null,
  calendar_id text,
  sync_token text,
  watch_channel_id text,
  watch_resource_id text,
  watch_expiration timestamptz,
  updated_at timestamptz not null default now()
);

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.profiles enable row level security;
alter table public.subjects enable row level security;
alter table public.calendar_events enable row level security;
alter table public.zones enable row level security;
alter table public.zone_rotation enable row level security;
alter table public.zone_dismissals enable row level security;
alter table public.jobs enable row level security;
alter table public.tasks enable row level security;
alter table public.subtasks enable row level security;
alter table public.notifications enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.google_tokens enable row level security;

-- profiles: every family member can see every other member (kids need
-- names/colors for everyone's calendar). No direct writes — role/color
-- aren't editable from any UI, and google sync/sharing settings go through
-- set_member_settings() below.
create policy "profiles: select members" on public.profiles
  for select using (public.is_member());

-- subjects: everyone reads; only parents write.
create policy "subjects: select members" on public.subjects
  for select using (public.is_member());
create policy "subjects: parent writes" on public.subjects
  for all using (public.is_parent()) with check (public.is_parent());

-- calendar_events: everyone in the family can see everyone's events; only
-- the owner or a parent can write.
create policy "calendar_events: select members" on public.calendar_events
  for select using (public.is_member());
create policy "calendar_events: owner or parent writes" on public.calendar_events
  for all
  using (public.is_member() and (member_id = auth.uid() or public.is_parent()))
  with check (public.is_member() and (member_id = auth.uid() or public.is_parent()));

-- zones / zone_rotation / zone_dismissals: read-only to clients; all writes
-- go through the RPC functions below.
create policy "zones: select members" on public.zones
  for select using (public.is_member());
create policy "zone_rotation: select members" on public.zone_rotation
  for select using (public.is_member());
create policy "zone_dismissals: select members" on public.zone_dismissals
  for select using (public.is_member());
revoke insert, update, delete on public.zones from authenticated;
revoke insert, update, delete on public.zone_rotation from authenticated;
revoke insert, update, delete on public.zone_dismissals from authenticated;

-- jobs: read-only to clients; all writes go through RPC functions.
create policy "jobs: select members" on public.jobs
  for select using (public.is_member());
revoke insert, update, delete on public.jobs from authenticated;

-- tasks: kids see only their own; parents see everything. Read-only to
-- clients — all writes go through RPC functions.
create policy "tasks: select own or parent" on public.tasks
  for select using (public.is_member() and (member_id = auth.uid() or public.is_parent()));
revoke insert, update, delete on public.tasks from authenticated;

-- subtasks: same visibility as their parent task. Read-only to clients.
create policy "subtasks: select via parent task" on public.subtasks
  for select using (
    exists (
      select 1 from public.tasks t
      where t.id = task_id and (t.member_id = auth.uid() or public.is_parent())
    )
  );
revoke insert, update, delete on public.subtasks from authenticated;

-- notifications: everyone reads only their own inbox. Writes (including
-- mark-all-read) go through RPC functions.
create policy "notifications: select own" on public.notifications
  for select using (to_profile_id = auth.uid());
revoke insert, update, delete on public.notifications from authenticated;

-- push_subscriptions: owner-only, direct read/write (no side effects).
create policy "push_subscriptions: owner only" on public.push_subscriptions
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- google_tokens: no policies — zero access for anon/authenticated. Only the
-- service role (used by Edge Functions) can read/write, bypassing RLS.

-- =============================================================================
-- Business logic RPC functions
-- =============================================================================

-- ---- internal notification helpers (not granted to authenticated; only
-- ---- callable from within the SECURITY DEFINER functions below) ----------
create function public.notify(p_to uuid, p_kind public.notif_kind, p_text text, p_dedupe_key text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_dedupe_key is not null and exists (select 1 from notifications where dedupe_key = p_dedupe_key) then
    return;
  end if;
  insert into notifications (to_profile_id, kind, text, dedupe_key) values (p_to, p_kind, p_text, p_dedupe_key);
end;
$$;

create function public.notify_parents(p_kind public.notif_kind, p_text text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p record;
begin
  for p in select id from profiles where role = 'parent' loop
    perform public.notify(p.id, p_kind, p_text);
  end loop;
end;
$$;

-- ---- zone rotation math ----------------------------------------------------
create function public.cycle_num()
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r record;
  v_days int;
begin
  select * into r from zone_rotation limit 1;
  if r.interval_days is null then
    return r.offset_cycles;
  end if;
  v_days := current_date - r.start_date;
  return floor(v_days::numeric / r.interval_days)::int + r.offset_cycles;
end;
$$;
revoke all on function public.cycle_num() from public;
grant execute on function public.cycle_num() to authenticated;

create function public.next_rotation_date()
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
  select * into r from zone_rotation limit 1;
  if r.interval_days is null then
    return null; -- manual mode; UI shows "when you press Rotate now"
  end if;
  v_days := current_date - r.start_date;
  v_next := (floor(v_days::numeric / r.interval_days)::int + 1) * r.interval_days;
  return r.start_date + v_next;
end;
$$;
revoke all on function public.next_rotation_date() from public;
grant execute on function public.next_rotation_date() to authenticated;

create function public.zone_assignee(p_zone_id uuid)
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
  select assigned_to into v_pinned from zones where id = p_zone_id;
  if v_pinned is not null then
    return v_pinned;
  end if;

  select idx into v_idx from (
    select id, (row_number() over (order by created_at) - 1)::int as idx from zones
  ) ranked where ranked.id = p_zone_id;
  if v_idx is null then
    return null;
  end if;

  select member_order into v_members from zone_rotation limit 1;
  v_count := coalesce(array_length(v_members, 1), 0);
  if v_count = 0 then
    return null;
  end if;

  return v_members[((v_idx + public.cycle_num()) % v_count + v_count) % v_count + 1];
end;
$$;
revoke all on function public.zone_assignee(uuid) from public;
grant execute on function public.zone_assignee(uuid) to authenticated;

-- Zones materialize as tasks on the assignee's list, one per rotation
-- cycle. Idempotent — safe to call on every page load and from cron.
create function public.ensure_zone_tasks()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cycle int := public.cycle_num();
  z record;
  v_who uuid;
  v_task_id uuid;
  v_existing record;
  v_sub text;
  v_pos int;
begin
  if not public.is_member() then
    raise exception 'Not a family member';
  end if;

  -- Drop stale incomplete zone tasks from previous cycles or deleted zones.
  delete from tasks t
  where t.zone_id is not null
    and t.status <> 'verified'
    and (t.zone_cycle is distinct from v_cycle or not exists (select 1 from zones zz where zz.id = t.zone_id));

  for z in select * from zones loop
    if exists (select 1 from zone_dismissals d where d.zone_id = z.id and d.cycle = v_cycle) then
      continue;
    end if;
    v_who := public.zone_assignee(z.id);
    if v_who is null then
      continue;
    end if;

    select * into v_existing from tasks where zone_id = z.id and zone_cycle = v_cycle limit 1;
    if not found then
      insert into tasks (title, member_id, category, date, status, created_by, zone_id, zone_cycle)
      values ('Zone: ' || z.name, v_who, 'zone', current_date, 'assigned', v_who, z.id, v_cycle)
      returning id into v_task_id;

      v_pos := 0;
      foreach v_sub in array coalesce(z.subzones, '{}') loop
        insert into subtasks (task_id, title, position) values (v_task_id, v_sub, v_pos);
        v_pos := v_pos + 1;
      end loop;
    elsif v_existing.member_id <> v_who and v_existing.status = 'assigned' then
      update tasks set member_id = v_who where id = v_existing.id;
    end if;
  end loop;
end;
$$;
revoke all on function public.ensure_zone_tasks() from public;
grant execute on function public.ensure_zone_tasks() to authenticated;

-- Cron-only entry point: same as ensure_zone_tasks() but without the
-- is_member() gate, since pg_cron calls run with no auth.uid(). Not granted
-- to authenticated/anon.
create function public.cron_ensure_zone_tasks()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cycle int := public.cycle_num();
  z record;
  v_who uuid;
  v_task_id uuid;
  v_existing record;
  v_sub text;
  v_pos int;
begin
  delete from tasks t
  where t.zone_id is not null
    and t.status <> 'verified'
    and (t.zone_cycle is distinct from v_cycle or not exists (select 1 from zones zz where zz.id = t.zone_id));

  for z in select * from zones loop
    if exists (select 1 from zone_dismissals d where d.zone_id = z.id and d.cycle = v_cycle) then
      continue;
    end if;
    v_who := public.zone_assignee(z.id);
    if v_who is null then
      continue;
    end if;

    select * into v_existing from tasks where zone_id = z.id and zone_cycle = v_cycle limit 1;
    if not found then
      insert into tasks (title, member_id, category, date, status, created_by, zone_id, zone_cycle)
      values ('Zone: ' || z.name, v_who, 'zone', current_date, 'assigned', v_who, z.id, v_cycle)
      returning id into v_task_id;

      v_pos := 0;
      foreach v_sub in array coalesce(z.subzones, '{}') loop
        insert into subtasks (task_id, title, position) values (v_task_id, v_sub, v_pos);
        v_pos := v_pos + 1;
      end loop;
    elsif v_existing.member_id <> v_who and v_existing.status = 'assigned' then
      update tasks set member_id = v_who where id = v_existing.id;
    end if;
  end loop;
end;
$$;
revoke all on function public.cron_ensure_zone_tasks() from public;

create function public.rotate_now()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  mid uuid;
  v_zone_names text;
begin
  if not public.is_parent() then
    raise exception 'Parent role required';
  end if;

  update zone_rotation set offset_cycles = offset_cycles + 1;
  perform public.ensure_zone_tasks();

  for mid in select unnest(member_order) from zone_rotation loop
    select string_agg(z.name, ', ' order by z.name) into v_zone_names
    from zones z where public.zone_assignee(z.id) = mid;
    if v_zone_names is not null then
      perform public.notify(mid, 'update', 'Zone rotation: this week you have ' || v_zone_names);
    end if;
  end loop;
end;
$$;
revoke all on function public.rotate_now() from public;
grant execute on function public.rotate_now() to authenticated;

-- Preserves current-cycle assignments across an interval change (does not
-- scramble who has what right now).
create function public.set_zone_interval(p_interval_days int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cur_cycle int;
  v_days int;
  r record;
begin
  if not public.is_parent() then
    raise exception 'Parent role required';
  end if;

  select * into r from zone_rotation limit 1;
  v_cur_cycle := public.cycle_num();

  if p_interval_days is null then
    update zone_rotation set interval_days = null, offset_cycles = v_cur_cycle;
  else
    v_days := current_date - r.start_date;
    update zone_rotation set interval_days = p_interval_days,
      offset_cycles = v_cur_cycle - floor(v_days::numeric / p_interval_days)::int;
  end if;

  perform public.ensure_zone_tasks();
end;
$$;
revoke all on function public.set_zone_interval(int) from public;
grant execute on function public.set_zone_interval(int) to authenticated;

-- p_member_id = null returns the zone to rotation.
create function public.set_zone_assignee(p_zone_id uuid, p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cycle int;
  v_who uuid;
  v_zone_name text;
begin
  if not public.is_parent() then
    raise exception 'Parent role required';
  end if;

  update zones set assigned_to = p_member_id where id = p_zone_id;

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
revoke all on function public.set_zone_assignee(uuid, uuid) from public;
grant execute on function public.set_zone_assignee(uuid, uuid) to authenticated;

create function public.save_zone(p_zone_id uuid, p_name text, p_subzones text[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_parent() then
    raise exception 'Parent role required';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'Zone name is required';
  end if;

  if p_zone_id is null then
    insert into zones (name, subzones) values (p_name, coalesce(p_subzones, '{}')) returning id into v_id;
  else
    update zones set name = p_name, subzones = coalesce(p_subzones, '{}') where id = p_zone_id returning id into v_id;
    -- Refresh this cycle's task to match the new sub-areas (drops progress on that checklist).
    delete from tasks where zone_id = v_id and zone_cycle = public.cycle_num() and status <> 'verified';
  end if;

  perform public.ensure_zone_tasks();
  return v_id;
end;
$$;
revoke all on function public.save_zone(uuid, text, text[]) from public;
grant execute on function public.save_zone(uuid, text, text[]) to authenticated;

create function public.delete_zone(p_zone_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_parent() then
    raise exception 'Parent role required';
  end if;

  delete from tasks where zone_id = p_zone_id and status <> 'verified';
  delete from zones where id = p_zone_id;
end;
$$;
revoke all on function public.delete_zone(uuid) from public;
grant execute on function public.delete_zone(uuid) to authenticated;

-- ---- tasks ------------------------------------------------------------
create function public.create_task(
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
  v_task_id uuid;
  v_sub text;
  v_pos int := 0;
begin
  if not public.is_member() then
    raise exception 'Not a family member';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception 'Title is required';
  end if;
  if not public.is_parent() and p_member_id <> auth.uid() then
    raise exception 'Kids can only add items for themselves';
  end if;

  insert into tasks (title, member_id, category, subject_id, date, deadline, remind_minutes, status, created_by)
  values (p_title, p_member_id, p_category, p_subject_id, p_date, p_deadline, coalesce(p_remind_minutes, 0), 'assigned', auth.uid())
  returning id into v_task_id;

  foreach v_sub in array coalesce(p_subtasks, '{}') loop
    insert into subtasks (task_id, title, position) values (v_task_id, v_sub, v_pos);
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
revoke all on function public.create_task(text, uuid, public.task_category, uuid, date, time, int, text[]) from public;
grant execute on function public.create_task(text, uuid, public.task_category, uuid, date, time, int, text[]) to authenticated;

create function public.toggle_subtask(p_subtask_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task record;
begin
  select t.id, t.member_id into v_task from subtasks s join tasks t on t.id = s.task_id where s.id = p_subtask_id;
  if not found then
    raise exception 'Subtask not found';
  end if;
  if not public.is_parent() and v_task.member_id <> auth.uid() then
    raise exception 'Not allowed';
  end if;

  update subtasks set done = not done where id = p_subtask_id;
end;
$$;
revoke all on function public.toggle_subtask(uuid) from public;
grant execute on function public.toggle_subtask(uuid) to authenticated;

create function public.mark_task_done(p_task_id uuid)
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
  if not found then
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
revoke all on function public.mark_task_done(uuid) from public;
grant execute on function public.mark_task_done(uuid) to authenticated;

create function public.verify_task(p_task_id uuid)
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
  if not found then
    raise exception 'Task not found';
  end if;

  update tasks set status = 'verified' where id = p_task_id;

  if v_task.zone_id is not null then
    insert into zone_dismissals (zone_id, cycle) values (v_task.zone_id, v_task.zone_cycle) on conflict do nothing;
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
revoke all on function public.verify_task(uuid) from public;
grant execute on function public.verify_task(uuid) to authenticated;

create function public.delete_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task tasks%rowtype;
begin
  select * into v_task from tasks where id = p_task_id;
  if not found then
    return; -- idempotent, mirrors the prototype's filter-based delete
  end if;

  if not public.is_parent() then
    if not (v_task.member_id = auth.uid() and v_task.created_by = auth.uid() and v_task.zone_id is null) then
      raise exception 'Not allowed';
    end if;
  end if;

  if v_task.zone_id is not null then
    insert into zone_dismissals (zone_id, cycle) values (v_task.zone_id, v_task.zone_cycle) on conflict do nothing;
  end if;

  delete from tasks where id = p_task_id;
end;
$$;
revoke all on function public.delete_task(uuid) from public;
grant execute on function public.delete_task(uuid) to authenticated;

create function public.move_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task tasks%rowtype;
begin
  select * into v_task from tasks where id = p_task_id;
  if not found then
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
revoke all on function public.move_task(uuid) from public;
grant execute on function public.move_task(uuid) to authenticated;

create function public.roll_all_tasks()
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
    where date < current_date and status = 'assigned'
    returning 1
  )
  select count(*) into v_count from updated;

  return v_count;
end;
$$;
revoke all on function public.roll_all_tasks() from public;
grant execute on function public.roll_all_tasks() to authenticated;

create function public.nudge_task(p_task_id uuid)
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
  if not found then
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
revoke all on function public.nudge_task(uuid) from public;
grant execute on function public.nudge_task(uuid) to authenticated;

-- ---- work-for-hire jobs -------------------------------------------------
create function public.create_job(p_title text, p_amount numeric)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  k record;
begin
  if not public.is_parent() then
    raise exception 'Parent role required';
  end if;
  if p_title is null or btrim(p_title) = '' then
    raise exception 'Job title is required';
  end if;

  insert into jobs (title, amount, status) values (p_title, p_amount, 'open') returning id into v_id;

  for k in select id from profiles where role = 'kid' loop
    perform public.notify(k.id, 'job', 'New paid job posted: "' || p_title || '" — $' || p_amount);
  end loop;

  return v_id;
end;
$$;
revoke all on function public.create_job(text, numeric) from public;
grant execute on function public.create_job(text, numeric) to authenticated;

create function public.take_job(p_job_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job jobs%rowtype;
  v_task_id uuid;
  v_name text;
begin
  if not public.is_member() or public.is_parent() then
    raise exception 'Only kids can take jobs';
  end if;

  select * into v_job from jobs where id = p_job_id for update;
  if not found then
    raise exception 'Job not found';
  end if;
  if v_job.status <> 'open' then
    raise exception 'Job is no longer open';
  end if;

  update jobs set status = 'taken', taken_by = auth.uid() where id = p_job_id;

  insert into tasks (title, member_id, category, date, status, created_by, job_id)
  values ('Job: ' || v_job.title || ' ($' || v_job.amount || ')', auth.uid(), 'work', current_date, 'assigned', auth.uid(), p_job_id)
  returning id into v_task_id;

  update jobs set task_id = v_task_id where id = p_job_id;

  select display_name into v_name from profiles where id = auth.uid();
  perform public.notify_parents('job', v_name || ' claimed the job "' || v_job.title || '" ($' || v_job.amount || ')');

  return v_task_id;
end;
$$;
revoke all on function public.take_job(uuid) from public;
grant execute on function public.take_job(uuid) to authenticated;

create function public.job_done(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job jobs%rowtype;
begin
  select * into v_job from jobs where id = p_job_id;
  if not found then
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
revoke all on function public.job_done(uuid) from public;
grant execute on function public.job_done(uuid) to authenticated;

create function public.pay_job(p_job_id uuid)
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
  if not found then
    raise exception 'Job not found';
  end if;

  update jobs set status = 'paid' where id = p_job_id;
  update tasks set status = 'verified' where id = v_job.task_id;

  perform public.notify(v_job.taken_by, 'job', '"' || v_job.title || '" verified — you earned $' || v_job.amount || ' 🎉');
end;
$$;
revoke all on function public.pay_job(uuid) from public;
grant execute on function public.pay_job(uuid) to authenticated;

create function public.delete_job(p_job_id uuid)
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
  if not found then
    return;
  end if;

  if v_job.task_id is not null then
    delete from tasks where id = v_job.task_id and status <> 'verified';
  end if;

  delete from jobs where id = p_job_id;
end;
$$;
revoke all on function public.delete_job(uuid) from public;
grant execute on function public.delete_job(uuid) to authenticated;

-- ---- settings / notifications --------------------------------------------
create function public.set_member_settings(p_member_id uuid, p_google_sync boolean, p_sharing public.calendar_sharing)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_parent() then
    raise exception 'Parent role required';
  end if;

  update profiles set
    google_sync_enabled = coalesce(p_google_sync, google_sync_enabled),
    calendar_sharing = coalesce(p_sharing, calendar_sharing)
  where id = p_member_id;
end;
$$;
revoke all on function public.set_member_settings(uuid, boolean, public.calendar_sharing) from public;
grant execute on function public.set_member_settings(uuid, boolean, public.calendar_sharing) to authenticated;

create function public.mark_all_read()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update notifications set read = true where to_profile_id = auth.uid() and read = false;
end;
$$;
revoke all on function public.mark_all_read() from public;
grant execute on function public.mark_all_read() to authenticated;

-- ---- daily brief + deadline alerts ---------------------------------------
create function public.brief_line_for(p_member_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ev_count int;
  v_task_count int;
  v_zone_names text;
  v_parts text[] := '{}';
begin
  select count(*) into v_ev_count from calendar_events where date = current_date and member_id = p_member_id;
  select count(*) into v_task_count from tasks where date <= current_date and member_id = p_member_id and status <> 'verified';
  select string_agg(z.name, ', ' order by z.name) into v_zone_names from zones z where public.zone_assignee(z.id) = p_member_id;

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
revoke all on function public.brief_line_for(uuid) from public;
grant execute on function public.brief_line_for(uuid) to authenticated;

-- Cron-only: no auth.uid() available under pg_cron, so no is_member()/
-- is_parent() gate — not granted to authenticated/anon.
create function public.cron_send_daily_brief()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
begin
  perform public.cron_ensure_zone_tasks();
  for m in select id, display_name from profiles loop
    perform public.notify(m.id, 'brief', 'Good morning ' || m.display_name || '! Today: ' || public.brief_line_for(m.id));
  end loop;
end;
$$;
revoke all on function public.cron_send_daily_brief() from public;

-- Parent-triggered "send now" button on the Today tab.
create function public.send_daily_brief_all()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_parent() then
    raise exception 'Parent role required';
  end if;
  perform public.cron_send_daily_brief();
end;
$$;
revoke all on function public.send_daily_brief_all() from public;
grant execute on function public.send_daily_brief_all() to authenticated;

-- Cron-only: generates a deadline alert once per task, when now falls
-- within that task's configured reminder lead time.
create function public.cron_generate_deadline_alerts()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  v_diff_min numeric;
begin
  for t in select * from tasks where status = 'assigned' and deadline is not null and date = current_date loop
    v_diff_min := extract(epoch from (t.deadline - localtime)) / 60.0;
    if v_diff_min > 0 and v_diff_min <= coalesce(t.remind_minutes, 60) then
      perform public.notify(
        t.member_id, 'deadline',
        '"' || t.title || '" is due at ' || to_char(t.deadline, 'HH24:MI') || ' (' || round(v_diff_min) || ' min from now)',
        'deadline:' || t.id
      );
    end if;
  end loop;
end;
$$;
revoke all on function public.cron_generate_deadline_alerts() from public;
