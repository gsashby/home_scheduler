-- Safeguard: set_member_role() had no guard against demoting a family's
-- only parent to kid -- hit for real in production (a single-member
-- family's sole "Dad" profile got demoted via Settings' "Make kid"
-- button, leaving zero parents and no one able to verify tasks, manage
-- zones, post jobs, or use the "Make parent" button to undo it, since
-- Settings itself is parent-gated). Fixed by hand via service-role
-- update for that specific row; this migration prevents a repeat.

create or replace function public.set_member_role(p_member_id uuid, p_role public.family_role)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family_id uuid := public.current_family_id();
  v_current_role public.family_role;
begin
  if not public.is_family_admin() then
    raise exception 'Admin role required';
  end if;
  if not exists (select 1 from profiles where id = p_member_id and family_id = v_family_id) then
    raise exception 'Not a family member';
  end if;

  select role into v_current_role from profiles where id = p_member_id;

  if p_role = 'kid' and v_current_role = 'parent' then
    if (select count(*) from profiles where family_id = v_family_id and role = 'parent') <= 1 then
      raise exception 'Every family needs at least one parent -- promote someone else to parent first';
    end if;
  end if;

  update profiles set role = p_role where id = p_member_id;
end;
$$;
