-- Proves rotate_now() only ever touches the caller's own family's
-- zone_rotation row, never another family's.
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
  ('f2000000-0000-0000-0000-00000000000a', 'a@test.local', '', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('f2000000-0000-0000-0000-00000000000b', 'b@test.local', '', now(), '{}', '{}', 'authenticated', 'authenticated');

insert into public.families (id, name, invite_code, created_by) values
  ('fa200000-0000-0000-0000-00000000000a', 'Family A', 'ATEST-2001', 'f2000000-0000-0000-0000-00000000000a'),
  ('fb200000-0000-0000-0000-00000000000b', 'Family B', 'BTEST-2002', 'f2000000-0000-0000-0000-00000000000b');

update public.profiles set family_id = 'fa200000-0000-0000-0000-00000000000a', family_member_role = 'admin', role = 'parent', display_name = 'A' where id = 'f2000000-0000-0000-0000-00000000000a';
update public.profiles set family_id = 'fb200000-0000-0000-0000-00000000000b', family_member_role = 'admin', role = 'parent', display_name = 'B' where id = 'f2000000-0000-0000-0000-00000000000b';

insert into public.zone_rotation (family_id, start_date, interval_days, offset_cycles, member_order) values
  ('fa200000-0000-0000-0000-00000000000a', current_date, 7, 0, array['f2000000-0000-0000-0000-00000000000a'::uuid]),
  ('fb200000-0000-0000-0000-00000000000b', current_date, 7, 0, array['f2000000-0000-0000-0000-00000000000b'::uuid]);

select pg_temp.authenticate_as('f2000000-0000-0000-0000-00000000000a');
select public.rotate_now();

-- Verify ground truth for both families as the superuser test role — A's
-- own RLS view can't see B's row at all, so checking "B stayed at 0" needs
-- an unfiltered read.
reset role;

select is(
  (select offset_cycles from public.zone_rotation where family_id = 'fa200000-0000-0000-0000-00000000000a'),
  1,
  'rotate_now() advances A''s own zone_rotation'
);

select is(
  (select offset_cycles from public.zone_rotation where family_id = 'fb200000-0000-0000-0000-00000000000b'),
  0,
  'rotate_now() leaves B''s zone_rotation untouched'
);

select * from finish();
rollback;
