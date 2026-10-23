-- Rollback-only kiosk audit and post-checkout immutability.
begin;

create or replace function pg_temp.impersonate(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

do $$
declare
  v_owner uuid := '00000000-0000-4000-a000-000000000001';
  v_center uuid := '10000000-0000-4000-a000-000000000001';
  v_room uuid;
  v_child uuid;
  v_record public.attendance_records%rowtype;
  v_failed boolean := false;
begin
  -- This test covers kiosk signatures, not first-time pickup ID policy.
  update public.daycares set pickup_id_check_required = false where id = v_center;
  select id into v_room from public.classrooms
   where daycare_id = v_center and archived_at is null limit 1;
  if v_room is null then raise exception 'Missing Group 8 test room'; end if;
  insert into public.children(daycare_id, classroom_id, first_name, last_name, enrolled_on)
  values(v_center, v_room, 'Kiosk signed', 'Rollback', public.center_today())
  returning id into v_child;
  insert into public.child_pickups(
    daycare_id, child_id, full_name, relationship, pin, approval_status
  ) values(v_center, v_child, 'Verified Adult', 'Parent', '8643', 'approved');

  perform pg_temp.impersonate(v_owner);
  if not exists (
    select 1 from public.kiosk_lookup_pin('8643') where child_id = v_child
  ) then raise exception 'FAIL: approved pickup not available to kiosk'; end if;
  if public.kiosk_check(v_child, '8643') <> 'checked_in' then
    raise exception 'FAIL: kiosk check-in failed';
  end if;
  select * into v_record from public.attendance_records
   where child_id = v_child and date = public.center_today();
  if v_record.checked_in_by <> v_owner
     or v_record.dropped_off_by <> 'Verified Adult' then
    raise exception 'FAIL: check-in did not retain staff signature and adult';
  end if;

  if public.kiosk_check(v_child, '8643') <> 'checked_out' then
    raise exception 'FAIL: kiosk check-out failed';
  end if;
  select * into v_record from public.attendance_records
   where child_id = v_child and date = public.center_today();
  if v_record.checked_out_by <> v_owner
     or v_record.picked_up_by <> 'Verified Adult'
     or v_record.checked_out_at is null then
    raise exception 'FAIL: check-out did not retain staff signature and adult';
  end if;
  begin
    perform public.kiosk_check(v_child, '8643');
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: kiosk rewrote a completed day'; end if;
  if not exists (
    select 1 from public.attendance_records
     where id = v_record.id
       and checked_in_at = v_record.checked_in_at
       and checked_out_at = v_record.checked_out_at
  ) then raise exception 'FAIL: completed attendance times changed'; end if;
end $$;

rollback;
select 'PASS: kiosk retains both signatures and refuses same-day overwrite; rolled back' result;
