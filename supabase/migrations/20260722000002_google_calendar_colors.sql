-- Color-codes synced events by which Google calendar they came from,
-- instead of only by member. Color is pulled straight from Google's own
-- calendarList backgroundColor for that calendar (google-calendar-sync,
-- google-calendar-list) rather than a manual picker, so it matches what
-- the calendar already looks like in Google Calendar.

alter table public.google_calendar_subscriptions add column color text;
alter table public.calendar_events add column color text;

-- sync_upsert_imported_event gains p_color; signature change requires
-- dropping the old one first (see 20260720000005_google_calendar_sync_rpcs.sql
-- for why this has to be a single PL/pgSQL function rather than plain writes).
drop function if exists public.sync_upsert_imported_event(uuid, uuid, text, text, text, date, time, time);

create function public.sync_upsert_imported_event(
  p_family_id uuid,
  p_member_id uuid,
  p_google_calendar_id text,
  p_google_event_id text,
  p_title text,
  p_date date,
  p_start_time time,
  p_end_time time,
  p_color text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform set_config('app.sync_in_progress', 'true', true);

  insert into calendar_events
    (family_id, member_id, title, date, start_time, end_time, source, google_calendar_id, google_event_id, created_by, color)
  values
    (p_family_id, p_member_id, p_title, p_date, p_start_time, p_end_time, 'google', p_google_calendar_id, p_google_event_id, p_member_id, p_color)
  on conflict (google_calendar_id, google_event_id) where google_event_id is not null
  do update set
    title = excluded.title,
    date = excluded.date,
    start_time = excluded.start_time,
    end_time = excluded.end_time,
    member_id = excluded.member_id,
    color = excluded.color
  returning id into v_id;

  return v_id;
end;
$$;
revoke all on function public.sync_upsert_imported_event(uuid, uuid, text, text, text, date, time, time, text) from public;
grant execute on function public.sync_upsert_imported_event(uuid, uuid, text, text, text, date, time, time, text) to service_role;
