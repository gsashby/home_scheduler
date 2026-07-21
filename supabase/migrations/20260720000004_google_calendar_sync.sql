-- Google Calendar two-way sync: lets each family member connect their own
-- Google account, choose which of their Google calendars to import, and
-- keep events flowing both directions (Google -> app via a poll/import,
-- app -> Google via an outbox a scheduled Edge Function drains). See
-- src/app/(app)/settings/page.tsx's existing "Google Calendar sync" card
-- and calendar_events.source/google_calendar_id/google_event_id, which
-- already anticipated this.
--
-- google_tokens previously held a single calendar_id/sync_token/watch_*
-- set per profile — that only worked for one calendar per person. Those
-- move to the new google_calendar_subscriptions table (one row per
-- selected calendar), leaving google_tokens as just the OAuth credential.

-- ---------------------------------------------------------------------------
-- google_tokens: repurpose as OAuth-credential-only.
-- ---------------------------------------------------------------------------
alter table public.google_tokens drop column calendar_id;
alter table public.google_tokens drop column sync_token;
alter table public.google_tokens drop column watch_channel_id;
alter table public.google_tokens drop column watch_resource_id;
alter table public.google_tokens drop column watch_expiration;
alter table public.google_tokens add column scope text;

-- ---------------------------------------------------------------------------
-- google_calendar_subscriptions — one row per Google calendar a member has
-- chosen to import. Server-only, same posture as google_tokens: zero RLS
-- policies, zero grants to authenticated/anon — only the service role
-- (Edge Functions) reads/writes this.
-- ---------------------------------------------------------------------------
create table public.google_calendar_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  family_id uuid not null references public.families (id),
  google_calendar_id text not null,
  calendar_name text not null,
  enabled boolean not null default true,
  -- Which one calendar app-created events get pushed to. At most one per
  -- profile — enforced by the partial unique index below.
  is_export_target boolean not null default false,
  sync_token text, -- Google's incremental-sync cursor for this calendar
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index google_calendar_subscriptions_profile_calendar_idx
  on public.google_calendar_subscriptions (profile_id, google_calendar_id);
create unique index google_calendar_subscriptions_one_export_target_idx
  on public.google_calendar_subscriptions (profile_id) where is_export_target;
create index google_calendar_subscriptions_family_id_idx
  on public.google_calendar_subscriptions (family_id);

create trigger google_calendar_subscriptions_set_updated_at
  before update on public.google_calendar_subscriptions
  for each row execute function public.set_updated_at();

alter table public.google_calendar_subscriptions enable row level security;
-- No policies: server-only, mirrors google_tokens.

-- ---------------------------------------------------------------------------
-- google_calendar_outbox — app -> Google export queue. A trigger on
-- calendar_events (below) enqueues a row whenever an app-created event
-- needs pushing to Google, or a Google-linked event is edited/deleted in
-- the app. The google-calendar-sync Edge Function drains status='pending'
-- rows on its cron schedule. Denormalizes title/date/start_time/end_time
-- so a 'delete' row is still fully self-describing after the source
-- calendar_events row is gone; calendar_event_id has no FK constraint for
-- the same reason (an AFTER DELETE trigger inserts a row referencing an id
-- that no longer exists in the same transaction).
-- ---------------------------------------------------------------------------
create type public.google_outbox_operation as enum ('create', 'update', 'delete');
create type public.google_outbox_status as enum ('pending', 'done', 'error');

create table public.google_calendar_outbox (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  calendar_event_id uuid,
  google_calendar_id text not null,
  google_event_id text,
  operation public.google_outbox_operation not null,
  title text not null,
  date date not null,
  start_time time not null,
  end_time time not null,
  status public.google_outbox_status not null default 'pending',
  error_message text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index google_calendar_outbox_pending_idx
  on public.google_calendar_outbox (profile_id) where status = 'pending';
create index google_calendar_outbox_family_id_idx
  on public.google_calendar_outbox (family_id);

alter table public.google_calendar_outbox enable row level security;
-- No policies: server-only, mirrors google_tokens.

-- ---------------------------------------------------------------------------
-- Trigger: enqueue outbox rows for two-way sync. Loop prevention: the
-- google-calendar-sync Edge Function sets app.sync_in_progress = true
-- (via a service-role query) before any write it makes while importing
-- from Google or writing back a newly-created google_event_id, so pulling
-- an event from Google doesn't immediately re-queue it for export.
-- ---------------------------------------------------------------------------
create function public.enqueue_google_outbox()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_id uuid;
  v_sync_enabled boolean;
  v_export_calendar_id text;
begin
  if coalesce(current_setting('app.sync_in_progress', true), '') = 'true' then
    return coalesce(new, old);
  end if;

  v_member_id := case when tg_op = 'DELETE' then old.member_id else new.member_id end;
  select google_sync_enabled into v_sync_enabled from profiles where id = v_member_id;
  if not coalesce(v_sync_enabled, false) then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    if new.source <> 'app' then
      return new; -- rows inserted with source='google' come from the sync function itself
    end if;

    select google_calendar_id into v_export_calendar_id
    from google_calendar_subscriptions
    where profile_id = new.member_id and is_export_target and enabled;
    if v_export_calendar_id is null then
      return new; -- no export target configured for this member
    end if;

    insert into google_calendar_outbox
      (family_id, profile_id, calendar_event_id, google_calendar_id, operation, title, date, start_time, end_time)
    values
      (new.family_id, new.member_id, new.id, v_export_calendar_id, 'create', new.title, new.date, new.start_time, new.end_time);
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.google_event_id is null then
      return new; -- never linked to Google, nothing to push
    end if;

    -- A newer edit supersedes any not-yet-processed update for this event.
    update google_calendar_outbox
      set status = 'done', error_message = 'superseded by newer edit', processed_at = now()
      where calendar_event_id = new.id and status = 'pending' and operation = 'update';

    insert into google_calendar_outbox
      (family_id, profile_id, calendar_event_id, google_calendar_id, google_event_id, operation, title, date, start_time, end_time)
    values
      (new.family_id, new.member_id, new.id, new.google_calendar_id, new.google_event_id, 'update', new.title, new.date, new.start_time, new.end_time);
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.google_event_id is null then
      -- Never linked to Google — but a pending 'create' might still exist
      -- for it (created and deleted before the sync function ran); drop it
      -- so nothing tries to create an event for a row that's gone.
      update google_calendar_outbox
        set status = 'done', error_message = 'event deleted before export', processed_at = now()
        where calendar_event_id = old.id and status = 'pending';
      return old;
    end if;

    update google_calendar_outbox
      set status = 'done', error_message = 'superseded by delete', processed_at = now()
      where calendar_event_id = old.id and status = 'pending' and operation in ('create', 'update');

    insert into google_calendar_outbox
      (family_id, profile_id, calendar_event_id, google_calendar_id, google_event_id, operation, title, date, start_time, end_time)
    values
      (old.family_id, old.member_id, old.id, old.google_calendar_id, old.google_event_id, 'delete', old.title, old.date, old.start_time, old.end_time);
    return old;
  end if;

  return coalesce(new, old);
end;
$$;

create trigger calendar_events_enqueue_google_outbox
  after insert or update or delete on public.calendar_events
  for each row execute function public.enqueue_google_outbox();
