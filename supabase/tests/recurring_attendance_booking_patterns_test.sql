begin;
set local statement_timeout = '30s';

do $$
declare
  center uuid := '10000000-0000-4000-a000-000000000001';
  owner_id uuid := '00000000-0000-4000-a000-000000000001';
  educator_id uuid := '00000000-0000-4000-a000-000000000003';
  v_room_id uuid;
  v_child_id uuid;
  pattern_id uuid;
  booked_day date := current_date + 20;
  off_day date;
  weekday smallint;
begin
  while extract(isodow from booked_day) > 5 loop booked_day := booked_day + 1; end loop;
  off_day := booked_day + 1;
  weekday := extract(isodow from booked_day)::smallint;

  update public.daycares
     set timezone = 'America/Toronto', opens_at = '07:00', closes_at = '18:00'
   where id = center;
  delete from public.center_closures where daycare_id = center;

  insert into public.classrooms(daycare_id, name, capacity, ratio_children_per_educator)
  values(center, 'Rollback recurring bookings', 10, 5)
  returning id into v_room_id;

  insert into public.children(daycare_id, classroom_id, first_name, last_name, enrolled_on)
  values(center, v_room_id, 'Rollback recurring', 'Child', current_date)
  returning id into v_child_id;

  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  pattern_id := public.save_child_attendance_booking_pattern(
    v_child_id, array[weekday, weekday], '08:30', '16:30', booked_day - 7, booked_day + 30
  );
  if pattern_id is null then raise exception 'FAIL: recurring pattern did not save'; end if;
  if (select weekdays from public.child_attendance_booking_patterns where child_id = v_child_id) <> array[weekday] then
    raise exception 'FAIL: recurring weekdays were not normalized';
  end if;
  if not exists (
    select 1 from public.get_room_demand_forecast(booked_day) forecast
     where forecast.room_id = v_room_id
       and forecast.starts_at = (booked_day + time '08:30') at time zone 'America/Toronto'
       and forecast.expected_children = 1
       and forecast.unknown_bookings = 0
  ) then raise exception 'FAIL: recurring booking did not drive forecast'; end if;
  if not exists (
    select 1 from public.get_attendance_expected_children(booked_day) expected
     where expected.child_id = v_child_id and expected.chase_after = time '09:30'
  ) then raise exception 'FAIL: recurring booking did not reach attendance'; end if;
  if exists (
    select 1 from public.get_room_demand_forecast(off_day) forecast
     where forecast.room_id = v_room_id and forecast.expected_children > 0
  ) then raise exception 'FAIL: child was expected on a non-booked weekday'; end if;
  if exists (
    select 1 from public.get_attendance_expected_children(off_day) expected
     where expected.child_id = v_child_id
  ) then raise exception 'FAIL: attendance expected a child outside recurring weekdays'; end if;

  perform public.save_attendance_bookings(off_day, jsonb_build_array(
    jsonb_build_object('child_id', v_child_id, 'state', 'expected', 'arrives_at', '09:00', 'leaves_at', '15:00')
  ));
  if not exists (
    select 1 from public.get_room_demand_forecast(off_day) forecast
     where forecast.room_id = v_room_id
       and forecast.starts_at = (off_day + time '09:00') at time zone 'America/Toronto'
       and forecast.expected_children = 1
       and forecast.unknown_bookings = 0
  ) then raise exception 'FAIL: dated expected override did not replace recurring pattern'; end if;
  if not exists (
    select 1 from public.get_attendance_expected_children(off_day) expected
     where expected.child_id = v_child_id and expected.chase_after = time '09:30'
  ) then raise exception 'FAIL: dated expected override did not reach attendance'; end if;

  perform public.save_attendance_bookings(booked_day, jsonb_build_array(
    jsonb_build_object('child_id', v_child_id, 'state', 'not_scheduled', 'arrives_at', '', 'leaves_at', '')
  ));
  if exists (
    select 1 from public.get_room_demand_forecast(booked_day) forecast
     where forecast.room_id = v_room_id and forecast.expected_children > 0
  ) then raise exception 'FAIL: dated not-scheduled override did not replace recurring pattern'; end if;
  if exists (
    select 1 from public.get_attendance_expected_children(booked_day) expected
     where expected.child_id = v_child_id
  ) then raise exception 'FAIL: attendance ignored dated not-scheduled override'; end if;

  begin
    perform public.save_child_attendance_booking_pattern(v_child_id, array[weekday], '06:30', '16:00', booked_day, null);
    raise exception 'FAIL: out-of-hours recurring booking accepted';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  perform public.delete_child_attendance_booking_pattern(v_child_id);
  if exists(select 1 from public.child_attendance_booking_patterns where child_id = v_child_id) then
    raise exception 'FAIL: recurring pattern did not delete';
  end if;

  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', educator_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.save_child_attendance_booking_pattern(v_child_id, array[weekday], '08:00', '16:00', booked_day, null);
    raise exception 'FAIL: educator edited recurring bookings';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
end $$;

rollback;
select 'PASS: recurring booking patterns, dated overrides, validation and permissions; rolled back' result;
