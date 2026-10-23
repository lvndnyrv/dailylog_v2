-- Rollback-only end-to-end family attendance QR security test.
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
  v_parent uuid := '00000000-0000-4000-a000-000000000023';
  v_center uuid := '10000000-0000-4000-a000-000000000001';
  v_room uuid;
  v_child uuid;
  v_pickup uuid;
  v_first text;
  v_second text;
  v_checkout text;
  v_expired text;
  v_record public.attendance_records%rowtype;
  v_failed boolean;
  v_error text;
begin
  -- This test covers QR signing/replay. The first-time pickup ID rule has a
  -- dedicated test and is disabled here so checkout exercises the QR path.
  update public.daycares set pickup_id_check_required = false where id = v_center;
  select id into v_room from public.classrooms
   where daycare_id = v_center and archived_at is null limit 1;
  insert into public.children(daycare_id, classroom_id, first_name, last_name, enrolled_on)
  values(v_center, v_room, 'QR signed', 'Rollback', public.center_today())
  returning id into v_child;
  insert into public.parent_children(parent_id, child_id, relationship, pickup_authorized)
  values(v_parent, v_child, 'Parent', true);
  insert into public.child_pickups(daycare_id, child_id, full_name, relationship, pin, approval_status)
  values(v_center, v_child, 'Approved Grandparent', 'Grandparent', '9463', 'approved')
  returning id into v_pickup;

  perform pg_temp.impersonate(v_owner);
  v_failed := false;
  begin perform public.create_family_attendance_pass(v_child, v_pickup);
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: non-parent issued a family QR'; end if;

  perform pg_temp.impersonate(v_parent);
  select qr_payload into v_first from public.create_family_attendance_pass(v_child, v_pickup);
  if v_first !~ '^DL-ATT-1:[0-9a-f]{64}$' then
    raise exception 'FAIL: malformed QR payload';
  end if;
  select qr_payload into v_second from public.create_family_attendance_pass(v_child, v_pickup);
  if v_first = v_second then raise exception 'FAIL: pass was reused'; end if;

  perform pg_temp.impersonate(v_owner);
  v_failed := false;
  begin perform public.redeem_family_attendance_pass(v_first);
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: revoked pass was accepted'; end if;
  if not exists (
    select 1 from public.redeem_family_attendance_pass(v_second)
     where direction = 'checked_in' and presenter_name = 'Approved Grandparent'
  ) then raise exception 'FAIL: valid QR did not check in'; end if;
  select * into v_record from public.attendance_records
   where child_id = v_child and date = public.center_today();
  if v_record.checked_in_by <> v_owner or v_record.dropped_off_by <> 'Approved Grandparent'
     or v_record.method <> 'kiosk' then
    raise exception 'FAIL: check-in did not retain recorder and approved adult';
  end if;
  v_failed := false;
  begin perform public.redeem_family_attendance_pass(v_second);
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: replayed QR was accepted'; end if;

  perform pg_temp.impersonate(v_parent);
  select qr_payload into v_checkout from public.create_family_attendance_pass(v_child, v_pickup);
  perform pg_temp.impersonate(v_owner);
  if not exists (
    select 1 from public.redeem_family_attendance_pass(v_checkout)
     where direction = 'checked_out' and presenter_name = 'Approved Grandparent'
  ) then raise exception 'FAIL: valid QR did not check out'; end if;
  select * into v_record from public.attendance_records
   where child_id = v_child and date = public.center_today();
  if v_record.checked_out_by <> v_owner or v_record.picked_up_by <> 'Approved Grandparent'
     or v_record.checked_out_at is null then
    raise exception 'FAIL: checkout signature was lost'; end if;

  perform pg_temp.impersonate(v_parent);
  select qr_payload into v_checkout from public.create_family_attendance_pass(v_child, v_pickup);
  perform pg_temp.impersonate(v_owner);
  v_failed := false;
  begin perform public.redeem_family_attendance_pass(v_checkout);
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: completed day was overwritten'; end if;
  if not exists (
    select 1 from public.attendance_records
     where id = v_record.id and checked_in_at = v_record.checked_in_at
       and checked_out_at = v_record.checked_out_at
  ) then raise exception 'FAIL: completed attendance times changed'; end if;

  perform pg_temp.impersonate(v_parent);
  select qr_payload into v_expired from public.create_family_attendance_pass(v_child, v_pickup);
  perform set_config('role', 'postgres', true);
  update public.family_attendance_passes
     set expires_at = now() - interval '1 second'
   where token_hash = extensions.digest(substring(v_expired from 10), 'sha256');
  perform pg_temp.impersonate(v_owner);
  v_failed := false;
  begin perform public.redeem_family_attendance_pass(v_expired);
  exception when others then v_failed := true; v_error := sqlerrm; end;
  if not v_failed or v_error not like '%expired or already used%' then
    raise exception 'FAIL: expired QR was not rejected for expiry: %', v_error;
  end if;

  perform pg_temp.impersonate(v_parent);
  select qr_payload into v_expired from public.create_family_attendance_pass(v_child, v_pickup);
  perform pg_temp.impersonate(v_owner);
  update public.child_pickups set approval_status = 'rejected' where id = v_pickup;
  v_failed := false;
  begin perform public.redeem_family_attendance_pass(v_expired);
  exception when others then v_failed := true; v_error := sqlerrm; end;
  if not v_failed or v_error not like '%no longer approved%' then
    raise exception 'FAIL: revoked adult QR was not rejected: %', v_error;
  end if;
end $$;

rollback;
select 'PASS: family QR is child-scoped, revocable, one-use and signed; rolled back' result;
