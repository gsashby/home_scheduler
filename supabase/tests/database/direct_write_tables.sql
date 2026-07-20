-- Proves the two client-writable tables (calendar_events,
-- push_subscriptions) force their real family_id server-side via the
-- force_own_family_id trigger, even if the client's insert payload spoofs
-- a different family's id.
begin;
select plan(2);

create or replace function pg_temp.authenticate_as(p_user_id uuid) returns void as $$
begin
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
end;
$$ language plpgsql;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('f4000000-0000-0000-0000-00000000000a', 'a@test.local', '', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('f4000000-0000-0000-0000-00000000000b', 'b@test.local', '', now(), '{}', '{}', 'authenticated', 'authenticated');

insert into public.families (id, name, invite_code, created_by) values
  ('fa400000-0000-0000-0000-00000000000a', 'Family A', 'ATEST-4001', 'f4000000-0000-0000-0000-00000000000a'),
  ('fb400000-0000-0000-0000-00000000000b', 'Family B', 'BTEST-4002', 'f4000000-0000-0000-0000-00000000000b');

update public.profiles set family_id = 'fa400000-0000-0000-0000-00000000000a', family_member_role = 'admin', role = 'parent', display_name = 'A' where id = 'f4000000-0000-0000-0000-00000000000a';
update public.profiles set family_id = 'fb400000-0000-0000-0000-00000000000b', family_member_role = 'admin', role = 'parent', display_name = 'B' where id = 'f4000000-0000-0000-0000-00000000000b';

select pg_temp.authenticate_as('f4000000-0000-0000-0000-00000000000a');

insert into public.calendar_events (member_id, title, date, start_time, end_time, created_by, family_id)
values ('f4000000-0000-0000-0000-00000000000a', 'Spoofed event', current_date, '10:00', '11:00', 'f4000000-0000-0000-0000-00000000000a', 'fb400000-0000-0000-0000-00000000000b');

insert into public.push_subscriptions (profile_id, endpoint, p256dh, auth, family_id)
values ('f4000000-0000-0000-0000-00000000000a', 'https://example.com/spoofed', 'p256dh-value', 'auth-value', 'fb400000-0000-0000-0000-00000000000b');

reset role;

select is(
  (select family_id from public.calendar_events where title = 'Spoofed event'),
  'fa400000-0000-0000-0000-00000000000a'::uuid,
  'calendar_events force_own_family_id trigger overrides a spoofed family_id on insert'
);

select is(
  (select family_id from public.push_subscriptions where endpoint = 'https://example.com/spoofed'),
  'fa400000-0000-0000-0000-00000000000a'::uuid,
  'push_subscriptions force_own_family_id trigger overrides a spoofed family_id on insert'
);

select * from finish();
rollback;
