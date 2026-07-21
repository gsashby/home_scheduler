-- Proves calendar_event_attendees follows the same "owner or parent"
-- write rule as calendar_events itself (see "calendar_event_attendees:
-- write via event owner or parent" in
-- 20260720000007_calendar_event_details.sql), and that its
-- force_own_family_id trigger overrides a spoofed family_id on insert —
-- same shape as supabase/tests/database/direct_write_tables.sql and
-- family_isolation_tasks.sql.
begin;
select plan(4);

create or replace function pg_temp.authenticate_as(p_user_id uuid) returns void as $$
begin
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
end;
$$ language plpgsql;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('f6000000-0000-0000-0000-00000000000a', 'parent-a@test.local', '', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('f6000000-0000-0000-0000-00000000000b', 'kid-a1@test.local', '', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('f6000000-0000-0000-0000-00000000000c', 'kid-a2@test.local', '', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('f6000000-0000-0000-0000-00000000000d', 'parent-b@test.local', '', now(), '{}', '{}', 'authenticated', 'authenticated');

insert into public.families (id, name, invite_code, created_by) values
  ('fa600000-0000-0000-0000-00000000000a', 'Family A', 'ATEST-6001', 'f6000000-0000-0000-0000-00000000000a'),
  ('fb600000-0000-0000-0000-00000000000b', 'Family B', 'BTEST-6002', 'f6000000-0000-0000-0000-00000000000d');

update public.profiles set family_id = 'fa600000-0000-0000-0000-00000000000a', family_member_role = 'admin', role = 'parent', display_name = 'Parent A' where id = 'f6000000-0000-0000-0000-00000000000a';
update public.profiles set family_id = 'fa600000-0000-0000-0000-00000000000a', family_member_role = 'member', role = 'kid', display_name = 'Kid A1' where id = 'f6000000-0000-0000-0000-00000000000b';
update public.profiles set family_id = 'fa600000-0000-0000-0000-00000000000a', family_member_role = 'member', role = 'kid', display_name = 'Kid A2' where id = 'f6000000-0000-0000-0000-00000000000c';
update public.profiles set family_id = 'fb600000-0000-0000-0000-00000000000b', family_member_role = 'admin', role = 'parent', display_name = 'Parent B' where id = 'f6000000-0000-0000-0000-00000000000d';

-- Kid A1 owns an event in family A.
insert into public.calendar_events (id, member_id, title, date, start_time, end_time, created_by, family_id) values
  ('11600000-0000-0000-0000-00000000000a', 'f6000000-0000-0000-0000-00000000000b', 'Kid A1''s event', current_date, '10:00', '11:00', 'f6000000-0000-0000-0000-00000000000b', 'fa600000-0000-0000-0000-00000000000a');

-- Kid A2 (neither the event's owner nor a parent) cannot share it.
select pg_temp.authenticate_as('f6000000-0000-0000-0000-00000000000c');
select throws_ok(
  $$ insert into public.calendar_event_attendees (event_id, member_id, family_id) values ('11600000-0000-0000-0000-00000000000a', 'f6000000-0000-0000-0000-00000000000c', 'fa600000-0000-0000-0000-00000000000a') $$
);
reset role;

-- The event's owner (Kid A1) can share it with a sibling.
select pg_temp.authenticate_as('f6000000-0000-0000-0000-00000000000b');
insert into public.calendar_event_attendees (event_id, member_id, family_id)
values ('11600000-0000-0000-0000-00000000000a', 'f6000000-0000-0000-0000-00000000000c', 'fb600000-0000-0000-0000-00000000000b');
reset role;

select is(
  (select family_id from public.calendar_event_attendees where event_id = '11600000-0000-0000-0000-00000000000a' and member_id = 'f6000000-0000-0000-0000-00000000000c'),
  'fa600000-0000-0000-0000-00000000000a'::uuid,
  'calendar_event_attendees force_own_family_id trigger overrides a spoofed family_id on insert'
);

-- A parent (not the owner) can also share the event, e.g. with themself.
select pg_temp.authenticate_as('f6000000-0000-0000-0000-00000000000a');
insert into public.calendar_event_attendees (event_id, member_id, family_id)
values ('11600000-0000-0000-0000-00000000000a', 'f6000000-0000-0000-0000-00000000000a', 'fa600000-0000-0000-0000-00000000000a');
reset role;

select is(
  (select count(*)::int from public.calendar_event_attendees where event_id = '11600000-0000-0000-0000-00000000000a'),
  2,
  'a parent can also add an attendee to a kid''s event'
);

-- Family B's parent can't see or write attendees on family A's event: the
-- write policy's exists() subquery runs under calendar_events' own
-- family-scoped select RLS, so it can't find family A's event at all.
select pg_temp.authenticate_as('f6000000-0000-0000-0000-00000000000d');
select throws_ok(
  $$ insert into public.calendar_event_attendees (event_id, member_id, family_id) values ('11600000-0000-0000-0000-00000000000a', 'f6000000-0000-0000-0000-00000000000d', 'fb600000-0000-0000-0000-00000000000b') $$
);
reset role;

select * from finish();
rollback;
