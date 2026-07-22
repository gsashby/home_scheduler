-- Same invariant as set_member_role()'s guard on `role` (parent/kid) --
-- a family must always have at least one admin. Unlike that one, there's
-- no live bug behind this: no RPC currently changes family_member_role
-- after initial assignment (only create_family()/_join_family()/
-- handle_new_user() set it, once, at family-creation/join time -- see
-- 02-database-schema.md), and Settings only displays the admin tag, it
-- never offers a way to change it. So there's no UI path that could trip
-- this today.
--
-- Added anyway, as a database-level belt-and-suspenders guard rather
-- than an RPC-level one (there's no single RPC to put it in yet): a
-- trigger protects the invariant against *any* future write path --
-- a "transfer admin" feature, a manual fix via the SQL editor, anything
-- -- the same way the profiles/family_id data already gets defended by
-- force_own_family_id() regardless of which RPC is doing the writing.
create or replace function public.prevent_last_admin_demotion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.family_member_role = 'admin' and new.family_member_role = 'member' and old.family_id is not null then
    if not exists (
      select 1 from profiles
      where family_id = old.family_id and family_member_role = 'admin' and id <> old.id
    ) then
      raise exception 'Every family needs at least one admin -- promote someone else to admin first';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_prevent_last_admin_demotion
  before update of family_member_role on public.profiles
  for each row execute function public.prevent_last_admin_demotion();
