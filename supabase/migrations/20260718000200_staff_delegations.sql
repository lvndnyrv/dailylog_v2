-- ============================================================================
-- Group 4g/4h — temporary, scoped admin delegations
-- ============================================================================

create table staff_delegations (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references daycares(id) on delete cascade,
  delegate_profile_id uuid not null references profiles(id) on delete cascade,
  access_level text not null check (access_level in ('specific_areas', 'full_admin')),
  areas text[] not null default '{}',
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  granted_by uuid not null references profiles(id) on delete restrict,
  revoked_at timestamptz,
  revoked_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (revoked_at is null or revoked_at >= starts_at),
  check (access_level = 'full_admin' or cardinality(areas) > 0),
  check (
    areas <@ array[
      'attendance', 'enrollment', 'compliance', 'broadcasts', 'billing'
    ]::text[]
  )
);

create index staff_delegations_center_idx
  on staff_delegations (daycare_id, starts_at desc);
create index staff_delegations_delegate_idx
  on staff_delegations (delegate_profile_id, ends_at desc)
  where revoked_at is null;

create trigger staff_delegations_updated_at
  before update on staff_delegations
  for each row execute function update_updated_at();

alter table staff_delegations enable row level security;

-- Owners manage the center's delegation register. A delegate can read their
-- own grant, while effective permissions are resolved by the definer function
-- below and do not rely on direct table access.
create policy "owners manage staff delegations" on staff_delegations
  for all
  using (
    daycare_id = get_my_daycare_id()
    and get_my_role() = 'owner_admin'
  )
  with check (
    daycare_id = get_my_daycare_id()
    and get_my_role() = 'owner_admin'
  );

create policy "delegates read their grants" on staff_delegations
  for select
  using (
    daycare_id = get_my_daycare_id()
    and delegate_profile_id = auth.uid()
  );

-- Delegation creation is owner-only and validates the full lifecycle at the DB
-- boundary. Expired rows remain as the immutable history shown in 4g.
create or replace function grant_staff_delegation(
  p_delegate_profile_id uuid,
  p_access_level text,
  p_areas text[],
  p_ends_at timestamptz
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_daycare uuid := get_my_daycare_id();
  v_id uuid;
  v_areas text[];
begin
  if get_my_role() <> 'owner_admin' then
    raise exception 'Only the owner admin can grant delegated access';
  end if;
  if p_access_level not in ('specific_areas', 'full_admin') then
    raise exception 'Choose a valid access level';
  end if;
  if p_ends_at <= now() then
    raise exception 'The expiry must be in the future';
  end if;
  if p_ends_at > now() + interval '1 year' then
    raise exception 'Delegations may not exceed one year';
  end if;

  select coalesce(array_agg(distinct area order by area), '{}'::text[])
    into v_areas
    from unnest(coalesce(p_areas, '{}'::text[])) area
   where area in ('attendance', 'enrollment', 'compliance', 'broadcasts', 'billing');

  if p_access_level = 'specific_areas' and cardinality(v_areas) = 0 then
    raise exception 'Select at least one area';
  end if;

  if not exists (
    select 1
      from profiles p
      join staff_members sm
        on sm.profile_id = p.id
       and sm.daycare_id = p.daycare_id
       and sm.status = 'active'
       and sm.archived_at is null
     where p.id = p_delegate_profile_id
       and p.daycare_id = v_daycare
       and p.role in ('educator', 'admin')
       and p.id <> auth.uid()
       and p.archived_at is null
  ) then
    raise exception 'Choose an active staff member from this center';
  end if;

  if exists (
    select 1 from staff_delegations d
     where d.daycare_id = v_daycare
       and d.delegate_profile_id = p_delegate_profile_id
       and d.revoked_at is null
       and d.starts_at <= now()
       and d.ends_at > now()
  ) then
    raise exception 'This staff member already has active delegated access';
  end if;

  insert into staff_delegations (
    daycare_id, delegate_profile_id, access_level, areas, ends_at, granted_by
  ) values (
    v_daycare, p_delegate_profile_id, p_access_level, v_areas, p_ends_at, auth.uid()
  ) returning id into v_id;

  return v_id;
end;
$$;

create or replace function revoke_staff_delegation(p_delegation_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if get_my_role() <> 'owner_admin' then
    raise exception 'Only the owner admin can revoke delegated access';
  end if;

  update staff_delegations
     set revoked_at = now(), revoked_by = auth.uid()
   where id = p_delegation_id
     and daycare_id = get_my_daycare_id()
     and revoked_at is null
     and ends_at > now();

  if not found then
    raise exception 'This delegation is no longer active';
  end if;
end;
$$;

-- A compact owner-only projection for 4g. Action counts come from the existing
-- audit trail and stay attributed to the real person who performed them.
create or replace function get_staff_delegations()
returns table (
  id uuid,
  delegate_profile_id uuid,
  delegate_name text,
  delegate_role text,
  classroom_name text,
  access_level text,
  areas text[],
  starts_at timestamptz,
  ends_at timestamptz,
  granted_by_name text,
  revoked_at timestamptz,
  revoked_by_name text,
  action_count bigint
)
language plpgsql security definer stable
set search_path = public
as $$
begin
  if get_my_role() <> 'owner_admin' then
    raise exception 'Only the owner admin can view the delegation register';
  end if;

  return query
  select d.id,
         d.delegate_profile_id,
         delegate.full_name,
         delegate.role,
         classroom.name,
         d.access_level,
         d.areas,
         d.starts_at,
         d.ends_at,
         grantor.full_name,
         d.revoked_at,
         revoker.full_name,
         (
           select count(*)
             from audit_log a
            where a.daycare_id = d.daycare_id
              and a.actor_id = d.delegate_profile_id
              and a.created_at >= d.starts_at
              and a.created_at <= least(
                d.ends_at,
                coalesce(d.revoked_at, d.ends_at)
              )
         )::bigint
    from staff_delegations d
    join profiles delegate on delegate.id = d.delegate_profile_id
    left join classrooms classroom on classroom.id = delegate.classroom_id
    join profiles grantor on grantor.id = d.granted_by
    left join profiles revoker on revoker.id = d.revoked_by
   where d.daycare_id = get_my_daycare_id()
   order by
     (d.revoked_at is null and d.ends_at > now()) desc,
     d.starts_at desc;
end;
$$;

-- Delegation grants augment the person's ordinary role for their existing room
-- scope. "Full admin" intentionally excludes billing; billing must be chosen
-- explicitly through a specific-area grant, matching the 4g safety note.
create or replace function has_permission(p_area text, p_action text default 'view')
returns boolean
language plpgsql security definer stable
set search_path = public
as $$
declare
  v_role text;
  v_permissions jsonb;
  v_value text;
begin
  if p_area not in (
    'daily_logs', 'attendance', 'medications', 'incidents', 'children',
    'enrollment', 'broadcasts', 'billing', 'reports', 'staff'
  ) or p_action not in ('view', 'edit', 'approve') then
    return false;
  end if;

  select p.role, r.permissions into v_role, v_permissions
    from profiles p
    left join center_roles r on r.id = p.center_role_id and r.daycare_id = p.daycare_id
   where p.id = auth.uid();

  if v_role = 'owner_admin' then return true; end if;

  if exists (
    select 1
      from staff_delegations d
     where d.delegate_profile_id = auth.uid()
       and d.daycare_id = get_my_daycare_id()
       and d.starts_at <= now()
       and d.ends_at > now()
       and d.revoked_at is null
       and (
         (d.access_level = 'full_admin' and p_area <> 'billing')
         or p_area = any(d.areas)
         or ('compliance' = any(d.areas) and p_area in ('medications', 'incidents'))
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

drop trigger if exists audit_staff_delegations on staff_delegations;
create trigger audit_staff_delegations
  after insert or update on staff_delegations
  for each row execute function audit_write();

revoke all on function grant_staff_delegation(uuid, text, text[], timestamptz) from public, anon;
revoke all on function revoke_staff_delegation(uuid) from public, anon;
revoke all on function get_staff_delegations() from public, anon;
grant execute on function grant_staff_delegation(uuid, text, text[], timestamptz) to authenticated;
grant execute on function revoke_staff_delegation(uuid) to authenticated;
grant execute on function get_staff_delegations() to authenticated;
