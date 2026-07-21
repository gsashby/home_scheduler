-- RPCs the google-calendar-sync Edge Function uses to write to
-- calendar_events. These can't be plain service-role table writes: the
-- enqueue_google_outbox() loop-prevention flag
-- (set_config('app.sync_in_progress', 'true', true)) is transaction-local,
-- and each separate PostgREST/Edge Function call is its own transaction —
-- so "set the flag" and "do the write" only land in the same transaction
-- if they're both inside one PL/pgSQL function body. service_role calls
-- these directly; they're otherwise revoked from public/authenticated,
-- same posture as the cron_* functions.

create function public.sync_upsert_imported_event(
  p_family_id uuid,
  p_member_id uuid,
  p_google_calendar_id text,
  p_google_event_id text,
  p_title text,
  p_date date,
  p_start_time time,
  p_end_time time
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
    (family_id, member_id, title, date, start_time, end_time, source, google_calendar_id, google_event_id, created_by)
  values
    (p_family_id, p_member_id, p_title, p_date, p_start_time, p_end_time, 'google', p_google_calendar_id, p_google_event_id, p_member_id)
  on conflict (google_calendar_id, google_event_id) where google_event_id is not null
  do update set
    title = excluded.title,
    date = excluded.date,
    start_time = excluded.start_time,
    end_time = excluded.end_time,
    member_id = excluded.member_id
  returning id into v_id;

  return v_id;
end;
$$;
revoke all on function public.sync_upsert_imported_event(uuid, uuid, text, text, text, date, time, time) from public;
grant execute on function public.sync_upsert_imported_event(uuid, uuid, text, text, text, date, time, time) to service_role;

create function public.sync_delete_imported_event(p_google_calendar_id text, p_google_event_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.sync_in_progress', 'true', true);
  delete from calendar_events
    where google_calendar_id = p_google_calendar_id and google_event_id = p_google_event_id;
end;
$$;
revoke all on function public.sync_delete_imported_event(text, text) from public;
grant execute on function public.sync_delete_imported_event(text, text) to service_role;

-- Writes back the google_event_id/google_calendar_id after an app-created
-- event has been successfully pushed to Google for the first time (outbox
-- 'create' operation).
create function public.sync_link_calendar_event(
  p_calendar_event_id uuid,
  p_google_calendar_id text,
  p_google_event_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.sync_in_progress', 'true', true);
  update calendar_events
    set google_calendar_id = p_google_calendar_id, google_event_id = p_google_event_id
    where id = p_calendar_event_id;
end;
$$;
revoke all on function public.sync_link_calendar_event(uuid, text, text) from public;
grant execute on function public.sync_link_calendar_event(uuid, text, text) to service_role;
