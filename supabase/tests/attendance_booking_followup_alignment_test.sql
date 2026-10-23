-- Rollback-only Group 8 no-show eligibility. Nothing is delivered or retained.
begin;
set local statement_timeout = '60s';

do $$
declare
  v_center uuid := '10000000-0000-4000-a000-000000000001';
  v_room uuid;
  v_offset integer;
  v_timezone text;
  v_today date;
  v_due uuid;
  v_off uuid;
  v_later uuid;
  v_future uuid;
begin
  select id into v_room from public.classrooms
   where daycare_id = v_center and archived_at is null limit 1;
  if v_room is null then raise exception 'Missing Group 8 test room'; end if;

  -- Place this rollback fixture at 12:xx center-local regardless of UTC hour.
  v_offset := 12 - extract(hour from now() at time zone 'UTC')::integer;
  if v_offset > 11 then v_offset := v_offset - 24; end if;
  if v_offset < -12 then v_offset := v_offset + 24; end if;
  v_timezone := case
    when v_offset = 0 then 'Etc/GMT'
    when v_offset > 0 then 'Etc/GMT-' || v_offset
    else 'Etc/GMT+' || abs(v_offset)
  end;
  update public.daycares
     set timezone = v_timezone
   where id = v_center;
  v_today := (now() at time zone v_timezone)::date;
  delete from public.center_closures
   where daycare_id = v_center and v_today between starts_on and ends_on;

  insert into public.children(daycare_id, classroom_id, first_name, last_name, enrolled_on)
  values(v_center, v_room, 'Due booking', 'Rollback', v_today)
  returning id into v_due;
  insert into public.children(daycare_id, classroom_id, first_name, last_name, enrolled_on)
  values(v_center, v_room, 'Not scheduled', 'Rollback', v_today)
  returning id into v_off;
  insert into public.children(daycare_id, classroom_id, first_name, last_name, enrolled_on)
  values(v_center, v_room, 'Later arrival', 'Rollback', v_today)
  returning id into v_later;
  insert into public.children(daycare_id, classroom_id, first_name, last_name, enrolled_on)
  values(v_center, v_room, 'Future starter', 'Rollback', v_today + 1)
  returning id into v_future;

  insert into public.child_attendance_bookings(
    daycare_id, child_id, booked_on, expected, arrives_at, leaves_at
  ) values
    (v_center, v_due, v_today, true, time '08:30', time '17:00'),
    (v_center, v_off, v_today, false, null, null),
    (v_center, v_later, v_today, true, time '15:00', time '17:00'),
    (v_center, v_future, v_today, true, time '08:30', time '17:00');

  if not exists (
    select 1 from public._attendance_expected_children(v_center, v_today)
     where child_id = v_due and chase_after = time '09:30'
  ) then raise exception 'FAIL: due booking missing from expected list'; end if;
  if exists (
    select 1 from public._attendance_expected_children(v_center, v_today)
     where child_id in (v_off, v_future)
  ) then raise exception 'FAIL: unbooked or pre-start child expected'; end if;
  if not exists (
    select 1 from public._attendance_expected_children(v_center, v_today)
     where child_id = v_later and chase_after = time '15:10'
  ) then raise exception 'FAIL: later arrival lost its grace time'; end if;

  perform public.process_due_attendance_followups();
  if not exists (
    select 1 from public.attendance_followups
     where child_id = v_due and attendance_date = v_today
  ) then raise exception 'FAIL: due booking was not chased'; end if;
  if exists (
    select 1 from public.attendance_followups
     where child_id in (v_off, v_later, v_future)
       and attendance_date = v_today
  ) then raise exception 'FAIL: not-due child was chased'; end if;
end $$;

rollback;
select 'PASS: dated bookings, later arrivals and first-day guard align with no-show worker; rolled back' result;
