-- Proves google_calendar_subscriptions and google_calendar_outbox are
-- server-only, same posture as google_tokens: zero grants to
-- authenticated, so even a signed-in family member gets a hard permission
-- error rather than an empty (RLS-filtered) result set.
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
values ('f5000000-0000-0000-0000-00000000000a', 'a@test.local', '', now(), '{}', '{}', 'authenticated', 'authenticated');

insert into public.families (id, name, invite_code, created_by) values
  ('fa500000-0000-0000-0000-00000000000a', 'Family A', 'ATEST-5001', 'f5000000-0000-0000-0000-00000000000a');

update public.profiles set family_id = 'fa500000-0000-0000-0000-00000000000a', family_member_role = 'admin', role = 'parent', display_name = 'A' where id = 'f5000000-0000-0000-0000-00000000000a';

select pg_temp.authenticate_as('f5000000-0000-0000-0000-00000000000a');

-- 1-arg throws_ok: assert a hard permission error, without pinning to
-- Postgres's exact "permission denied for table ..." wording.
select throws_ok($$ select count(*) from public.google_calendar_subscriptions $$);
select throws_ok($$ select count(*) from public.google_calendar_outbox $$);

select * from finish();
rollback;
