-- Proves calling verify_task()/mark_task_done() on another family's task id
-- raises an authorization error, not a silent no-op or empty result.
begin;
select plan(3);

create or replace function pg_temp.authenticate_as(p_user_id uuid) returns void as $$
begin
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
end;
$$ language plpgsql;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('f1000000-0000-0000-0000-00000000000a', 'a@test.local', '', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('f1000000-0000-0000-0000-00000000000b', 'b@test.local', '', now(), '{}', '{}', 'authenticated', 'authenticated');

insert into public.families (id, name, invite_code, created_by) values
  ('fa100000-0000-0000-0000-00000000000a', 'Family A', 'ATEST-1001', 'f1000000-0000-0000-0000-00000000000a'),
  ('fb100000-0000-0000-0000-00000000000b', 'Family B', 'BTEST-1002', 'f1000000-0000-0000-0000-00000000000b');

update public.profiles set family_id = 'fa100000-0000-0000-0000-00000000000a', family_member_role = 'admin', role = 'parent', display_name = 'A' where id = 'f1000000-0000-0000-0000-00000000000a';
update public.profiles set family_id = 'fb100000-0000-0000-0000-00000000000b', family_member_role = 'admin', role = 'parent', display_name = 'B' where id = 'f1000000-0000-0000-0000-00000000000b';

-- B has a task in their own family.
insert into public.tasks (id, title, member_id, category, date, status, created_by, family_id) values
  ('11100000-0000-0000-0000-00000000000b', 'B''s task', 'f1000000-0000-0000-0000-00000000000b', 'home', current_date, 'assigned', 'f1000000-0000-0000-0000-00000000000b', 'fb100000-0000-0000-0000-00000000000b');

select pg_temp.authenticate_as('f1000000-0000-0000-0000-00000000000a');

select is(
  (select count(*)::int from public.tasks where id = '11100000-0000-0000-0000-00000000000b'),
  0,
  'A cannot select B''s task via RLS'
);

-- 1-arg throws_ok: assert it raises at all, without pinning to a specific
-- message (A is a parent, so this is the family check firing, not the
-- role check — 3-arg throws_ok(sql, text, text) matches against the
-- caught message, which isn't what these need to assert).
select throws_ok($$ select public.verify_task('11100000-0000-0000-0000-00000000000b') $$);
select throws_ok($$ select public.mark_task_done('11100000-0000-0000-0000-00000000000b') $$);

select * from finish();
rollback;
