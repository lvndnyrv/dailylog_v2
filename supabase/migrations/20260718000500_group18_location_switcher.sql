-- Group 18d — one owner account can operate several center locations. The
-- active daycare remains the existing global tenant boundary, so every query,
-- RPC and RLS policy is scoped immediately after a switch.
create table if not exists profile_daycare_memberships (
  profile_id uuid not null references profiles(id) on delete cascade,
  daycare_id uuid not null references daycares(id) on delete cascade,
  group_name text not null,
  location_label text not null,
  color text not null default '#2F7CD8',
  created_at timestamptz not null default now(),
  primary key (profile_id, daycare_id)
);

alter table profile_daycare_memberships enable row level security;

drop policy if exists "members read own daycare locations" on profile_daycare_memberships;
create policy "members read own daycare locations"
  on profile_daycare_memberships for select
  using (profile_id = auth.uid());

insert into profile_daycare_memberships (
  profile_id, daycare_id, group_name, location_label, color
)
select p.id, p.daycare_id, d.name, d.name, '#F0B441'
from profiles p
join daycares d on d.id = p.daycare_id
where p.daycare_id is not null
on conflict (profile_id, daycare_id) do nothing;

-- A profile can now own one staff row per location. Keep the legacy "my staff
-- row" helper and self-read policy pinned to the active tenant so rosters,
-- timekeeping and clock-in never leak the same person across locations.
create or replace function my_staff_member_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select id from staff_members
  where profile_id = auth.uid()
    and daycare_id = get_my_daycare_id()
    and status = 'active'
    and archived_at is null
  limit 1
$$;

drop policy if exists "staff read own record, admins all" on staff_members;
create policy "staff read own record, admins all" on staff_members
  for select using (
    (profile_id = auth.uid() and daycare_id = get_my_daycare_id())
    or (is_admin() and daycare_id = get_my_daycare_id())
  );

drop policy if exists "staff read own or permitted records" on staff_members;
create policy "staff read own or permitted records" on staff_members
  for select using (
    (profile_id = auth.uid() and daycare_id = get_my_daycare_id())
    or (has_permission('staff', 'view') and daycare_id = get_my_daycare_id())
  );

create or replace function sync_profile_daycare_membership()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.daycare_id is not null and (old.daycare_id is null or old.daycare_id <> new.daycare_id) then
    insert into profile_daycare_memberships (
      profile_id, daycare_id, group_name, location_label, color
    )
    select new.id, d.id, d.name, d.name, '#F0B441'
    from daycares d where d.id = new.daycare_id
    on conflict (profile_id, daycare_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_sync_daycare_membership on profiles;
create trigger profiles_sync_daycare_membership
  after update of daycare_id on profiles
  for each row execute function sync_profile_daycare_membership();

create or replace function list_my_daycare_locations()
returns table (
  id uuid,
  group_name text,
  location_label text,
  address text,
  color text,
  checked_in_count bigint,
  is_active boolean
)
language sql stable security definer
set search_path = public
as $$
  select
    d.id,
    m.group_name,
    m.location_label,
    d.address,
    m.color,
    (
      select count(*)
      from attendance_records a
      where a.daycare_id = d.id
        and a.date = current_date
        and a.checked_in_at is not null
        and a.checked_out_at is null
        and a.status in ('present', 'late')
    ) as checked_in_count,
    p.daycare_id = d.id as is_active
  from profile_daycare_memberships m
  join daycares d on d.id = m.daycare_id and d.active
  join profiles p on p.id = m.profile_id
  where m.profile_id = auth.uid()
  order by is_active desc, m.location_label;
$$;

create or replace function switch_daycare_location(p_daycare_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from profile_daycare_memberships
    where profile_id = auth.uid() and daycare_id = p_daycare_id
  ) then
    raise exception 'You do not have access to that location';
  end if;

  update profiles
  set daycare_id = p_daycare_id, classroom_id = null, updated_at = now()
  where id = auth.uid();
end;
$$;

create or replace function create_daycare_location(
  p_location_label text,
  p_address text default null,
  p_color text default '#2F7CD8'
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_profile profiles%rowtype;
  v_group_name text;
  v_existing uuid;
  v_daycare_id uuid;
begin
  select * into v_profile from profiles where id = auth.uid();
  if v_profile.id is null or v_profile.role <> 'owner_admin' then
    raise exception 'Only the owner admin can add a location';
  end if;
  if length(trim(p_location_label)) < 2 then
    raise exception 'Enter a location name';
  end if;

  select m.group_name into v_group_name
  from profile_daycare_memberships m
  where m.profile_id = auth.uid() and m.daycare_id = v_profile.daycare_id;
  v_group_name := coalesce(v_group_name, 'My center');

  select m.daycare_id into v_existing
  from profile_daycare_memberships m
  where m.profile_id = auth.uid()
    and lower(m.location_label) = lower(trim(p_location_label));
  if v_existing is not null then return v_existing; end if;

  insert into daycares (name, address, created_by)
  values (v_group_name || ' · ' || trim(p_location_label), nullif(trim(p_address), ''), auth.uid())
  returning id into v_daycare_id;

  insert into profile_daycare_memberships (
    profile_id, daycare_id, group_name, location_label, color
  ) values (
    auth.uid(), v_daycare_id, v_group_name, trim(p_location_label),
    case when p_color ~ '^#[0-9A-Fa-f]{6}$' then p_color else '#2F7CD8' end
  );

  insert into staff_members (
    daycare_id, profile_id, job_title, employment_type, started_on, status
  ) values (
    v_daycare_id, auth.uid(), 'Director', 'full_time', current_date, 'active'
  ) on conflict (daycare_id, profile_id) do nothing;

  return v_daycare_id;
end;
$$;

revoke all on function list_my_daycare_locations() from public;
revoke all on function switch_daycare_location(uuid) from public;
revoke all on function create_daycare_location(text, text, text) from public;
grant execute on function list_my_daycare_locations() to authenticated;
grant execute on function switch_daycare_location(uuid) to authenticated;
grant execute on function create_daycare_location(text, text, text) to authenticated;
