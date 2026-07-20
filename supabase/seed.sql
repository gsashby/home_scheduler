-- Local dev only. Runs automatically on `supabase db reset` / `supabase start`.
-- Seeds two fully separate families so local development exercises
-- multi-tenant isolation, not just a single household:
--   - "The Petersons" (5 people) mirrors the approved prototype's original
--     seed data exactly (home-scheduler-prototype.html `seed()`).
--   - A second, minimal family proves that a second tenant's data never
--     appears alongside the first's.
-- Never run this against the real production project — see README
-- "First-run family setup" for the real bootstrap procedure instead.
--
-- Inserting into auth.users fires the on_auth_user_created trigger
-- (handle_new_user(), see 20260720000001_multi_tenant_families.sql), which
-- creates a placeholder profiles row per user with family_id = null. The
-- updates below overwrite those placeholders with this seed's real shape
-- once the families they belong to exist.

insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('11111111-1111-1111-1111-111111111111', 'dad@example.com', '', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('22222222-2222-2222-2222-222222222222', 'mom@example.com', '', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('33333333-3333-3333-3333-333333333333', 'sara@example.com', '', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('44444444-4444-4444-4444-444444444444', 'david@example.com', '', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('55555555-5555-5555-5555-555555555555', 'jj@example.com', '', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('66666666-6666-6666-6666-666666666666', 'alex@example.com', '', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('77777777-7777-7777-7777-777777777777', 'riley@example.com', '', now(), '{}', '{}', 'authenticated', 'authenticated');

insert into public.families (id, name, invite_code, created_by) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'The Petersons', 'MAPLE-1234', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'The Second Family', 'CEDAR-5678', '66666666-6666-6666-6666-666666666666');

update public.profiles set display_name = 'Dad', role = 'parent', color = '#111827', family_id = 'aaaaaaaa-0000-0000-0000-000000000001', family_member_role = 'admin' where id = '11111111-1111-1111-1111-111111111111';
update public.profiles set display_name = 'Mom', role = 'parent', color = '#d4a900', family_id = 'aaaaaaaa-0000-0000-0000-000000000001', family_member_role = 'member' where id = '22222222-2222-2222-2222-222222222222';
update public.profiles set display_name = 'Sara', role = 'kid', color = '#ec4899', family_id = 'aaaaaaaa-0000-0000-0000-000000000001', family_member_role = 'member' where id = '33333333-3333-3333-3333-333333333333';
update public.profiles set display_name = 'David', role = 'kid', color = '#3b82f6', family_id = 'aaaaaaaa-0000-0000-0000-000000000001', family_member_role = 'member' where id = '44444444-4444-4444-4444-444444444444';
update public.profiles set display_name = 'JJ', role = 'kid', color = '#22c55e', family_id = 'aaaaaaaa-0000-0000-0000-000000000001', family_member_role = 'member' where id = '55555555-5555-5555-5555-555555555555';

-- Second family — its data must never appear alongside the Petersons'.
update public.profiles set display_name = 'Alex', role = 'parent', color = '#8b5cf6', family_id = 'bbbbbbbb-0000-0000-0000-000000000002', family_member_role = 'admin' where id = '66666666-6666-6666-6666-666666666666';
update public.profiles set display_name = 'Riley', role = 'kid', color = '#f97316', family_id = 'bbbbbbbb-0000-0000-0000-000000000002', family_member_role = 'member' where id = '77777777-7777-7777-7777-777777777777';

insert into public.subjects (name, position, family_id) values
  ('Math', 0, 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('Reading', 1, 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('Science', 2, 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('Other', 3, 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('Math', 0, 'bbbbbbbb-0000-0000-0000-000000000002');

insert into public.zone_rotation (family_id, start_date, interval_days, offset_cycles, member_order) values
  ('aaaaaaaa-0000-0000-0000-000000000001', date_trunc('week', current_date)::date, 7, 0, array[
    '33333333-3333-3333-3333-333333333333'::uuid, -- Sara
    '44444444-4444-4444-4444-444444444444'::uuid, -- David
    '55555555-5555-5555-5555-555555555555'::uuid  -- JJ
  ]),
  ('bbbbbbbb-0000-0000-0000-000000000002', date_trunc('week', current_date)::date, 7, 0, array[
    '77777777-7777-7777-7777-777777777777'::uuid -- Riley
  ]);

insert into public.zones (name, subzones, family_id) values
  ('Kitchen', array['Dishes & counters','Sweep + mop floor','Take out trash'], 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('Bathrooms', array['Sinks & mirrors','Toilets','Empty trash'], 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('Living room + hallway', array['Vacuum','Dust shelves','Tidy shoes & coats'], 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('Garage', array['Sweep floor','Organize bins'], 'bbbbbbbb-0000-0000-0000-000000000002');

insert into public.calendar_events (member_id, title, date, start_time, end_time, source, created_by, family_id) values
  ('22222222-2222-2222-2222-222222222222', 'Dentist — Sara & JJ', current_date, '14:00', '15:00', 'google', '22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('44444444-4444-4444-4444-444444444444', 'Welding program', current_date, '09:00', '12:00', 'app', '44444444-4444-4444-4444-444444444444', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('44444444-4444-4444-4444-444444444444', 'Welding program', current_date + 2, '09:00', '12:00', 'app', '44444444-4444-4444-4444-444444444444', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('44444444-4444-4444-4444-444444444444', 'Work shift — Hardware store', current_date + 1, '16:00', '20:00', 'app', '44444444-4444-4444-4444-444444444444', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('33333333-3333-3333-3333-333333333333', 'Soccer practice', current_date + 2, '17:00', '18:30', 'app', '33333333-3333-3333-3333-333333333333', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('55555555-5555-5555-5555-555555555555', 'Birthday party (Max)', current_date + 5, '13:00', '16:00', 'app', '55555555-5555-5555-5555-555555555555', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('11111111-1111-1111-1111-111111111111', 'Flight to Denver', current_date + 3, '08:00', '10:00', 'google', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('22222222-2222-2222-2222-222222222222', 'Church group', current_date + 2, '19:00', '20:30', 'app', '22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('77777777-7777-7777-7777-777777777777', 'Guitar lesson', current_date + 1, '15:00', '16:00', 'app', '77777777-7777-7777-7777-777777777777', 'bbbbbbbb-0000-0000-0000-000000000002');

insert into public.tasks (title, member_id, category, subject_id, date, deadline, remind_minutes, status, created_by, family_id) values
  ('Math', '33333333-3333-3333-3333-333333333333', 'school', (select id from subjects where name='Math' and family_id='aaaaaaaa-0000-0000-0000-000000000001'), current_date, '16:00', 60, 'assigned', '22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('Practice piano — 30 min', '33333333-3333-3333-3333-333333333333', 'personal', null, current_date, null, 0, 'assigned', '22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('Apply to 2 summer jobs', '44444444-4444-4444-4444-444444444444', 'work', null, current_date, null, 0, 'done', '22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('Reading — 20 minutes', '55555555-5555-5555-5555-555555555555', 'school', (select id from subjects where name='Reading' and family_id='aaaaaaaa-0000-0000-0000-000000000001'), current_date, '17:00', 30, 'assigned', '22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('Feed the dog', '55555555-5555-5555-5555-555555555555', 'home', null, current_date - 1, null, 0, 'assigned', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('Welding homework — safety quiz', '44444444-4444-4444-4444-444444444444', 'school', (select id from subjects where name='Other' and family_id='aaaaaaaa-0000-0000-0000-000000000001'), current_date + 1, null, 0, 'assigned', '22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('Get lifeguard certification', '44444444-4444-4444-4444-444444444444', 'goal', null, current_date + 4, null, 0, 'assigned', '44444444-4444-4444-4444-444444444444', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('Math', '77777777-7777-7777-7777-777777777777', 'school', (select id from subjects where name='Math' and family_id='bbbbbbbb-0000-0000-0000-000000000002'), current_date, '16:00', 60, 'assigned', '66666666-6666-6666-6666-666666666666', 'bbbbbbbb-0000-0000-0000-000000000002');

insert into public.subtasks (task_id, title, done, position, family_id) values
  ((select id from tasks where title='Math' and family_id='aaaaaaaa-0000-0000-0000-000000000001'), 'Do 5.1', true, 0, 'aaaaaaaa-0000-0000-0000-000000000001'),
  ((select id from tasks where title='Math' and family_id='aaaaaaaa-0000-0000-0000-000000000001'), 'Do 5.2', false, 1, 'aaaaaaaa-0000-0000-0000-000000000001');

insert into public.jobs (title, amount, status, taken_by, family_id) values
  ('Wash the car (inside + out)', 10, 'open', null, 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('Weed the flower beds', 8, 'done', '33333333-3333-3333-3333-333333333333', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('Mow the lawn', 15, 'open', null, 'bbbbbbbb-0000-0000-0000-000000000002');

-- "Clean the garage shelves" — taken by David, with its linked task.
-- (A single WITH-chained insert/update can't do this: a data-modifying CTE's
-- effect on a table is not visible to the primary statement's own scan of
-- that same table, so the final UPDATE would match zero rows. Sequential
-- statements in a DO block sidestep that.)
do $$
declare
  v_job_id uuid;
  v_task_id uuid;
begin
  insert into public.jobs (title, amount, status, taken_by, family_id)
  values ('Clean the garage shelves', 20, 'taken', '44444444-4444-4444-4444-444444444444', 'aaaaaaaa-0000-0000-0000-000000000001')
  returning id into v_job_id;

  insert into public.tasks (title, member_id, category, date, status, created_by, job_id, family_id)
  values ('Job: Clean the garage shelves ($20.00)', '44444444-4444-4444-4444-444444444444', 'work', current_date, 'assigned', '44444444-4444-4444-4444-444444444444', v_job_id, 'aaaaaaaa-0000-0000-0000-000000000001')
  returning id into v_task_id;

  update public.jobs set task_id = v_task_id where id = v_job_id;
end $$;

select public.cron_ensure_zone_tasks();
