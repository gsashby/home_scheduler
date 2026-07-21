-- Calendar view upgrades: richer event fields (location, notes, all-day)
-- plus the ability to share an event with other family members beyond its
-- single owner. calendar_events keeps its NOT NULL member_id as the
-- "owner" (drives Google sync export target, tile color, and the existing
-- owner-or-parent write policy); calendar_event_attendees is an additive
-- many-to-many list of who else it's shared with. Selecting on
-- calendar_events already returns every event in the family regardless of
-- owner (see "calendar_events: select family" in
-- 20260720000001_multi_tenant_families.sql) — attendees only change which
-- calendar filter chip an event matches, not who can already see it.
--
-- location/notes/all_day are app-only for now: the Google outbox trigger
-- (enqueue_google_outbox in 20260720000004_google_calendar_sync.sql) and
-- the sync Edge Function still only read/write title/date/start_time/
-- end_time, so these new fields don't round-trip to Google yet.

alter table public.calendar_events
  add column location text,
  add column notes text,
  add column all_day boolean not null default false;

create table public.calendar_event_attendees (
  event_id uuid not null references public.calendar_events (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  family_id uuid not null references public.families (id),
  created_at timestamptz not null default now(),
  primary key (event_id, member_id)
);

create index calendar_event_attendees_member_id_idx on public.calendar_event_attendees (member_id);
create index calendar_event_attendees_family_id_idx on public.calendar_event_attendees (family_id);

alter table public.calendar_event_attendees enable row level security;

create policy "calendar_event_attendees: select family" on public.calendar_event_attendees
  for select using (public.is_member() and family_id = public.current_family_id());

-- Writable by whoever can already write the parent event (its owner, or
-- any parent) — same "owner or parent" rule as calendar_events itself.
create policy "calendar_event_attendees: write via event owner or parent" on public.calendar_event_attendees
  for all
  using (
    public.is_member() and family_id = public.current_family_id()
    and exists (
      select 1 from public.calendar_events e
      where e.id = event_id and (e.member_id = auth.uid() or public.is_parent())
    )
  )
  with check (
    public.is_member() and family_id = public.current_family_id()
    and exists (
      select 1 from public.calendar_events e
      where e.id = event_id and (e.member_id = auth.uid() or public.is_parent())
    )
  );

create trigger calendar_event_attendees_force_family_id
  before insert or update on public.calendar_event_attendees
  for each row execute function public.force_own_family_id();

grant select, insert, update, delete on public.calendar_event_attendees to authenticated;

-- Notify an attendee when someone shares an event with them.
create function public.notify_calendar_event_attendee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_by_name text;
begin
  if new.member_id = auth.uid() then
    return new;
  end if;
  select title into v_title from calendar_events where id = new.event_id;
  select display_name into v_by_name from profiles where id = auth.uid();
  perform public.notify(
    new.member_id,
    'update',
    coalesce(v_by_name, 'Someone') || ' shared "' || coalesce(v_title, 'an event') || '" with you'
  );
  return new;
end;
$$;

create trigger calendar_event_attendees_notify
  after insert on public.calendar_event_attendees
  for each row execute function public.notify_calendar_event_attendee();
