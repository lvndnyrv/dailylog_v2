-- A room lead is a responsibility. Moving the educator's permanent room is an
-- explicit second choice, committed with the room settings or not at all.
create function public.save_room_settings_with_lead_transfer(
  p_room_id uuid,
  p_settings jsonb,
  p_expected_updated_at timestamptz default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_center uuid := public.get_my_daycare_id();
  v_lead uuid;
  v_staff uuid;
  v_home uuid;
  v_room uuid;
  v_opens_on date;
begin
  if auth.uid() is null or v_center is null
     or not public.has_permission('rooms', 'edit')
     or not public.has_permission('staff', 'edit') then
    raise exception 'Room and staff edit permissions are required to move a lead educator';
  end if;

  if jsonb_typeof(p_settings) is distinct from 'object' then
    raise exception 'Provide room settings';
  end if;
  v_lead := nullif(p_settings->>'lead_educator_id', '')::uuid;
  if v_lead is null then
    raise exception 'Choose a lead educator before moving their home room';
  end if;

  -- The base save validates all room fields, lead eligibility, center ownership,
  -- and the optimistic version. Its write rolls back if any staffing check fails.
  v_room := public.save_room_settings(p_room_id, p_settings, p_expected_updated_at);
  select opens_on into v_opens_on
    from public.classrooms
   where id = v_room and daycare_id = v_center;
  if v_opens_on > public.center_today() then
    raise exception 'This room opens later. Move the educator when it opens after reviewing their schedule';
  end if;

  select member.id, profile.classroom_id into v_staff, v_home
    from public.staff_members member
    join public.profiles profile on profile.id = member.profile_id
   where profile.id = v_lead
     and profile.daycare_id = v_center
     and profile.role = 'educator'
     and profile.archived_at is null
     and member.daycare_id = v_center
     and member.status = 'active'
     and member.archived_at is null
   for update of member, profile;
  if v_staff is null then
    raise exception 'Choose an active educator from this center';
  end if;
  if v_home is not distinct from v_room then
    return v_room;
  end if;

  if exists (
    select 1 from public.staff_time_entries entry
     where entry.staff_member_id = v_staff
       and entry.clocked_out_at is null
       and entry.classroom_id is distinct from v_room
  ) then
    raise exception 'The educator is clocked in elsewhere. Finish that shift before moving their home room';
  end if;
  if exists (
    select 1 from public.staff_regular_schedules schedule
     where schedule.staff_member_id = v_staff
       and schedule.classroom_id is not null
       and schedule.classroom_id <> v_room
  ) then
    raise exception 'The educator has a regular schedule in another room. Update it in Staff before moving their home room';
  end if;
  if exists (
    select 1 from public.staff_shifts shift
     where shift.staff_member_id = v_staff
       and shift.status = 'published'
       and shift.ends_at > now()
       and shift.classroom_id is not null
       and shift.classroom_id <> v_room
  ) then
    raise exception 'The educator has a published shift in another room. Update it in Staff before moving their home room';
  end if;

  perform public.bulk_assign_staff_room(array[v_staff], v_room);
  return v_room;
end;
$$;

revoke all on function public.save_room_settings_with_lead_transfer(uuid, jsonb, timestamptz)
  from public, anon;
grant execute on function public.save_room_settings_with_lead_transfer(uuid, jsonb, timestamptz)
  to authenticated;
