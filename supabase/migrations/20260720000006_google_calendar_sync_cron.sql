-- Schedules the google-calendar-sync Edge Function, same net.http_post +
-- Vault-secret pattern as notifications_send_push (see
-- supabase/migrations/20260719120000_web_push_cron.sql), but on a
-- cron.schedule timer instead of a table-insert trigger, since a sync pass
-- has no single triggering row — it drains whatever's pending across every
-- connected calendar each time it runs.
create function public.cron_trigger_google_calendar_sync()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'supabase_secret_key';
  perform net.http_post(
    url := 'https://myzejnyxkzyxebaxyzko.supabase.co/functions/v1/google-calendar-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', v_secret),
    body := '{}'::jsonb
  );
end;
$$;
revoke all on function public.cron_trigger_google_calendar_sync() from public;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'google-calendar-sync') then
    perform cron.unschedule('google-calendar-sync');
  end if;
end $$;

-- Every 10 minutes — frequent enough that "connect Google Calendar" feels
-- responsive without hammering the Calendar API; each subscription's own
-- incremental sync_token keeps a no-op run cheap.
select cron.schedule('google-calendar-sync', '*/10 * * * *', $$select public.cron_trigger_google_calendar_sync()$$);
