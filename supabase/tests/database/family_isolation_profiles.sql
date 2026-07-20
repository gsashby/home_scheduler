-- Proves Family A cannot read Family B's profiles rows via RLS, and can
-- read their own family's. Self-contained: builds its own two-family
-- fixture, rolled back at the end.
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
  ('f0000000-0000-0000-0000-00000000000a', 'a@test.local', '', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('f0000000-0000-0000-0000-00000000000b', 'b@test.local', '', now(), '{}', '{}', 'authenticated', 'authenticated');

insert into public.families (id, name, invite_code, created_by) values
  ('fa000000-0000-0000-0000-00000000000a', 'Family A', 'ATEST-0001', 'f0000000-0000-0000-0000-00000000000a'),
  ('fb000000-0000-0000-0000-00000000000b', 'Family B', 'BTEST-0002', 'f0000000-0000-0000-0000-00000000000b');

update public.profiles set family_id = 'fa000000-0000-0000-0000-00000000000a', family_member_role = 'admin', role = 'parent', display_name = 'A' where id = 'f0000000-0000-0000-0000-00000000000a';
update public.profiles set family_id = 'fb000000-0000-0000-0000-00000000000b', family_member_role = 'admin', role = 'parent', display_name = 'B' where id = 'f0000000-0000-0000-0000-00000000000b';

select pg_temp.authenticate_as('f0000000-0000-0000-0000-00000000000a');

select is(
  (select count(*)::int from public.profiles where id = 'f0000000-0000-0000-0000-00000000000a'),
  1,
  'A can select their own profile row'
);

select is(
  (select count(*)::int from public.profiles where id = 'f0000000-0000-0000-0000-00000000000b'),
  0,
  'A cannot select B''s profile row'
);

select is(
  (select count(*)::int from public.profiles where family_id = 'fa000000-0000-0000-0000-00000000000a'),
  1,
  'A sees their own family''s profiles'
);

select is(
  (select count(*)::int from public.profiles where family_id = 'fb000000-0000-0000-0000-00000000000b'),
  0,
  'A sees none of B''s family''s profiles'
);

select * from finish();
rollback;
