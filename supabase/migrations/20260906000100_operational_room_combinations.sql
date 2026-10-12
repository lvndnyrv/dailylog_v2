-- 7f: time-bound operational rooms. Home assignments are never rewritten.
-- Legacy saved plans stay inert until an admin explicitly saves/activates them.
alter table public.room_combinations add column activated_at timestamptz;
alter table public.room_combinations add column paused_on date;

create function public._active_room_combination(p_room uuid, p_at timestamptz default now())
returns setof public.room_combinations
language sql stable security definer set search_path = public as $$
  select combination.* from public.room_combinations combination
  join public.daycares center on center.id = combination.daycare_id
  join public.classrooms source on source.id = combination.source_classroom_id
  join public.classrooms host on host.id = combination.host_classroom_id
  where p_room in (source.id, host.id)
    and source.daycare_id = center.id and host.daycare_id = center.id
    and source.archived_at is null and host.archived_at is null
    and combination.enabled and combination.activated_at is not null
    and extract(isodow from p_at at time zone center.timezone) between 1 and 5
    and combination.paused_on is distinct from (p_at at time zone center.timezone)::date
    and (p_at at time zone center.timezone)::time >= combination.starts_at
    and (p_at at time zone center.timezone)::time < combination.ends_at
    and coalesce(source.opens_on, '-infinity'::date) <= (p_at at time zone center.timezone)::date
    and coalesce(host.opens_on, '-infinity'::date) <= (p_at at time zone center.timezone)::date
    and not exists (select 1 from public.center_closures closure where closure.daycare_id = center.id
      and (p_at at time zone center.timezone)::date between closure.starts_on and closure.ends_on)
    -- Fail closed if legacy data has ambiguous overlapping shared-room plans.
    and not exists (select 1 from public.room_combinations other
      where other.daycare_id = center.id and other.id <> combination.id and other.enabled
        and other.activated_at is not null and other.paused_on is distinct from (p_at at time zone center.timezone)::date
        and other.starts_at < combination.ends_at and combination.starts_at < other.ends_at
        and array[other.source_classroom_id, other.host_classroom_id] && array[source.id, host.id]);
$$;
create function public._operating_room_id(p_room uuid, p_at timestamptz default now())
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce((select host_classroom_id from public._active_room_combination(p_room, p_at)), p_room);
$$;
revoke all on function public._active_room_combination(uuid,timestamptz), public._operating_room_id(uuid,timestamptz)
  from public, anon, authenticated, service_role;

create function public.guard_operational_room_combination()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('room-combinations:' || new.daycare_id::text, 0));
  if exists (select 1 from unnest(array[new.source_classroom_id,new.host_classroom_id]) rid
    where rid is not null and not exists (select 1 from public.classrooms c
      where c.id = rid and c.daycare_id = new.daycare_id and c.archived_at is null)) then
    raise exception 'Both combination rooms must be active rooms in the same center';
  end if;
  if new.enabled and new.activated_at is not null then
    if new.source_classroom_id is null or new.host_classroom_id is null then raise exception 'Choose both rooms'; end if;
    if exists (select 1 from public.classrooms c where c.id in (new.source_classroom_id,new.host_classroom_id)
      and (c.ratio_children_per_educator is null or c.ratio_children_per_educator < 1)) then
      raise exception 'Set a licensed ratio for both rooms before activating a combination';
    end if;
    if not exists (select 1 from public.classrooms c where c.id = new.host_classroom_id and c.capacity > 0) then
      raise exception 'Set the host room capacity before activating this combination';
    end if;
    if exists (select 1 from public.room_combinations other where other.daycare_id = new.daycare_id
      and other.id <> new.id and other.enabled and other.activated_at is not null
      and other.starts_at < new.ends_at and new.starts_at < other.ends_at
      and array[other.source_classroom_id,other.host_classroom_id] && array[new.source_classroom_id,new.host_classroom_id]) then
      raise exception 'A room cannot participate in overlapping combinations';
    end if;
  end if;
  return new;
end; $$;
revoke all on function public.guard_operational_room_combination() from public, anon, authenticated;
create trigger guard_operational_room_combination before insert or update on public.room_combinations
  for each row execute function public.guard_operational_room_combination();

-- Preserve the original atomic validation and add explicit activation.
create function public._notify_room_combination_change(p_daycare uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_room record; v_recipient record; v_payload jsonb;
begin
  v_payload := jsonb_build_object('screen','RoomRatios','type','room_combination','href','/rooms?modal=combine');
  for v_recipient in select p.id from public.profiles p join public.staff_members s on s.profile_id = p.id
    where p.daycare_id = p_daycare and p.role = 'educator' and p.archived_at is null
      and s.status = 'active' and s.archived_at is null loop
    insert into public.notifications(daycare_id,profile_id,kind,title,body,payload)
    values(p_daycare,v_recipient.id,'room_combination','Room combinations updated',
      'Check Rooms & ratios for current shared groups and today''s pauses. Home rooms have not changed.',v_payload);
    insert into public.notification_outbox(daycare_id,recipient_id,channel,kind,title,body,payload,dedupe_key)
    values(p_daycare,v_recipient.id,'push','room_combination','Room combinations updated',
      'Open Rooms & ratios to review the shared-room schedule.',v_payload,'room-combination:'||gen_random_uuid());
  end loop;
  for v_room in select id from public.classrooms where daycare_id = p_daycare and archived_at is null loop
    perform public._refresh_room_ratio_event(v_room.id,false);
    perform public._record_room_ratio_history(v_room.id,clock_timestamp(),'room_rule');
  end loop;
end; $$;
revoke all on function public._notify_room_combination_change(uuid) from public,anon,authenticated;
alter function public.save_room_combinations(jsonb) rename to _save_room_combination_settings;
revoke all on function public._save_room_combination_settings(jsonb) from public, anon, authenticated;
create function public.save_room_combinations(p_combinations jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_admin() or not public.has_permission('rooms','edit') then
    raise exception 'Administrator room-edit permission required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('room-combinations:' || public.get_my_daycare_id()::text, 0));
  -- Disable runtime while replacing both periods, to allow swapping their rooms/times atomically.
  update public.room_combinations set activated_at = null where daycare_id = public.get_my_daycare_id();
  perform public._save_room_combination_settings(p_combinations);
  update public.room_combinations set activated_at = now() where daycare_id = public.get_my_daycare_id() and enabled;
  perform public._notify_room_combination_change(public.get_my_daycare_id());
end; $$;
create function public.pause_room_combination_today(p_id uuid, p_paused boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_admin() or not public.has_permission('rooms','edit') then
    raise exception 'Administrator room-edit permission required';
  end if;
  update public.room_combinations set paused_on = case when p_paused then public.center_today() else null end
    where id = p_id and daycare_id = public.get_my_daycare_id() and activated_at is not null;
  if not found then raise exception 'Active combination schedule not found'; end if;
  perform public._notify_room_combination_change(public.get_my_daycare_id());
end; $$;
revoke all on function public.save_room_combinations(jsonb), public.pause_room_combination_today(uuid,boolean) from public, anon;
grant execute on function public.save_room_combinations(jsonb), public.pause_room_combination_today(uuid,boolean) to authenticated;

create function public.get_room_operating_context()
returns table (room_id uuid, host_room_id uuid, host_room_name text, member_room_ids uuid[],
  combination_id uuid, live_ratio integer, ends_at time)
language sql stable security definer set search_path = public as $$
  select room.id, coalesce(combination.host_classroom_id,room.id), coalesce(host.name,room.name),
    case when combination.id is null then array[room.id] else array[combination.source_classroom_id,combination.host_classroom_id] end,
    combination.id,
    case when combination.id is null then room.ratio_children_per_educator
      else least(source.ratio_children_per_educator,host.ratio_children_per_educator) end,
    combination.ends_at
  from public.classrooms room
  left join lateral public._active_room_combination(room.id) combination on true
  left join public.classrooms host on host.id = combination.host_classroom_id
  left join public.classrooms source on source.id = combination.source_classroom_id
  where room.daycare_id = public.get_my_daycare_id() and room.archived_at is null and public.is_staff();
$$;
revoke all on function public.get_room_operating_context() from public, anon;
grant execute on function public.get_room_operating_context() to authenticated;

create or replace function public._room_ratio_snapshot(p_classroom_id uuid)
returns table (present_count integer, staff_count integer, required_staff integer, max_children_per_staff integer, over_by integer)
language sql stable security definer set search_path = public as $$
  with room_context as (
    select room.*, center.timezone,
      public._operating_room_id(room.id) as host_id,
      coalesce((select least(s.ratio_children_per_educator,h.ratio_children_per_educator)
        from public._active_room_combination(room.id) a
        join public.classrooms s on s.id = a.source_classroom_id
        join public.classrooms h on h.id = a.host_classroom_id),room.ratio_children_per_educator,1) as ratio
    from public.classrooms room join public.daycares center on center.id = room.daycare_id
    where room.id = p_classroom_id and room.archived_at is null
  ), counts as (
    select room.ratio,
      (select count(*)::integer from public.attendance_records attendance join public.children child on child.id = attendance.child_id
        where child.daycare_id = room.daycare_id and child.archived_at is null
          and public._operating_room_id(child.classroom_id) = room.id
          and attendance.date = (now() at time zone room.timezone)::date
          and attendance.checked_in_at is not null and attendance.checked_out_at is null
          and attendance.status in ('present','late')) as children,
      (select count(distinct p.profile_id)::integer from public._room_staff_presence(room.daycare_id) p
        where public._operating_room_id(p.effective_classroom_id) = room.id) as staff
    from room_context room
  )
  select children,staff,ceil(children::numeric/greatest(ratio,1))::integer,ratio,
    greatest(ceil(children::numeric/greatest(ratio,1))::integer-staff,0) from counts;
$$;

-- Add only temporary same-center partner-room access. It expires with the window.
create or replace function public.my_classroom_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  with base as (
    select a.classroom_id as id from public.educator_classrooms a where a.educator_id = auth.uid()
    union select p.classroom_id from public.profiles p where p.id = auth.uid() and p.classroom_id is not null
    union select c.classroom_id from public.room_coverage_assignments c join public.staff_members s on s.id = c.staff_member_id
      where s.profile_id = auth.uid() and s.status = 'active' and s.archived_at is null
        and c.status in ('assigned','accepted') and c.starts_at <= now() and c.ends_at > now()
  )
  select id from base
  union select partner.id from base b
    cross join lateral public._active_room_combination(b.id) combination
    cross join lateral unnest(array[combination.source_classroom_id,combination.host_classroom_id]) partner(id)
    where combination.daycare_id = public.get_my_daycare_id() and exists (
      select 1 from public.staff_members s join public.profiles p on p.id = s.profile_id
      where p.id = auth.uid() and p.role = 'educator' and p.archived_at is null
        and s.status = 'active' and s.archived_at is null);
$$;

create function public.get_my_operational_classrooms()
returns table (id uuid, name text, age_group text, temporary boolean, member_room_ids uuid[])
language sql stable security definer set search_path = public as $$
  select r.id,r.name,r.age_group,
    not (r.id = coalesce(public.get_my_classroom_id(),'00000000-0000-0000-0000-000000000000'::uuid)
      or exists (select 1 from public.educator_classrooms e where e.educator_id = auth.uid() and e.classroom_id = r.id)),
    ctx.member_room_ids
  from public.classrooms r join public.get_room_operating_context() ctx on ctx.room_id = r.id
  where r.id in (select public.my_classroom_ids()) or (public.is_admin() and r.daycare_id = public.get_my_daycare_id())
  order by r.name;
$$;
revoke all on function public.get_my_operational_classrooms() from public, anon;
grant execute on function public.get_my_operational_classrooms() to authenticated;

-- This applies to all attendance entry points, including kiosk and mobile RPCs.
create function public.enforce_operating_room_checkin()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_room uuid; v_center public.daycares%rowtype; v_snapshot record; v_capacity integer;
begin
  if new.checked_in_at is null or new.checked_out_at is not null or new.status not in ('present','late') then return new; end if;
  if tg_op = 'UPDATE' and old.child_id = new.child_id and old.date = new.date
    and old.checked_in_at is not null and old.checked_out_at is null and old.status in ('present','late') then return new; end if;
  select * into v_center from public.daycares where id = new.daycare_id;
  if not v_center.ratio_block_checkins or new.date <> (now() at time zone v_center.timezone)::date then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('room-checkin:' || new.daycare_id::text,0));
  select public._operating_room_id(classroom_id) into v_room from public.children where id = new.child_id;
  if v_room is null then raise exception 'Assign a room before checking this child in'; end if;
  select * into v_snapshot from public._room_ratio_snapshot(v_room);
  select capacity into v_capacity from public.classrooms where id = v_room;
  if v_capacity is not null and v_snapshot.present_count + 1 > v_capacity then raise exception 'The operating room is at capacity. Pause the combination or arrange another room.'; end if;
  if v_snapshot.present_count + 1 > v_snapshot.staff_count * v_snapshot.max_children_per_staff then
    raise exception 'Check-in would exceed the operating room ratio. Assign eligible coverage first.';
  end if;
  return new;
end; $$;
revoke all on function public.enforce_operating_room_checkin() from public, anon, authenticated;
create trigger enforce_operating_room_checkin before insert or update on public.attendance_records
  for each row execute function public.enforce_operating_room_checkin();

-- Refresh the host as well when a home-room event occurs during a combination.
alter function public._refresh_room_ratio_event(uuid,boolean) rename to _refresh_single_room_ratio_event;
create function public._refresh_room_ratio_event(p_classroom_id uuid, p_allow_notification boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare v_host uuid := public._operating_room_id(p_classroom_id);
begin
  perform public._refresh_single_room_ratio_event(p_classroom_id,p_allow_notification);
  if v_host is distinct from p_classroom_id then perform public._refresh_single_room_ratio_event(v_host,p_allow_notification); end if;
end; $$;
alter function public._record_room_ratio_history(uuid,timestamptz,text) rename to _record_single_room_ratio_history;
create function public._record_room_ratio_history(p_classroom_id uuid,p_observed_at timestamptz default clock_timestamp(),p_source text default 'scheduled_sweep')
returns void language plpgsql security definer set search_path = public as $$
declare v_host uuid := public._operating_room_id(p_classroom_id);
begin
  perform public._record_single_room_ratio_history(p_classroom_id,p_observed_at,p_source);
  if v_host is distinct from p_classroom_id then perform public._record_single_room_ratio_history(v_host,p_observed_at,p_source); end if;
end; $$;
revoke all on function public._refresh_room_ratio_event(uuid,boolean), public._record_room_ratio_history(uuid,timestamptz,text)
  from public, anon, authenticated;

create or replace function public.list_available_ratio_floaters(p_classroom_id uuid)
returns table (staff_member_id uuid,profile_id uuid,full_name text,current_classroom_id uuid,current_classroom_name text,availability_note text)
language sql stable security definer set search_path = public as $$
  with candidates as (
    select p.staff_member_id,p.profile_id,p.full_name,public._operating_room_id(p.effective_classroom_id) as room_id
    from public._room_staff_presence(public.get_my_daycare_id()) p
    where public.is_staff() and exists (select 1 from public.classrooms r where r.id = p_classroom_id and r.daycare_id = public.get_my_daycare_id())
      and not exists (select 1 from public.room_coverage_assignments c where c.staff_member_id = p.staff_member_id
        and c.status in ('assigned','accepted') and c.starts_at <= now() and c.ends_at > now())
  )
  select c.staff_member_id,c.profile_id,c.full_name,c.room_id,r.name,
    case when c.room_id is null then 'Available · floater pool' else 'In ' || r.name || ' · can spare' end
  from candidates c left join public.classrooms r on r.id = c.room_id
  left join lateral public._room_ratio_snapshot(c.room_id) snapshot on true
  where c.room_id is distinct from public._operating_room_id(p_classroom_id)
    and (c.room_id is null or snapshot.staff_count-1 >= snapshot.required_staff)
  order by (c.room_id is null) desc,c.full_name;
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
      order by p.full_name, p.profile_id) from presence p where public._operating_room_id(p.effective_classroom_id) = room.id), '[]'::jsonb)
  from public.classrooms room
  cross join lateral public._room_ratio_snapshot(room.id) snapshot
  where room.daycare_id = public.get_my_daycare_id() and room.archived_at is null and public.is_staff()
  order by room.min_age_months nulls last, room.name;
$$;


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
    select * into v_ratio from public._room_ratio_snapshot(public._operating_room_id(v_room.id));
    if v_ratio.staff_count * v_ratio.max_children_per_staff < v_ratio.present_count + (case when public._operating_room_id(v_child.classroom_id) = public._operating_room_id(v_room.id) then 0 else 1 end) then
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
