-- Make staff deactivation an access-control operation, not only a roster label.

create or replace function public.get_my_role()
returns text
language sql security definer stable
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and archived_at is null
$$;

create or replace function public.get_my_daycare_id()
returns uuid
language sql security definer stable
set search_path = public
as $$
  select daycare_id from public.profiles where id = auth.uid() and archived_at is null
$$;

create or replace function public.get_my_classroom_id()
returns uuid
language sql security definer stable
set search_path = public
as $$
  select classroom_id from public.profiles where id = auth.uid() and archived_at is null
$$;

create or replace function public.admin_set_staff_active(
  p_staff_member_id uuid,
  p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_daycare_id uuid := public.get_my_daycare_id();
  v_actor_role text := public.get_my_role();
  v_member public.staff_members%rowtype;
  v_profile public.profiles%rowtype;
  v_next_status text := case when p_active then 'active' else 'inactive' end;
begin
  if auth.uid() is null or v_daycare_id is null
     or not public.has_permission('staff', 'approve') then
    raise exception 'Staff approval permission is required';
  end if;

  select member.* into v_member
    from public.staff_members member
   where member.id = p_staff_member_id
     and member.daycare_id = v_daycare_id
   for update;
  if v_member.id is null or v_member.profile_id is null then
    raise exception 'Staff record not found';
  end if;

  select profile.* into v_profile
    from public.profiles profile
   where profile.id = v_member.profile_id
     and profile.daycare_id = v_daycare_id
   for update;
  if v_profile.id is null then
    raise exception 'Staff profile not found';
  end if;
  if v_profile.id = auth.uid() then
    raise exception 'You cannot change your own account status';
  end if;
  if v_profile.role = 'owner_admin' then
    raise exception 'The center owner account cannot be deactivated';
  end if;
  if v_profile.role = 'admin' and v_actor_role <> 'owner_admin' then
    raise exception 'Only the center owner can change an administrator account';
  end if;

  if v_member.status = v_next_status
     and ((p_active and v_member.archived_at is null and v_profile.archived_at is null)
       or (not p_active and v_member.archived_at is not null and v_profile.archived_at is not null)) then
    return jsonb_build_object(
      'staff_member_id', v_member.id,
      'profile_id', v_profile.id,
      'status', v_next_status,
      'changed', false
    );
  end if;

  update public.staff_members
     set status = v_next_status,
         archived_at = case when p_active then null else coalesce(archived_at, now()) end,
         ended_on = case when p_active then null else coalesce(ended_on, current_date) end,
         updated_at = now()
   where id = v_member.id;

  update public.profiles
     set archived_at = case when p_active then null else coalesce(archived_at, now()) end,
         updated_at = now()
   where id = v_profile.id;

  if not p_active then
    update public.staff_delegations
       set revoked_at = coalesce(revoked_at, now()),
           revoked_by = coalesce(revoked_by, auth.uid()),
           updated_at = now()
     where delegate_profile_id = v_profile.id
       and daycare_id = v_daycare_id
       and revoked_at is null;
  end if;

  insert into public.audit_log (
    daycare_id, actor_id, action, entity_type, entity_id, before, after
  ) values (
    v_daycare_id,
    auth.uid(),
    case when p_active then 'staff_reactivated' else 'staff_deactivated' end,
    'staff_access',
    v_profile.id,
    jsonb_build_object(
      'staffMemberId', v_member.id,
      'status', v_member.status,
      'profileArchivedAt', v_profile.archived_at,
      'memberArchivedAt', v_member.archived_at
    ),
    jsonb_build_object(
      'staffMemberId', v_member.id,
      'status', v_next_status,
      'active', p_active
    )
  );

  insert into public.notifications (
    daycare_id, profile_id, kind, title, body, payload
  ) values (
    v_daycare_id,
    v_profile.id,
    case when p_active then 'staff_reactivated' else 'staff_deactivated' end,
    case when p_active then 'Center access restored' else 'Center access ended' end,
    case when p_active
      then 'An administrator restored your DailyLog access.'
      else 'An administrator ended your DailyLog access. Contact the center if this is unexpected.' end,
    jsonb_build_object('type', case when p_active then 'staff_reactivated' else 'staff_deactivated' end)
  );

  return jsonb_build_object(
    'staff_member_id', v_member.id,
    'profile_id', v_profile.id,
    'status', v_next_status,
    'changed', true
  );
end;
$$;

revoke all on function public.admin_set_staff_active(uuid, boolean) from public, anon;
grant execute on function public.admin_set_staff_active(uuid, boolean) to authenticated;

comment on function public.admin_set_staff_active(uuid, boolean) is
  'Atomically deactivates or reactivates a staff profile and roster record, revoking active delegations and recording the access change.';
