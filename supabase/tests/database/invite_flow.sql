-- Proves create_family() atomically sets up family+zone_rotation+admin,
-- and join_family_by_code() rejects invalid codes and joins as
-- kid/member by default on success.
begin;
select plan(8);

create or replace function pg_temp.authenticate_as(p_user_id uuid) returns void as $$
begin
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
end;
$$ language plpgsql;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('f3000000-0000-0000-0000-00000000000a', 'admin@test.local', '', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('f3000000-0000-0000-0000-00000000000c', 'joiner@test.local', '', now(), '{}', '{}', 'authenticated', 'authenticated');

select pg_temp.authenticate_as('f3000000-0000-0000-0000-00000000000a');

select lives_ok(
  $$ select public.create_family('Test Family') $$,
  'create_family() succeeds for a fresh signup with no family yet'
);

reset role;

select is(
  (select family_member_role::text from public.profiles where id = 'f3000000-0000-0000-0000-00000000000a'),
  'admin',
  'family creator becomes admin'
);

select is(
  (select role::text from public.profiles where id = 'f3000000-0000-0000-0000-00000000000a'),
  'parent',
  'family creator becomes a parent'
);

select ok(
  exists (
    select 1 from public.zone_rotation
    where family_id = (select family_id from public.profiles where id = 'f3000000-0000-0000-0000-00000000000a')
  ),
  'create_family() also creates the zone_rotation row for the new family'
);

-- Captured here (still superuser / pre-RLS context) because the joiner's
-- own RLS view of `families` can't see this row until after they've
-- joined — fetching it inline after switching to the joiner's session
-- would silently resolve to NULL instead of erroring.
select invite_code from public.families where created_by = 'f3000000-0000-0000-0000-00000000000a' \gset

select pg_temp.authenticate_as('f3000000-0000-0000-0000-00000000000c');

-- 1-arg throws_ok: assert it raises at all (3-arg throws_ok(sql, text,
-- text) matches against the caught message, not what this needs).
select throws_ok($$ select public.join_family_by_code('NOPE-0000') $$);

select lives_ok(
  format($$ select public.join_family_by_code(%L) $$, :'invite_code'),
  'join_family_by_code() succeeds with the real code'
);

reset role;

select is(
  (select family_member_role::text from public.profiles where id = 'f3000000-0000-0000-0000-00000000000c'),
  'member',
  'code-joiner defaults to family_member_role = member'
);

select is(
  (select role::text from public.profiles where id = 'f3000000-0000-0000-0000-00000000000c'),
  'kid',
  'code-joiner defaults to domain role = kid (least-privileged, per product decision)'
);

select * from finish();
rollback;
