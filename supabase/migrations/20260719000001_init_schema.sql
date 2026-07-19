-- Home Scheduler: initial schema.
-- One household ("family") per deployment in practice, but modeled as a
-- table rather than assumed singleton so RLS has something to scope on.

create type public.family_role as enum ('parent', 'kid');
create type public.task_status as enum ('assigned', 'done', 'verified');

create table public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  zone_rotation_interval_days int not null default 7,
  created_at timestamptz not null default now()
);

-- One row per auth.users member, extended with app-specific fields.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  family_id uuid not null references public.families (id) on delete cascade,
  display_name text not null,
  role public.family_role not null,
  color text not null, -- e.g. '#000000' (Dad black, Mom yellow, Sara pink, David blue, JJ green)
  created_at timestamptz not null default now()
);

create index profiles_family_id_idx on public.profiles (family_id);

-- Returns the caller's profile row. security definer + stable so it can be
-- used freely inside RLS policies without re-triggering RLS on `profiles`
-- (which would otherwise recurse).
create function public.current_profile()
returns public.profiles
language sql
security definer
stable
set search_path = public
as $$
  select * from public.profiles where id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Calendar events — in-person appointments/commitments. Kids can see
-- everyone's events (Must-have #6); only the owner or a parent may write.
-- ---------------------------------------------------------------------------
create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  location text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  google_calendar_id text, -- which Google calendar (one per person) this is synced to
  google_event_id text,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index calendar_events_family_id_idx on public.calendar_events (family_id);
create index calendar_events_owner_id_idx on public.calendar_events (owner_id);
create unique index calendar_events_google_event_idx
  on public.calendar_events (google_calendar_id, google_event_id)
  where google_event_id is not null;

-- ---------------------------------------------------------------------------
-- Tasks — assigned, must-do, owned, verifiable.
-- Workflow: parent assigns -> kid marks done -> parent verifies -> parent deletes.
-- ---------------------------------------------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  description text,
  category text not null, -- school | zones | work | home | personal
  subject text, -- e.g. school subject, when category = 'school'
  due_at timestamptz,
  status public.task_status not null default 'assigned',
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tasks_family_id_idx on public.tasks (family_id);
create index tasks_owner_id_idx on public.tasks (owner_id);
create index tasks_due_at_idx on public.tasks (due_at);

create table public.subtasks (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  title text not null,
  done boolean not null default false,
  position int not null default 0
);

create index subtasks_task_id_idx on public.subtasks (task_id);

-- ---------------------------------------------------------------------------
-- Personal lists — self-managed, owner-only.
-- ---------------------------------------------------------------------------
create table public.lists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  created_at timestamptz not null default now()
);

create table public.list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lists (id) on delete cascade,
  content text not null,
  done boolean not null default false,
  position int not null default 0
);

create index list_items_list_id_idx on public.list_items (list_id);

-- ---------------------------------------------------------------------------
-- Rotating chore zones — areas of the home, rotated among members at a
-- configurable interval (default weekly, see families.zone_rotation_interval_days).
-- ---------------------------------------------------------------------------
create table public.zones (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create index zones_family_id_idx on public.zones (family_id);

create table public.zone_assignments (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references public.zones (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  starts_on date not null,
  ends_on date not null
);

create index zone_assignments_zone_id_idx on public.zone_assignments (zone_id);
create index zone_assignments_profile_id_idx on public.zone_assignments (profile_id);

-- ---------------------------------------------------------------------------
-- Web push subscriptions — daily brief, deadline alerts, on-demand nudges.
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
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.families enable row level security;
alter table public.profiles enable row level security;
alter table public.calendar_events enable row level security;
alter table public.tasks enable row level security;
alter table public.subtasks enable row level security;
alter table public.lists enable row level security;
alter table public.list_items enable row level security;
alter table public.zones enable row level security;
alter table public.zone_assignments enable row level security;
alter table public.push_subscriptions enable row level security;

-- families: any family member can read their own family row.
create policy "families: select own" on public.families
  for select using (id = (select family_id from public.current_profile()));

-- profiles: everyone can see everyone in their own family (kids need this to
-- know who's who); only parents can insert/update/delete other members, and
-- everyone can update their own row.
create policy "profiles: select same family" on public.profiles
  for select using (family_id = (select family_id from public.current_profile()));

create policy "profiles: update self" on public.profiles
  for update using (id = auth.uid());

create policy "profiles: parents manage family" on public.profiles
  for all using (
    family_id = (select family_id from public.current_profile())
    and (select role from public.current_profile()) = 'parent'
  );

-- calendar_events: whole family can view (kids see where everyone is);
-- owner or any parent can write.
create policy "calendar_events: select same family" on public.calendar_events
  for select using (family_id = (select family_id from public.current_profile()));

create policy "calendar_events: owner or parent writes" on public.calendar_events
  for all using (
    family_id = (select family_id from public.current_profile())
    and (
      owner_id = auth.uid()
      or (select role from public.current_profile()) = 'parent'
    )
  );

-- tasks: kids see only their own tasks; parents see/manage everything in family.
create policy "tasks: select own or parent" on public.tasks
  for select using (
    family_id = (select family_id from public.current_profile())
    and (
      owner_id = auth.uid()
      or (select role from public.current_profile()) = 'parent'
    )
  );

create policy "tasks: parent manages" on public.tasks
  for all using (
    family_id = (select family_id from public.current_profile())
    and (select role from public.current_profile()) = 'parent'
  );

-- Kids can mark their own task done, but not edit/delete/reassign it.
-- Note: this only constrains the `status` value, not other columns — a
-- trigger would be needed to fully lock title/owner/etc. against a kid's
-- update. Acceptable for family-scale trust; tighten if this ever leaves
-- that context.
create policy "tasks: owner marks done" on public.tasks
  for update using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and status = 'done');

-- subtasks: same visibility/write rules as their parent task.
create policy "subtasks: follow parent task select" on public.subtasks
  for select using (
    exists (
      select 1 from public.tasks t
      where t.id = task_id
        and t.family_id = (select family_id from public.current_profile())
        and (t.owner_id = auth.uid() or (select role from public.current_profile()) = 'parent')
    )
  );

create policy "subtasks: parent manages" on public.subtasks
  for all using (
    exists (
      select 1 from public.tasks t
      where t.id = task_id
        and t.family_id = (select family_id from public.current_profile())
        and (select role from public.current_profile()) = 'parent'
    )
  );

create policy "subtasks: owner toggles done" on public.subtasks
  for update using (
    exists (select 1 from public.tasks t where t.id = task_id and t.owner_id = auth.uid())
  );

-- lists / list_items: personal, owner-only.
create policy "lists: owner only" on public.lists
  for all using (owner_id = auth.uid());

create policy "list_items: owner only" on public.list_items
  for all using (
    exists (select 1 from public.lists l where l.id = list_id and l.owner_id = auth.uid())
  );

-- zones / zone_assignments: whole family can view; only parents manage.
create policy "zones: select same family" on public.zones
  for select using (family_id = (select family_id from public.current_profile()));

create policy "zones: parent manages" on public.zones
  for all using (
    family_id = (select family_id from public.current_profile())
    and (select role from public.current_profile()) = 'parent'
  );

create policy "zone_assignments: select same family" on public.zone_assignments
  for select using (
    exists (
      select 1 from public.zones z
      where z.id = zone_id
        and z.family_id = (select family_id from public.current_profile())
    )
  );

create policy "zone_assignments: parent manages" on public.zone_assignments
  for all using (
    exists (
      select 1 from public.zones z
      where z.id = zone_id
        and z.family_id = (select family_id from public.current_profile())
        and (select role from public.current_profile()) = 'parent'
    )
  );

-- push_subscriptions: owner-only.
create policy "push_subscriptions: owner only" on public.push_subscriptions
  for all using (profile_id = auth.uid());
