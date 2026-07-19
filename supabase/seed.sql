-- Local dev only. Runs automatically on `supabase db reset` / `supabase start`.
-- Mirrors the approved prototype's seed data exactly (home-scheduler-prototype.html
-- `seed()`), so local development looks like the spec from the first run.
-- Never run this against the real production project — see README
-- "First-run family setup" for the real bootstrap procedure instead.

insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('11111111-1111-1111-1111-111111111111', 'dad@example.com', '', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('22222222-2222-2222-2222-222222222222', 'mom@example.com', '', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('33333333-3333-3333-3333-333333333333', 'sara@example.com', '', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('44444444-4444-4444-4444-444444444444', 'david@example.com', '', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('55555555-5555-5555-5555-555555555555', 'jj@example.com', '', now(), '{}', '{}', 'authenticated', 'authenticated');

insert into public.profiles (id, display_name, role, color) values
  ('11111111-1111-1111-1111-111111111111', 'Dad',   'parent', '#111827'),
  ('22222222-2222-2222-2222-222222222222', 'Mom',   'parent', '#d4a900'),
  ('33333333-3333-3333-3333-333333333333', 'Sara',  'kid',    '#ec4899'),
  ('44444444-4444-4444-4444-444444444444', 'David', 'kid',    '#3b82f6'),
  ('55555555-5555-5555-5555-555555555555', 'JJ',    'kid',    '#22c55e');

insert into public.subjects (name, position) values
  ('Math', 0), ('Reading', 1), ('Science', 2), ('Other', 3);

insert into public.zone_rotation (start_date, interval_days, offset_cycles, member_order) values
  (date_trunc('week', current_date)::date, 7, 0, array[
    '33333333-3333-3333-3333-333333333333'::uuid, -- Sara
    '44444444-4444-4444-4444-444444444444'::uuid, -- David
    '55555555-5555-5555-5555-555555555555'::uuid  -- JJ
  ]);

insert into public.zones (name, subzones) values
  ('Kitchen', array['Dishes & counters','Sweep + mop floor','Take out trash']),
  ('Bathrooms', array['Sinks & mirrors','Toilets','Empty trash']),
  ('Living room + hallway', array['Vacuum','Dust shelves','Tidy shoes & coats']);

insert into public.calendar_events (member_id, title, date, start_time, end_time, source, created_by) values
  ('22222222-2222-2222-2222-222222222222', 'Dentist — Sara & JJ', current_date, '14:00', '15:00', 'google', '22222222-2222-2222-2222-222222222222'),
  ('44444444-4444-4444-4444-444444444444', 'Welding program', current_date, '09:00', '12:00', 'app', '44444444-4444-4444-4444-444444444444'),
  ('44444444-4444-4444-4444-444444444444', 'Welding program', current_date + 2, '09:00', '12:00', 'app', '44444444-4444-4444-4444-444444444444'),
  ('44444444-4444-4444-4444-444444444444', 'Work shift — Hardware store', current_date + 1, '16:00', '20:00', 'app', '44444444-4444-4444-4444-444444444444'),
  ('33333333-3333-3333-3333-333333333333', 'Soccer practice', current_date + 2, '17:00', '18:30', 'app', '33333333-3333-3333-3333-333333333333'),
  ('55555555-5555-5555-5555-555555555555', 'Birthday party (Max)', current_date + 5, '13:00', '16:00', 'app', '55555555-5555-5555-5555-555555555555'),
  ('11111111-1111-1111-1111-111111111111', 'Flight to Denver', current_date + 3, '08:00', '10:00', 'google', '11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222', 'Church group', current_date + 2, '19:00', '20:30', 'app', '22222222-2222-2222-2222-222222222222');

insert into public.tasks (title, member_id, category, subject_id, date, deadline, remind_minutes, status, created_by) values
  ('Math', '33333333-3333-3333-3333-333333333333', 'school', (select id from subjects where name='Math'), current_date, '16:00', 60, 'assigned', '22222222-2222-2222-2222-222222222222'),
  ('Practice piano — 30 min', '33333333-3333-3333-3333-333333333333', 'personal', null, current_date, null, 0, 'assigned', '22222222-2222-2222-2222-222222222222'),
  ('Apply to 2 summer jobs', '44444444-4444-4444-4444-444444444444', 'work', null, current_date, null, 0, 'done', '22222222-2222-2222-2222-222222222222'),
  ('Reading — 20 minutes', '55555555-5555-5555-5555-555555555555', 'school', (select id from subjects where name='Reading'), current_date, '17:00', 30, 'assigned', '22222222-2222-2222-2222-222222222222'),
  ('Feed the dog', '55555555-5555-5555-5555-555555555555', 'home', null, current_date - 1, null, 0, 'assigned', '11111111-1111-1111-1111-111111111111'),
  ('Welding homework — safety quiz', '44444444-4444-4444-4444-444444444444', 'school', (select id from subjects where name='Other'), current_date + 1, null, 0, 'assigned', '22222222-2222-2222-2222-222222222222'),
  ('Get lifeguard certification', '44444444-4444-4444-4444-444444444444', 'goal', null, current_date + 4, null, 0, 'assigned', '44444444-4444-4444-4444-444444444444');

insert into public.subtasks (task_id, title, done, position) values
  ((select id from tasks where title='Math'), 'Do 5.1', true, 0),
  ((select id from tasks where title='Math'), 'Do 5.2', false, 1);

insert into public.jobs (title, amount, status, taken_by) values
  ('Wash the car (inside + out)', 10, 'open', null),
  ('Weed the flower beds', 8, 'done', '33333333-3333-3333-3333-333333333333');

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
  insert into public.jobs (title, amount, status, taken_by)
  values ('Clean the garage shelves', 20, 'taken', '44444444-4444-4444-4444-444444444444')
  returning id into v_job_id;

  insert into public.tasks (title, member_id, category, date, status, created_by, job_id)
  values ('Job: Clean the garage shelves ($20.00)', '44444444-4444-4444-4444-444444444444', 'work', current_date, 'assigned', '44444444-4444-4444-4444-444444444444', v_job_id)
  returning id into v_task_id;

  update public.jobs set task_id = v_task_id where id = v_job_id;
end $$;

select public.cron_ensure_zone_tasks();
