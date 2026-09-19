-- Rooms use the existing daily-log permission family in the role library.
-- Keep "rooms" readable at call sites while preserving every existing custom role.
create or replace function public.has_permission(p_area text, p_action text default 'view')
returns boolean
language plpgsql security definer stable
set search_path = public
as $$
declare
  v_role text;
  v_permissions jsonb;
  v_value text;
begin
  if p_area = 'rooms' then p_area := 'daily_logs'; end if;
  if p_area not in (
    'daily_logs', 'attendance', 'medications', 'incidents', 'children',
    'enrollment', 'broadcasts', 'billing', 'reports', 'staff'
  ) or p_action not in ('view', 'edit', 'approve') then
    return false;
  end if;

  select profile.role, role.permissions into v_role, v_permissions
    from public.profiles profile
    left join public.center_roles role
      on role.id = profile.center_role_id and role.daycare_id = profile.daycare_id
   where profile.id = auth.uid();

  if v_role = 'owner_admin' then return true; end if;

  if exists (
    select 1
      from public.staff_delegations delegation
     where delegation.delegate_profile_id = auth.uid()
       and delegation.daycare_id = public.get_my_daycare_id()
       and delegation.starts_at <= now()
       and delegation.ends_at > now()
       and delegation.revoked_at is null
       and (
         (delegation.access_level = 'full_admin' and p_area <> 'billing')
         or p_area = any(delegation.areas)
         or ('compliance' = any(delegation.areas) and p_area in ('medications', 'incidents'))
       )
  ) then
    return true;
  end if;

  v_value := v_permissions #>> array[p_area, p_action];
  if v_value in ('true', 'false') then return v_value::boolean; end if;

  if v_role = 'admin' then return true; end if;
  if v_role = 'educator' then
    if p_action = 'view' then
      return p_area in ('daily_logs', 'attendance', 'medications', 'incidents', 'children', 'broadcasts');
    elsif p_action = 'edit' then
      return p_area in ('daily_logs', 'attendance', 'medications', 'incidents');
    end if;
  end if;
  return false;
end;
$$;
