-- Group 4e: per-person permission overrides. A null classroom_id applies to
-- every assigned room; a room row applies only to that assigned room and wins
-- over the global override. Missing cells continue to inherit the center role.

create table if not exists public.staff_permission_overrides (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references public.daycares(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  classroom_id uuid references public.classrooms(id) on delete cascade,
  permissions jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(permissions) = 'object')
);

create unique index if not exists staff_permission_overrides_scope_unique
  on public.staff_permission_overrides (
    profile_id,
    coalesce(classroom_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
create index if not exists staff_permission_overrides_center_idx
  on public.staff_permission_overrides(daycare_id, profile_id);

drop trigger if exists staff_permission_overrides_updated_at on public.staff_permission_overrides;
create trigger staff_permission_overrides_updated_at
  before update on public.staff_permission_overrides
  for each row execute function public.update_updated_at();

drop trigger if exists audit_staff_permission_overrides on public.staff_permission_overrides;
create trigger audit_staff_permission_overrides
  after insert or update or delete on public.staff_permission_overrides
  for each row execute function public.audit_write();

alter table public.staff_permission_overrides enable row level security;

create policy "staff read own permission overrides"
  on public.staff_permission_overrides for select
  using (profile_id = auth.uid());
create policy "permitted staff view permission overrides"
  on public.staff_permission_overrides for select
  using (
    public.has_permission('staff', 'view')
    and daycare_id = public.get_my_daycare_id()
  );
create policy "permitted staff manage permission overrides"
  on public.staff_permission_overrides for all
  using (
    public.has_permission('staff', 'approve')
    and daycare_id = public.get_my_daycare_id()
  )
  with check (
    public.has_permission('staff', 'approve')
    and daycare_id = public.get_my_daycare_id()
  );

create or replace function public.has_permission(p_area text, p_action text default 'view')
returns boolean
language plpgsql security definer stable
set search_path = public
as $$
declare
  v_role text;
  v_permissions jsonb;
  v_override jsonb;
  v_value text;
begin
  if p_area = 'rooms' then p_area := 'daily_logs'; end if;
  if p_area not in (
    'daily_logs', 'attendance', 'medications', 'incidents', 'children',
    'enrollment', 'broadcasts', 'billing', 'reports', 'staff'
  ) or p_action not in ('view', 'edit', 'approve') then
    return false;
  end if;

  select profile.role, role.permissions, override.permissions
    into v_role, v_permissions, v_override
    from public.profiles profile
    left join public.center_roles role
      on role.id = profile.center_role_id and role.daycare_id = profile.daycare_id
    left join public.staff_permission_overrides override
      on override.profile_id = profile.id and override.classroom_id is null
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

  v_value := v_override #>> array[p_area, p_action];
  if v_value in ('true', 'false') then return v_value::boolean; end if;

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

create or replace function public.has_permission_for_classroom(
  p_area text,
  p_action text,
  p_classroom_id uuid
)
returns boolean
language plpgsql security definer stable
set search_path = public
as $$
declare
  v_role text;
  v_permissions jsonb;
  v_global jsonb;
  v_room jsonb;
  v_value text;
begin
  if p_area = 'rooms' then p_area := 'daily_logs'; end if;
  if p_area not in (
    'daily_logs', 'attendance', 'medications', 'incidents', 'children',
    'enrollment', 'broadcasts', 'billing', 'reports', 'staff'
  ) or p_action not in ('view', 'edit', 'approve') then
    return false;
  end if;

  select profile.role, role.permissions, global_override.permissions, room_override.permissions
    into v_role, v_permissions, v_global, v_room
    from public.profiles profile
    left join public.center_roles role
      on role.id = profile.center_role_id and role.daycare_id = profile.daycare_id
    left join public.staff_permission_overrides global_override
      on global_override.profile_id = profile.id and global_override.classroom_id is null
    left join public.staff_permission_overrides room_override
      on room_override.profile_id = profile.id and room_override.classroom_id = p_classroom_id
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

  v_value := v_room #>> array[p_area, p_action];
  if v_value in ('true', 'false') then return v_value::boolean; end if;
  v_value := v_global #>> array[p_area, p_action];
  if v_value in ('true', 'false') then return v_value::boolean; end if;
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

create or replace function public.can_access_child_area(
  p_child_id uuid,
  p_area text,
  p_action text default 'view'
)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select case
    when public.get_my_role() = 'parent' then
      p_action = 'view' and p_child_id in (select public.my_child_ids())
    when public.is_admin() then
      exists (
        select 1 from public.children child
         where child.id = p_child_id
           and child.daycare_id = public.get_my_daycare_id()
           and public.has_permission_for_classroom(p_area, p_action, child.classroom_id)
      )
    when public.get_my_role() = 'educator' then
      exists (
        select 1 from public.children child
         where child.id = p_child_id
           and child.daycare_id = public.get_my_daycare_id()
           and child.archived_at is null
           and coalesce(child.enrolled_on, '-infinity'::date) <= public.center_today()
           and public.has_permission_for_classroom(p_area, p_action, child.classroom_id)
           and (
             (p_area = 'children' and p_action = 'view')
             or public.can_access_child(child.id)
           )
      )
    else false
  end
$$;

create or replace function public.get_staff_permission_matrix(p_profile_id uuid)
returns jsonb
language plpgsql security definer stable
set search_path = public
as $$
declare
  v_daycare uuid := public.get_my_daycare_id();
  v_result jsonb;
begin
  if auth.uid() is null or (
    auth.uid() <> p_profile_id and not public.has_permission('staff', 'view')
  ) then
    raise exception 'Staff view permission required';
  end if;

  select jsonb_build_object(
    'profile_id', profile.id,
    'profile_name', profile.full_name,
    'profile_role', profile.role,
    'role_id', role.id,
    'role_name', coalesce(role.name, initcap(replace(profile.role, '_', ' '))),
    'role_permissions', coalesce(role.permissions, '{}'::jsonb),
    'rooms', coalesce((
      select jsonb_agg(jsonb_build_object('id', assigned.id, 'name', assigned.name) order by assigned.name)
        from (
          select room.id, room.name
            from public.educator_classrooms assignment
            join public.classrooms room on room.id = assignment.classroom_id
           where assignment.educator_id = profile.id
             and room.daycare_id = profile.daycare_id
             and room.archived_at is null
          union
          select room.id, room.name
            from public.classrooms room
           where room.id = profile.classroom_id
             and room.daycare_id = profile.daycare_id
             and room.archived_at is null
        ) assigned
    ), '[]'::jsonb),
    'overrides', coalesce((
      select jsonb_agg(jsonb_build_object(
        'classroom_id', override.classroom_id,
        'permissions', override.permissions,
        'updated_at', override.updated_at
      ) order by override.classroom_id nulls first)
        from public.staff_permission_overrides override
       where override.profile_id = profile.id
    ), '[]'::jsonb)
  ) into v_result
    from public.profiles profile
    left join public.center_roles role
      on role.id = profile.center_role_id and role.daycare_id = profile.daycare_id
   where profile.id = p_profile_id
     and profile.daycare_id = v_daycare;

  if v_result is null then raise exception 'Staff profile not found'; end if;
  return v_result;
end;
$$;

create or replace function public.save_staff_permission_override(
  p_profile_id uuid,
  p_classroom_id uuid,
  p_permissions jsonb
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_daycare uuid := public.get_my_daycare_id();
  v_target public.profiles%rowtype;
  v_area text;
  v_action text;
  v_value jsonb;
  v_clean jsonb := '{}'::jsonb;
begin
  if auth.uid() is null or not public.has_permission('staff', 'approve') then
    raise exception 'Staff approval permission required';
  end if;
  select * into v_target from public.profiles
   where id = p_profile_id and daycare_id = v_daycare;
  if v_target.id is null then raise exception 'Staff profile not found'; end if;
  if v_target.role = 'owner_admin' then raise exception 'Owner permissions cannot be overridden'; end if;
  if p_classroom_id is not null and not exists (
    select 1
      from public.classrooms room
     where room.id = p_classroom_id
       and room.daycare_id = v_daycare
       and room.archived_at is null
       and (
         v_target.classroom_id = room.id
         or exists (
           select 1
             from public.educator_classrooms assignment
            where assignment.educator_id = p_profile_id
              and assignment.classroom_id = room.id
         )
       )
  ) then
    raise exception 'The room must be permanently assigned to this staff member';
  end if;
  if p_permissions is null or jsonb_typeof(p_permissions) <> 'object' then
    raise exception 'Permissions must be a JSON object';
  end if;

  foreach v_area in array array[
    'daily_logs','attendance','medications','incidents','children',
    'enrollment','broadcasts','billing','reports','staff'
  ] loop
    foreach v_action in array array['view','edit','approve'] loop
      v_value := p_permissions #> array[v_area, v_action];
      if jsonb_typeof(v_value) = 'boolean' then
        v_clean := v_clean || jsonb_build_object(
          v_area,
          coalesce(v_clean -> v_area, '{}'::jsonb)
            || jsonb_build_object(v_action, v_value)
        );
      end if;
    end loop;
  end loop;

  if v_clean = '{}'::jsonb then
    delete from public.staff_permission_overrides override
     where override.profile_id = p_profile_id
       and override.classroom_id is not distinct from p_classroom_id;
  elsif exists (
    select 1 from public.staff_permission_overrides override
     where override.profile_id = p_profile_id
       and override.classroom_id is not distinct from p_classroom_id
  ) then
    update public.staff_permission_overrides override
       set permissions = v_clean, updated_by = auth.uid(), updated_at = now()
     where override.profile_id = p_profile_id
       and override.classroom_id is not distinct from p_classroom_id;
  else
    insert into public.staff_permission_overrides (
      daycare_id, profile_id, classroom_id, permissions, updated_by
    ) values (
      v_daycare, p_profile_id, p_classroom_id, v_clean, auth.uid()
    );
  end if;

  if p_profile_id <> auth.uid() then
    insert into public.notifications (
      daycare_id, profile_id, kind, title, body, payload
    ) values (
      v_daycare, p_profile_id, 'permission_update',
      'Your access was updated',
      case when p_classroom_id is null
        then 'Your center updated your DailyLog permissions.'
        else 'Your center updated your permissions for an assigned room.'
      end,
      jsonb_build_object('type', 'permission_update', 'screen', 'ProfileTab')
    );
  end if;
end;
$$;

-- Children remain center-visible to staff with the global permission, but a
-- room-specific override now wins for children in that room.
drop policy if exists "read children by area access" on public.children;
create policy "read children by area access" on public.children
  for select
  using (
    (
      public.is_admin()
      and daycare_id = public.get_my_daycare_id()
      and public.has_permission_for_classroom('children', 'view', classroom_id)
    )
    or (
      public.get_my_role() = 'educator'
      and daycare_id = public.get_my_daycare_id()
      and archived_at is null
      and coalesce(enrolled_on, '-infinity'::date) <= public.center_today()
      and public.has_permission_for_classroom('children', 'view', classroom_id)
    )
    or (
      public.get_my_role() = 'parent'
      and id in (select public.my_child_ids())
    )
  );

revoke all on function public.has_permission_for_classroom(text, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.has_permission_for_classroom(text, text, uuid)
  to authenticated, service_role;
revoke all on function public.get_staff_permission_matrix(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_staff_permission_matrix(uuid)
  to authenticated, service_role;
revoke all on function public.save_staff_permission_override(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.save_staff_permission_override(uuid, uuid, jsonb)
  to authenticated, service_role;
