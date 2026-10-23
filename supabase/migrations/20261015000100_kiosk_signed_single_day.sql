-- A kiosk session represents one sign-in/out interval per child and day.
-- Re-entering after checkout must not overwrite the first signed interval.
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
  if auth.uid() is null or not public.is_staff()
     or not public.has_permission('attendance', 'edit') then
    raise exception 'Staff attendance permission required';
  end if;
  perform public.assert_rate_limit('kiosk_pin_redeem', 30, 60, public.get_my_daycare_id()::text);
  perform pg_advisory_xact_lock(hashtextextended(
    'kiosk:' || p_child_id::text || ':' || v_today::text, 0
  ));

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
  if v_pickup.id is null then
    raise exception 'PIN does not match an approved pickup for this child';
  end if;

  select * into v_record from public.attendance_records
   where child_id = p_child_id and date = v_today
   for update;
  if v_record.checked_out_at is not null then
    raise exception 'This child was already checked out today; ask staff to review the attendance record';
  end if;
  if v_record.id is null or v_record.checked_in_at is null then
    insert into public.attendance_records (
      daycare_id, child_id, date, checked_in_at, checked_in_by,
      method, status, dropped_off_by
    ) values (
      v_pickup.daycare_id, p_child_id, v_today, now(), auth.uid(),
      'kiosk', 'present', v_pickup.full_name
    ) on conflict (child_id, date) do update
      set checked_in_at = now(), checked_in_by = auth.uid(),
          method = 'kiosk', status = 'present',
          dropped_off_by = v_pickup.full_name,
          checked_out_at = null, checked_out_by = null, picked_up_by = null;
    return 'checked_in';
  end if;

  update public.attendance_records
     set checked_out_at = now(), checked_out_by = auth.uid(),
         picked_up_by = v_pickup.full_name, method = 'kiosk'
   where id = v_record.id;
  return 'checked_out';
end;
$$;

revoke all on function public.kiosk_check(uuid,text) from public, anon;
grant execute on function public.kiosk_check(uuid,text) to authenticated;

notify pgrst, 'reload schema';
