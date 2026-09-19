-- Group 7: one live staff-presence calculation for admin, educator and alerts.
-- Combined-room execution remains a separate integration; this migration does
-- not change home-room assignments or activate existing combination schedules.
create or replace function public._room_staff_presence(p_daycare_id uuid)
returns table (staff_member_id uuid, profile_id uuid, full_name text, effective_classroom_id uuid)
language sql stable security definer set search_path = public
as $$
  select member.id, profile.id, profile.full_name,
    coalesce(
      (select coverage.classroom_id from public.room_coverage_assignments coverage
        where coverage.staff_member_id = member.id
          and coverage.status in ('assigned', 'accepted')
          and coverage.starts_at <= now() and coverage.ends_at > now()
        order by coverage.starts_at desc, coverage.id limit 1),
      (select entry.classroom_id from public.staff_time_entries entry
        where entry.staff_member_id = member.id and entry.clocked_out_at is null
          and entry.clocked_in_at <= now()
        order by entry.clocked_in_at desc, entry.id limit 1),
      profile.classroom_id,
      (select assignment.classroom_id from public.educator_classrooms assignment
        join public.classrooms room on room.id = assignment.classroom_id
        where assignment.educator_id = profile.id and room.daycare_id = p_daycare_id
          and room.archived_at is null
        order by assignment.classroom_id limit 1)
    )
  from public.staff_members member
  join public.profiles profile on profile.id = member.profile_id
  join public.daycares center on center.id = member.daycare_id
  where member.daycare_id = p_daycare_id and profile.daycare_id = p_daycare_id
    and member.status = 'active' and member.archived_at is null
    and profile.role = 'educator' and profile.archived_at is null
    and public.staff_is_ratio_eligible(member.id)
    and not exists (
      select 1 from public.staff_time_off_requests away
      where away.staff_member_id = member.id and away.status = 'approved'
        and (now() at time zone coalesce(center.timezone, 'UTC'))::date
          between away.starts_on and away.ends_on
    )
    and (not coalesce(center.time_tracking_enabled, false) or exists (
      select 1 from public.staff_time_entries entry
      where entry.staff_member_id = member.id and entry.clocked_out_at is null
        and entry.clocked_in_at <= now()
    ));
$$;
revoke all on function public._room_staff_presence(uuid) from public, anon, authenticated, service_role;

create or replace function public._room_ratio_snapshot(p_classroom_id uuid)
returns table (present_count integer, staff_count integer, required_staff integer,
  max_children_per_staff integer, over_by integer)
language sql stable security definer set search_path = public
as $$
  with counts as (
    select greatest(coalesce(room.ratio_children_per_educator, 1), 1) as ratio,
      (select count(*)::integer from public.attendance_records attendance
        join public.children child on child.id = attendance.child_id
        where child.classroom_id = room.id and child.archived_at is null
          and attendance.date = (now() at time zone coalesce(center.timezone, 'UTC'))::date
          and attendance.checked_in_at is not null and attendance.checked_out_at is null
          and attendance.status in ('present', 'late')) as children,
      (select count(distinct presence.profile_id)::integer
        from public._room_staff_presence(room.daycare_id) presence
        where presence.effective_classroom_id = room.id) as staff
    from public.classrooms room join public.daycares center on center.id = room.daycare_id
    where room.id = p_classroom_id and room.archived_at is null
  )
  select children, staff, ceil(children::numeric / ratio)::integer, ratio,
    greatest(ceil(children::numeric / ratio)::integer - staff, 0)
  from counts;
$$;

create or replace function public.get_rooms_live_status()
returns table (id uuid, name text, age_group text, min_age_months int, max_age_months int,
  capacity int, ratio_children_per_educator int, enrolled_count bigint,
  present_count bigint, last_log_at timestamptz, educators jsonb)
language sql stable security definer set search_path = public
as $$
  with presence as materialized (
    select * from public._room_staff_presence(public.get_my_daycare_id())
    where public.is_staff()
  )
  select room.id, room.name, room.age_group, room.min_age_months, room.max_age_months,
    room.capacity, room.ratio_children_per_educator,
    (select count(*) from public.children child where child.classroom_id = room.id and child.archived_at is null),
    snapshot.present_count::bigint,
    (select max(coalesce(log.updated_at, log.created_at)) from public.daily_logs log
      join public.children child on child.id = log.child_id
      where child.classroom_id = room.id and log.log_date = public.center_today()),
    coalesce((select jsonb_agg(jsonb_build_object('id', p.profile_id, 'full_name', p.full_name)
      order by p.full_name, p.profile_id) from presence p where p.effective_classroom_id = room.id), '[]'::jsonb)
  from public.classrooms room
  cross join lateral public._room_ratio_snapshot(room.id) snapshot
  where room.daycare_id = public.get_my_daycare_id() and room.archived_at is null and public.is_staff()
  order by room.min_age_months nulls last, room.name;
$$;

-- Invoker functions retain table RLS; one call either saves everything or nothing.
create or replace function public.save_room_ratio_rules(p_rules jsonb)
returns void language plpgsql security invoker set search_path = public
as $$
declare v_count integer;
begin
  if auth.uid() is null or not public.is_admin() or not public.has_permission('rooms', 'edit') then
    raise exception 'Administrator room-edit permission required';
  end if;
  if jsonb_typeof(p_rules) is distinct from 'array' then raise exception 'Provide a list of room rules'; end if;
  if jsonb_array_length(p_rules) not between 1 and 200 then raise exception 'Provide between 1 and 200 room rules'; end if;
  if exists (select 1 from jsonb_array_elements(p_rules) item
    where coalesce(item->>'ratio', '') !~ '^[1-9][0-9]*$'
      or coalesce(item->>'room_id', '') = '') then
    raise exception 'Every room needs a positive whole-number ratio';
  end if;
  if (select count(distinct item->>'room_id') from jsonb_array_elements(p_rules) item) <> jsonb_array_length(p_rules) then
    raise exception 'Each room can only appear once';
  end if;
  update public.classrooms room set ratio_children_per_educator = (rule->>'ratio')::integer
  from jsonb_array_elements(p_rules) rule
  where room.id = (rule->>'room_id')::uuid and room.daycare_id = public.get_my_daycare_id()
    and room.archived_at is null;
  get diagnostics v_count = row_count;
  if v_count <> jsonb_array_length(p_rules) then raise exception 'One or more rooms are unavailable; no rules were saved'; end if;
end;
$$;

create or replace function public.save_room_combinations(p_combinations jsonb)
returns void language plpgsql security invoker set search_path = public
as $$
declare item jsonb; v_source uuid; v_host uuid; v_start time; v_end time; v_enabled boolean;
begin
  if auth.uid() is null or not public.is_admin() or not public.has_permission('rooms', 'edit') then
    raise exception 'Administrator room-edit permission required';
  end if;
  if jsonb_typeof(p_combinations) is distinct from 'array' then raise exception 'Provide both combination periods'; end if;
  if jsonb_array_length(p_combinations) <> 2
    or (select count(distinct value->>'period') from jsonb_array_elements(p_combinations)
      where value->>'period' in ('morning', 'evening')) <> 2 then
    raise exception 'Provide one morning and one evening combination';
  end if;
  for item in select value from jsonb_array_elements(p_combinations) loop
    v_source := nullif(item->>'source_classroom_id', '')::uuid;
    v_host := nullif(item->>'host_classroom_id', '')::uuid;
    v_start := (item->>'starts_at')::time; v_end := (item->>'ends_at')::time;
    v_enabled := coalesce((item->>'enabled')::boolean, false);
    if v_start is null or v_end is null or v_start >= v_end then raise exception 'Combination end must be after its start'; end if;
    if v_enabled and (v_source is null or v_host is null) then raise exception 'Choose both rooms before enabling a combination'; end if;
    if v_source = v_host then raise exception 'Source and host rooms must be different'; end if;
    if exists (select 1 from unnest(array[v_source, v_host]) room_id where room_id is not null
      and not exists (select 1 from public.classrooms room where room.id = room_id
        and room.daycare_id = public.get_my_daycare_id() and room.archived_at is null)) then
      raise exception 'Both rooms must be active rooms in your center';
    end if;
    insert into public.room_combinations (daycare_id, period, source_classroom_id, host_classroom_id, starts_at, ends_at, enabled)
    values (public.get_my_daycare_id(), item->>'period', v_source, v_host, v_start, v_end, v_enabled)
    on conflict (daycare_id, period) do update set source_classroom_id = excluded.source_classroom_id,
      host_classroom_id = excluded.host_classroom_id, starts_at = excluded.starts_at,
      ends_at = excluded.ends_at, enabled = excluded.enabled;
  end loop;
  if exists (select 1 from public.room_combinations a join public.room_combinations b
    on a.daycare_id = b.daycare_id and a.id < b.id
    where a.daycare_id = public.get_my_daycare_id() and a.enabled and b.enabled
      and a.starts_at < b.ends_at and b.starts_at < a.ends_at
      and array[a.source_classroom_id, a.host_classroom_id] && array[b.source_classroom_id, b.host_classroom_id]) then
    raise exception 'A room cannot participate in overlapping combinations';
  end if;
end;
$$;
revoke all on function public.save_room_ratio_rules(jsonb), public.save_room_combinations(jsonb) from public, anon;
grant execute on function public.save_room_ratio_rules(jsonb), public.save_room_combinations(jsonb) to authenticated;

-- Planning may target a full room in the future; completing a move cannot.
create or replace function public.complete_room_transition_plan(p_plan_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_plan public.room_transition_plans%rowtype;
  v_child public.children%rowtype;
  v_room public.classrooms%rowtype;
  v_today date;
  v_present boolean;
  v_ratio record;
begin
  if auth.uid() is null or not public.has_permission('children', 'edit') then
    raise exception 'Children edit permission required';
  end if;
  select * into v_plan from public.room_transition_plans where id = p_plan_id for update;
  if v_plan.id is null or v_plan.daycare_id <> public.get_my_daycare_id() then
    raise exception 'Room transition plan not found';
  end if;
  select * into v_child from public.children where id = v_plan.child_id for update;
  if v_plan.status = 'completed' then
    return jsonb_build_object('plan_id', v_plan.id, 'child_id', v_plan.child_id,
      'classroom_id', v_child.classroom_id, 'status', v_plan.status);
  end if;
  if v_plan.status <> 'planned' then raise exception 'Only a planned room transition can be completed'; end if;
  if v_child.archived_at is not null then raise exception 'An archived child cannot be moved'; end if;
  if v_child.classroom_id is distinct from v_plan.from_classroom_id then
    raise exception 'The child is no longer assigned to the plan''s starting room';
  end if;
  v_today := public.center_today();
  if v_plan.move_on > v_today then raise exception 'This move is scheduled for %. Change the plan first to move earlier.', v_plan.move_on; end if;
  -- Serialize completions into a destination before checking its occupancy.
  select * into v_room from public.classrooms where id = v_plan.to_classroom_id for update;
  if v_room.id is null or v_room.daycare_id <> v_plan.daycare_id or v_room.archived_at is not null then
    raise exception 'The destination room is no longer available';
  end if;
  if v_room.opens_on > v_today then raise exception 'The destination room has not opened yet'; end if;
  if v_room.capacity is not null and (select count(*) from public.children
    where classroom_id = v_room.id and archived_at is null) >= v_room.capacity then
    raise exception 'The destination room is full. Free a spot or reschedule this move.';
  end if;
  select exists (select 1 from public.attendance_records
    where child_id = v_child.id and date = v_today and checked_in_at is not null
      and checked_out_at is null and status in ('present', 'late')) into v_present;
  if v_present then
    select * into v_ratio from public._room_ratio_snapshot(v_room.id);
    if v_ratio.staff_count * v_ratio.max_children_per_staff < v_ratio.present_count + 1 then
      raise exception 'This move would put the destination over ratio. Assign coverage before completing it.';
    end if;
  end if;
  update public.children set classroom_id = v_plan.to_classroom_id where id = v_plan.child_id;
  update public.room_transition_plans set status = 'completed' where id = v_plan.id;
  perform public.queue_parent_schedule_notice(
    v_plan.daycare_id, v_plan.child_id, v_child.first_name || '''s room move is complete',
    v_child.first_name || ' is now assigned to ' || v_room.name || '.',
    jsonb_build_object('type', 'room_move', 'screen', 'ParentRoomMove',
      'childId', v_plan.child_id, 'transitionId', v_plan.id),
    'room-move:' || v_plan.id || ':completed', now(), true);
  return jsonb_build_object('plan_id', v_plan.id, 'child_id', v_plan.child_id,
    'classroom_id', v_plan.to_classroom_id, 'status', 'completed');
end;
$$;
