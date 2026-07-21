-- Fixes two real bugs in the daily brief, found during a production-
-- readiness review:
--
-- 1. cron.timezone was never actually set (see the comment near the top
--    of 20260719120000_web_push_cron.sql -- it's a restart-only
--    parameter on this Supabase tier and the ALTER fails), so
--    cron.schedule('daily-brief', '0 7 * * *', ...) has been running at
--    7am UTC the whole time, not 7am Mountain -- roughly midnight to 1am
--    local depending on DST. Fixed here by running the job every 15
--    minutes (still in UTC, unavoidably) and guarding inside the
--    function on the database's own `timezone` GUC instead, which *is*
--    correctly America/Denver (an IANA zone, so DST-correct
--    automatically) -- see cron_send_daily_brief() below.
--
-- 2. 20260720000001_multi_tenant_families.sql's `create or replace` of
--    cron_send_daily_brief() (needed to loop every family instead of one
--    hardcoded household) silently dropped the per-day dedupe_key that
--    20260719120000_web_push_cron.sql had added to prevent duplicate
--    "Good morning" notifications from a delayed tick or manual re-run.
--    Harmless while the job only fired once a day (at the wrong time),
--    but would send one duplicate push per 15-minute tick within the
--    7am hour once fix #1 above lands. Restored here.

create or replace function public.cron_send_daily_brief()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
begin
  if extract(hour from now()) <> 7 then
    return;
  end if;

  perform public.cron_ensure_zone_tasks();
  for m in select id, display_name from profiles where family_id is not null loop
    perform public.notify(
      m.id, 'brief',
      'Good morning ' || m.display_name || '! Today: ' || public.brief_line_for(m.id),
      'brief:' || m.id || ':' || current_date
    );
  end loop;
end;
$$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'daily-brief') then
    perform cron.unschedule('daily-brief');
  end if;
end $$;

select cron.schedule('daily-brief', '*/15 * * * *', $$select public.cron_send_daily_brief()$$);
