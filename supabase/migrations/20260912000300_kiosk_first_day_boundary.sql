-- The door kiosk is a security-definer surface, so it needs the same first-day
-- boundary as educator roster queries instead of relying on child RLS.

create or replace function public.kiosk_lookup_pin(p_pin text)
returns table (
  pickup_name text, child_id uuid, first_name text, last_name text,
  room_name text, checked_in_at timestamptz, checked_out_at timestamptz
)
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.has_permission('attendance', 'edit') then raise exception 'Attendance permission required'; end if;
  perform public.assert_rate_limit('kiosk_pin_lookup', 30, 60, public.get_my_daycare_id()::text);
  return query
    select cp.full_name, child.id, child.first_name, child.last_name, room.name,
           attendance.checked_in_at, attendance.checked_out_at
      from public.child_pickups cp
      join public.children child on child.id = cp.child_id and child.archived_at is null
      left join public.classrooms room on room.id = child.classroom_id
      left join public.attendance_records attendance
        on attendance.child_id = child.id and attendance.date = public.center_today()
     where cp.pin = btrim(p_pin)
       and cp.archived_at is null
       and cp.approval_status = 'approved'
       and cp.daycare_id = public.get_my_daycare_id()
       and coalesce(child.enrolled_on, '-infinity'::date) <= public.center_today();
end;
$$;

create or replace function public.kiosk_check(p_child_id uuid, p_pin text)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_pickup public.child_pickups%rowtype;
  v_record public.attendance_records%rowtype;
  v_today date := public.center_today();
  v_enrolled_on date;
begin
  if not public.has_permission('attendance', 'edit') then raise exception 'Attendance permission required'; end if;
  perform public.assert_rate_limit('kiosk_pin_redeem', 30, 60, public.get_my_daycare_id()::text);

  select child.enrolled_on into v_enrolled_on
    from public.children child
   where child.id = p_child_id
     and child.daycare_id = public.get_my_daycare_id()
     and child.archived_at is null;
  if not found then raise exception 'Child not found'; end if;
  if v_enrolled_on is not null and v_today < v_enrolled_on then
    raise exception 'Check-in becomes available on the enrollment start date';
  end if;

  select * into v_pickup from public.child_pickups
   where pin = btrim(p_pin)
     and child_id = p_child_id
     and archived_at is null
     and approval_status = 'approved'
     and daycare_id = public.get_my_daycare_id();
  if v_pickup.id is null then raise exception 'PIN does not match an approved pickup for this child'; end if;

  select * into v_record from public.attendance_records
   where child_id = p_child_id and date = v_today;
  if v_record.id is null or v_record.checked_in_at is null then
    insert into public.attendance_records (
      daycare_id, child_id, date, checked_in_at, method, status, dropped_off_by
    ) values (
      v_pickup.daycare_id, p_child_id, v_today, now(), 'kiosk', 'present', v_pickup.full_name
    ) on conflict (child_id, date) do update
      set checked_in_at = now(), method = 'kiosk', status = 'present',
          dropped_off_by = v_pickup.full_name, checked_out_at = null, checked_out_by = null;
    return 'checked_in';
  end if;
  if v_record.checked_out_at is null then
    update public.attendance_records set checked_out_at = now(), picked_up_by = v_pickup.full_name,
      method = 'kiosk' where id = v_record.id;
    return 'checked_out';
  end if;
  update public.attendance_records set checked_in_at = now(), checked_out_at = null,
    dropped_off_by = v_pickup.full_name, method = 'kiosk' where id = v_record.id;
  return 'checked_in';
end;
$$;

revoke all on function public.kiosk_lookup_pin(text) from public, anon;
revoke all on function public.kiosk_check(uuid, text) from public, anon;
grant execute on function public.kiosk_lookup_pin(text) to authenticated;
grant execute on function public.kiosk_check(uuid, text) to authenticated;

notify pgrst, 'reload schema';
