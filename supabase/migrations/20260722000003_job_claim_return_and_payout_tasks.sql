-- Job board: let a kid return a claimed job before it's done, and turn job
-- completion into explicit parent-facing tasks ("verify" + "pay out")
-- instead of a single combined Job Board button.

alter table public.tasks
  add column job_role text check (job_role in ('verify', 'pay'));

-- ---- shared helpers (not directly callable by clients) --------------------

create or replace function public._create_job_payout_tasks(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job jobs%rowtype;
  p record;
begin
  select * into v_job from jobs where id = p_job_id;

  for p in select id from profiles where role = 'parent' and family_id = v_job.family_id loop
    insert into tasks (title, member_id, category, date, status, created_by, job_id, job_role, family_id)
    values ('Verify: ' || v_job.title, p.id, 'work', current_date, 'assigned', auth.uid(), p_job_id, 'verify', v_job.family_id);

    insert into tasks (title, member_id, category, date, status, created_by, job_id, job_role, family_id)
    values ('Pay $' || v_job.amount || ': ' || v_job.title, p.id, 'work', current_date, 'assigned', auth.uid(), p_job_id, 'pay', v_job.family_id);
  end loop;
end;
$$;
revoke all on function public._create_job_payout_tasks(uuid) from public;

create or replace function public._settle_job_payout_tasks(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update tasks set status = 'verified'
  where job_id = p_job_id and job_role is not null and status <> 'verified';
end;
$$;
revoke all on function public._settle_job_payout_tasks(uuid) from public;

-- ---- return a claimed job before it's done ---------------------------------

create or replace function public.return_job(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job jobs%rowtype;
begin
  select * into v_job from jobs where id = p_job_id for update;
  if not found or v_job.family_id <> public.current_family_id() then
    raise exception 'Job not found';
  end if;
  if v_job.taken_by <> auth.uid() then
    raise exception 'Not your job';
  end if;
  if v_job.status <> 'taken' then
    raise exception 'Job can no longer be returned';
  end if;

  delete from tasks where id = v_job.task_id;
  update jobs set status = 'open', taken_by = null, task_id = null where id = p_job_id;

  perform public.notify_parents(
    'job', (select display_name from profiles where id = auth.uid()) || ' returned the job "' || v_job.title || '" to the board'
  );
end;
$$;
revoke all on function public.return_job(uuid) from public;
grant execute on function public.return_job(uuid) to authenticated;

-- ---- job_done: kid finishes -> claim task verifies, payout tasks spawn ----

create or replace function public.job_done(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job jobs%rowtype;
begin
  select * into v_job from jobs where id = p_job_id;
  if not found or v_job.family_id <> public.current_family_id() then
    raise exception 'Job not found';
  end if;
  if v_job.taken_by <> auth.uid() then
    raise exception 'Not your job';
  end if;
  if v_job.status <> 'taken' then
    raise exception 'Job is not in progress';
  end if;

  update jobs set status = 'done' where id = p_job_id;
  update tasks set status = 'verified' where id = v_job.task_id and status = 'assigned';

  perform public._create_job_payout_tasks(p_job_id);

  perform public.notify_parents(
    'job', (select display_name from profiles where id = auth.uid()) || ' finished "' || v_job.title || '" — verify & pay $' || v_job.amount
  );
end;
$$;

-- ---- mark_task_done: route job-linked tasks through the same lifecycle ----

create or replace function public.mark_task_done(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task tasks%rowtype;
  v_job jobs%rowtype;
  v_name text;
begin
  select * into v_task from tasks where id = p_task_id;
  if not found or v_task.family_id <> public.current_family_id() then
    raise exception 'Task not found';
  end if;
  if v_task.member_id <> auth.uid() then
    raise exception 'Not your task';
  end if;
  if v_task.status <> 'assigned' then
    raise exception 'Task is not in assigned state';
  end if;

  -- Payout tasks (job_role set) are the assignee's own confirmation — they
  -- resolve in one step instead of waiting on a separate verifier.
  if v_task.job_role = 'pay' then
    update tasks set status = 'verified' where id = p_task_id;
    select * into v_job from jobs where id = v_task.job_id;
    update jobs set status = 'paid' where id = v_job.id;
    perform public.notify(v_job.taken_by, 'job', '"' || v_job.title || '" verified — you earned $' || v_job.amount || ' 🎉');
    return;
  end if;

  if v_task.job_role = 'verify' then
    update tasks set status = 'verified' where id = p_task_id;
    return;
  end if;

  if v_task.job_id is not null then
    -- Original claim task: finishing it verifies immediately and hands the
    -- job to the parents as explicit verify/pay tasks.
    update tasks set status = 'verified' where id = p_task_id;
    update jobs set status = 'done' where id = v_task.job_id and status = 'taken';
    perform public._create_job_payout_tasks(v_task.job_id);
    select display_name into v_name from profiles where id = auth.uid();
    perform public.notify_parents(
      'job', v_name || ' finished "' || (select title from jobs where id = v_task.job_id) || '" — verify & pay'
    );
    return;
  end if;

  update tasks set status = 'done' where id = p_task_id;
  select display_name into v_name from profiles where id = auth.uid();
  perform public.notify_parents('update', v_name || ' marked "' || v_task.title || '" as done — ready to verify');
end;
$$;

-- ---- verify_task: job payout no longer routes through here ----------------

create or replace function public.verify_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task tasks%rowtype;
  v_parent_name text;
begin
  if not public.is_parent() then
    raise exception 'Parent role required';
  end if;

  select * into v_task from tasks where id = p_task_id;
  if not found or v_task.family_id <> public.current_family_id() then
    raise exception 'Task not found';
  end if;

  update tasks set status = 'verified' where id = p_task_id;

  if v_task.zone_id is not null then
    insert into zone_dismissals (zone_id, cycle, family_id) values (v_task.zone_id, v_task.zone_cycle, v_task.family_id) on conflict do nothing;
  end if;

  select display_name into v_parent_name from profiles where id = auth.uid();
  perform public.notify(v_task.member_id, 'update', '"' || v_task.title || '" was verified by ' || v_parent_name || ' ✓');
end;
$$;

-- ---- pay_job: Job Board's combined verify+pay shortcut ---------------------

create or replace function public.pay_job(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job jobs%rowtype;
begin
  if not public.is_parent() then
    raise exception 'Parent role required';
  end if;

  select * into v_job from jobs where id = p_job_id;
  if not found or v_job.family_id <> public.current_family_id() then
    raise exception 'Job not found';
  end if;
  if v_job.status <> 'done' then
    raise exception 'Job is not awaiting payment';
  end if;

  update jobs set status = 'paid' where id = p_job_id;
  perform public._settle_job_payout_tasks(p_job_id);

  perform public.notify(v_job.taken_by, 'job', '"' || v_job.title || '" verified — you earned $' || v_job.amount || ' 🎉');
end;
$$;

-- ---- delete_job: clean up every task tied to the job, not just the claim --

create or replace function public.delete_job(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job jobs%rowtype;
begin
  if not public.is_parent() then
    raise exception 'Parent role required';
  end if;

  select * into v_job from jobs where id = p_job_id;
  if not found or v_job.family_id <> public.current_family_id() then
    return;
  end if;

  delete from tasks where job_id = p_job_id and status <> 'verified';

  delete from jobs where id = p_job_id;
end;
$$;
