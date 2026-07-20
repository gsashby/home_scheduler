-- Phase 4: real Web Push delivery + scheduled jobs (pg_cron/pg_net).
--
-- Session timezone: none of the schema's date/time logic (current_date,
-- localtime, task deadlines, zone rotation math) carries a per-user
-- timezone — it was written assuming the database's own timezone IS the
-- family's local time. Set both the database default and pg_cron's own
-- schedule-string timezone so "7am" means 7am Mountain Time (DST-aware),
-- not 7am UTC.
alter database postgres set timezone to 'America/Denver';
alter database postgres set "cron.timezone" to 'America/Denver';

create extension if not exists pg_cron;
create extension if not exists pg_net;
-- supabase_vault and pgcrypto ship pre-installed on Supabase projects.

-- ---------------------------------------------------------------------------
-- Daily brief notifications had no dedupe_key, so re-running
-- cron_send_daily_brief() (a delayed tick, a manual re-run, etc) would send
-- a second "Good morning" push the same day. notify() already supports
-- dedupe_key (deadline alerts use it) — reuse that instead of depending on
-- the cron job firing exactly once per day.
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
  for m in select id, display_name from profiles loop
    perform public.notify(
      m.id, 'brief',
      'Good morning ' || m.display_name || '! Today: ' || public.brief_line_for(m.id),
      'brief:' || m.id || ':' || current_date
    );
  end loop;
end;
$$;
revoke all on function public.cron_send_daily_brief() from public;

-- ---------------------------------------------------------------------------
-- The send-push Edge Function uses @supabase/server's `auth: 'secret'` mode,
-- which validates the project's real secret API key (sb_secret_...) sent in
-- the `apikey` header — see @supabase/server's "Calling from database with
-- pg_net" recipe. Stored in Vault so the key never appears in a query or a
-- git-committed file. Created here with a placeholder; the real key is set
-- once, out of band, via vault.update_secret() (see README).
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'supabase_secret_key') then
    perform vault.create_secret(
      'REPLACE_ME',
      'supabase_secret_key',
      'Project secret API key (sb_secret_...), used by the notifications trigger to call send-push'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Fire-and-forget HTTP call to the send-push Edge Function whenever a
-- notification row is created. The function itself looks up
-- push_subscriptions and does the actual Web Push send; this trigger just
-- wakes it up. net.http_post is async (queues the request and returns
-- immediately) so a slow/failed function call never blocks the insert that
-- triggered it — push is a best-effort delivery channel, not a guaranteed
-- queue, and the notifications row (read by the in-app bell) is already
-- durable regardless of whether the push itself succeeds.
create function public.trigger_send_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'supabase_secret_key';
  perform net.http_post(
    url := 'https://myzejnyxkzyxebaxyzko.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', v_secret),
    body := jsonb_build_object(
      'notification_id', NEW.id,
      'to_profile_id', NEW.to_profile_id,
      'kind', NEW.kind,
      'text', NEW.text
    )
  );
  return NEW;
end;
$$;

create trigger notifications_send_push
  after insert on public.notifications
  for each row execute function public.trigger_send_push();

-- ---------------------------------------------------------------------------
-- Scheduled jobs. cron.schedule errors if a job with that name already
-- exists, so unschedule first — keeps this migration safe to re-run
-- (supabase db reset locally, or a repaired/re-applied push).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'daily-brief') then
    perform cron.unschedule('daily-brief');
  end if;
  if exists (select 1 from cron.job where jobname = 'deadline-alerts') then
    perform cron.unschedule('deadline-alerts');
  end if;
end $$;

-- 7am Mountain Time daily brief (also rolls zone chore tasks for the day).
select cron.schedule('daily-brief', '0 7 * * *', $$select public.cron_send_daily_brief()$$);

-- Deadline alerts checked every 5 minutes; cron_generate_deadline_alerts()
-- dedupes per-task via notify()'s dedupe_key, so frequent polling is safe.
select cron.schedule('deadline-alerts', '*/5 * * * *', $$select public.cron_generate_deadline_alerts()$$);
