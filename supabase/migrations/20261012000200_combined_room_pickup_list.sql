-- During an active open/close combination, both educators work from the same
-- physical pickup roster. The child's permanent classroom stays unchanged.
create or replace function public.get_mobile_today_pickups(p_classroom_id uuid)
returns table (
  child_id uuid,
  child_name text,
  photo_url text,
  room_name text,
  presenter_name text,
  relationship text,
  scheduled_for timestamptz,
  pickup_status text,
  checked_out_at timestamptz,
  primary_guardian_name text,
  primary_guardian_phone text,
  has_active_pass boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_daycare_id uuid;
  v_timezone text;
  v_today date;
  v_operating_room_id uuid;
begin
  select room.daycare_id, coalesce(center.timezone, 'UTC')
    into v_daycare_id, v_timezone
    from public.classrooms room
    join public.daycares center on center.id = room.daycare_id
   where room.id = p_classroom_id and room.archived_at is null;

  if v_daycare_id is null
     or v_daycare_id <> public.get_my_daycare_id()
     or not public.is_staff()
     or not public.has_permission('attendance', 'view') then
    raise exception 'You cannot view pickups for this classroom';
  end if;
  if not public.is_admin() and p_classroom_id not in (select public.my_classroom_ids()) then
    raise exception 'You are not assigned to this classroom';
  end if;

  v_today := (now() at time zone v_timezone)::date;
  v_operating_room_id := public._operating_room_id(p_classroom_id);
  return query
    select
      child.id,
      child.first_name || ' ' || child.last_name,
      child.photo_url,
      room.name,
      coalesce(plan.presenter_name, guardian.full_name, 'Pickup not set'),
      coalesce(plan.relationship, guardian_link.relationship),
      plan.scheduled_for,
      case when attendance.checked_out_at is not null then 'completed' else 'expected' end,
      attendance.checked_out_at,
      guardian.full_name,
      nullif(guardian.phone, ''),
      exists (
        select 1 from public.pickup_passes pass
         where pass.child_id = child.id
           and pass.used_at is null and pass.revoked_at is null
           and pass.expires_at > now()
      )
    from public.children child
    join public.classrooms room on room.id = child.classroom_id
    join public.attendance_records attendance
      on attendance.child_id = child.id and attendance.date = v_today
    left join lateral (
      select pickup_plan.*
        from public.pickup_plans pickup_plan
       where pickup_plan.child_id = child.id
         and pickup_plan.scheduled_on = v_today
         and pickup_plan.status in ('expected', 'completed')
       order by (pickup_plan.status = 'expected') desc, pickup_plan.created_at desc
       limit 1
    ) plan on true
    left join lateral (
      select link.*
        from public.parent_children link
       where link.child_id = child.id and link.pickup_authorized
       order by link.is_primary desc, link.created_at
       limit 1
    ) guardian_link on true
    left join public.profiles guardian on guardian.id = guardian_link.parent_id
    where child.daycare_id = v_daycare_id
      and public._operating_room_id(child.classroom_id) = v_operating_room_id
      and child.archived_at is null
      and attendance.checked_in_at is not null
      and attendance.status in ('present', 'late')
    order by (attendance.checked_out_at is not null), plan.scheduled_for nulls last,
             child.first_name, child.last_name;
end;
$$;
