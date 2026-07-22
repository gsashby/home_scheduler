create function public.update_task(
  p_task_id uuid,
  p_title text,
  p_member_id uuid,
  p_category public.task_category,
  p_subject_id uuid,
  p_date date,
  p_deadline time,
  p_remind_minutes int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task tasks%rowtype;
begin
  select * into v_task from tasks where id = p_task_id;
  if not found then
    raise exception 'Task not found';
  end if;
  if v_task.status = 'verified' then
    raise exception 'Task already verified';
  end if;

  if not public.is_parent() then
    if not (v_task.member_id = auth.uid() and v_task.created_by = auth.uid() and v_task.zone_id is null) then
      raise exception 'Not allowed';
    end if;
    if p_member_id <> auth.uid() then
      raise exception 'Kids can only assign items to themselves';
    end if;
  end if;

  if p_title is null or btrim(p_title) = '' then
    raise exception 'Title is required';
  end if;

  update tasks set
    title = p_title,
    member_id = p_member_id,
    category = p_category,
    subject_id = p_subject_id,
    date = p_date,
    deadline = p_deadline,
    remind_minutes = coalesce(p_remind_minutes, 0)
  where id = p_task_id;

  if p_member_id <> v_task.member_id then
    perform public.notify(
      p_member_id, 'update',
      (select display_name from profiles where id = auth.uid()) || ' assigned you a task: "' || p_title || '"'
    );
  end if;
end;
$$;
revoke all on function public.update_task(uuid, text, uuid, public.task_category, uuid, date, time, int) from public;
grant execute on function public.update_task(uuid, text, uuid, public.task_category, uuid, date, time, int) to authenticated;
