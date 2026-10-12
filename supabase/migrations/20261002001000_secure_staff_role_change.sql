-- Keep a staff member's coarse auth role and permission-library role in sync.
-- The original function predated center_roles and relied on client-side guards.

create or replace function public.admin_set_user_role(
  p_user_id uuid,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_daycare_id uuid := public.get_my_daycare_id();
  v_actor_role text := public.get_my_role();
  v_target public.profiles%rowtype;
  v_staff public.staff_members%rowtype;
  v_role_id uuid;
  v_role_name text;
begin
  if auth.uid() is null or v_daycare_id is null or not public.is_admin() then
    raise exception 'Only administrators can change staff roles';
  end if;
  if p_role not in ('admin', 'educator') then
    raise exception 'Staff access must be administrator or educator';
  end if;

  select profile.* into v_target
    from public.profiles profile
   where profile.id = p_user_id
     and profile.daycare_id = v_daycare_id
     and profile.archived_at is null
   for update;
  if v_target.id is null then
    raise exception 'Active staff profile not found';
  end if;
  if v_target.id = auth.uid() then
    raise exception 'You cannot change your own role';
  end if;
  if v_target.role = 'owner_admin' then
    raise exception 'The center owner role cannot be changed';
  end if;
  if (v_target.role = 'admin' or p_role = 'admin') and v_actor_role <> 'owner_admin' then
    raise exception 'Only the center owner can change administrator roles';
  end if;

  select member.* into v_staff
    from public.staff_members member
   where member.profile_id = v_target.id
     and member.daycare_id = v_daycare_id
     and member.archived_at is null
   for update;
  if v_staff.id is null then
    raise exception 'Active staff record not found';
  end if;

  v_role_name := public.default_role_name(
    p_role,
    v_staff.job_title,
    v_target.classroom_id
  );
  select role.id into v_role_id
    from public.center_roles role
   where role.daycare_id = v_daycare_id
     and role.name = v_role_name;
  if v_role_id is null then
    raise exception 'The matching center permission role is missing';
  end if;

  if v_target.role = p_role and v_target.center_role_id = v_role_id then
    return;
  end if;

  update public.profiles
     set role = p_role,
         center_role_id = v_role_id,
         updated_at = now()
   where id = v_target.id;

  -- Temporary delegated authority must never survive a permanent role change.
  update public.staff_delegations
     set revoked_at = coalesce(revoked_at, now()),
         revoked_by = coalesce(revoked_by, auth.uid()),
         updated_at = now()
   where delegate_profile_id = v_target.id
     and daycare_id = v_daycare_id
     and revoked_at is null;

  insert into public.audit_log (
    daycare_id, actor_id, action, entity_type, entity_id, before, after
  ) values (
    v_daycare_id,
    auth.uid(),
    'staff_role_changed',
    'staff_access',
    v_target.id,
    jsonb_build_object(
      'role', v_target.role,
      'centerRoleId', v_target.center_role_id
    ),
    jsonb_build_object(
      'role', p_role,
      'centerRoleId', v_role_id,
      'centerRoleName', v_role_name
    )
  );

  insert into public.notifications (
    daycare_id, profile_id, kind, title, body, payload
  ) values (
    v_daycare_id,
    v_target.id,
    'staff_role_changed',
    'Your center access changed',
    case when p_role = 'admin'
      then 'The center owner granted you administrator access.'
      else 'The center owner changed your access to educator.' end,
    jsonb_build_object(
      'type', 'staff_role_changed',
      'role', p_role,
      'screen', 'ProfileTab'
    )
  );
end;
$$;

revoke all on function public.admin_set_user_role(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_set_user_role(uuid, text)
  to authenticated, service_role;

comment on function public.admin_set_user_role(uuid, text) is
  'Changes active staff between administrator and educator, synchronizes the center permission role, revokes temporary delegations, and records the access change.';
