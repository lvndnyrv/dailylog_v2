-- A staff manager may refine another person's access, but never their own.
-- This trigger protects both the RPC and any future direct-table client.

create or replace function public.guard_staff_permission_override_self_service()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_profile_id uuid := coalesce(new.profile_id, old.profile_id);
begin
  if auth.uid() is not null and auth.uid() = v_profile_id then
    raise exception 'Another administrator must update your permissions';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists guard_staff_permission_override_self_service
  on public.staff_permission_overrides;
create trigger guard_staff_permission_override_self_service
  before insert or update or delete on public.staff_permission_overrides
  for each row execute function public.guard_staff_permission_override_self_service();
