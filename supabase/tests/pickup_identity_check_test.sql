-- Rollback-only first-time pickup ID policy and server enforcement.
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
  v_child_insert uuid;
  v_pickup uuid;
  v_pass uuid;
  v_family_payload text;
  v_blocked boolean := false;
begin
  update public.daycares set pickup_id_check_required = true where id = v_center;
  select id into v_room from public.classrooms
   where daycare_id = v_center and archived_at is null limit 1;
  if v_room is null then raise exception 'Missing test classroom'; end if;
  insert into public.children(daycare_id, classroom_id, first_name, last_name, enrolled_on)
  values(v_center, v_room, 'Identity', 'Rollback', public.center_today())
  returning id into v_child;
  insert into public.parent_children(parent_id, child_id, relationship, pickup_authorized)
  values(v_parent, v_child, 'Parent', true);
  insert into public.child_pickups(
    daycare_id, child_id, full_name, relationship, pin, approval_status
  ) values(v_center, v_child, 'New Verified Adult', 'Family friend', '9387', 'approved')
  returning id into v_pickup;
  insert into public.pickup_passes(
    daycare_id, child_id, pickup_id, presenter_name, relationship,
    token_hash, code_hash, expires_at, created_by
  ) values (
    v_center, v_child, v_pickup, 'New Verified Adult', 'Family friend',
    extensions.digest(gen_random_uuid()::text, 'sha256'),
    extensions.digest(gen_random_uuid()::text, 'sha256'),
    now() + interval '2 minutes', v_owner
  ) returning id into v_pass;

  perform pg_temp.impersonate(v_owner);
  if not public.get_mobile_pickup_id_check_requirement(v_pass) then
    raise exception 'FAIL: first-time pickup did not require ID check';
  end if;
  perform set_config('role', 'postgres', true);
  begin
    update public.pickup_passes set used_at = now(), used_by = v_owner where id = v_pass;
  exception when others then
    v_blocked := sqlerrm like '%photo ID%';
  end;
  if not v_blocked then raise exception 'FAIL: unchecked pickup pass was accepted'; end if;

  perform pg_temp.impersonate(v_parent);
  select qr_payload into v_family_payload
    from public.create_family_attendance_pass(v_child, v_pickup);
  perform pg_temp.impersonate(v_owner);
  if not exists (
    select 1 from public.redeem_family_attendance_pass(v_family_payload)
     where direction = 'checked_in'
  ) then raise exception 'FAIL: first-time pickup could not check child in'; end if;
  perform set_config('dailylog.attendance_checkout_rpc', '', true);
  v_blocked := false;
  begin
    update public.attendance_records
       set checked_out_at = now(), checked_out_by = v_owner
     where child_id = v_child and date = public.center_today();
  exception when others then
    v_blocked := sqlerrm like '%verified pickup or an audited attendance correction%';
  end;
  if not v_blocked then raise exception 'FAIL: direct checkout update bypassed workflow'; end if;
  v_blocked := false;
  begin
    perform public.kiosk_check(v_child, '9387');
  exception when others then
    v_blocked := sqlerrm like '%staff ID check%';
  end;
  if not v_blocked then raise exception 'FAIL: kiosk bypassed first-time ID check'; end if;

  perform pg_temp.impersonate(v_parent);
  select qr_payload into v_family_payload
    from public.create_family_attendance_pass(v_child, v_pickup);
  perform pg_temp.impersonate(v_owner);
  v_blocked := false;
  begin
    perform public.redeem_family_attendance_pass(v_family_payload);
  exception when others then
    v_blocked := sqlerrm like '%staff ID check%';
  end;
  if not v_blocked then raise exception 'FAIL: family QR bypassed first-time ID check'; end if;

  perform pg_temp.impersonate(v_owner);
  v_blocked := false;
  begin
    perform public.complete_mobile_pickup(v_pass);
  exception when others then
    v_blocked := sqlerrm like '%photo ID%';
  end;
  if not v_blocked then raise exception 'FAIL: live checkout bypassed first-time ID check'; end if;
  perform public.attest_mobile_pickup_id_check(v_pass);
  perform public.complete_mobile_pickup(v_pass);
  perform set_config('role', 'postgres', true);
  if public.pickup_needs_identity_check(v_center, v_pickup)
     or not exists (
       select 1 from public.attendance_records attendance
        where attendance.child_id = v_child and attendance.checked_out_at is not null
     ) then
    raise exception 'FAIL: completed checked pickup was not remembered';
  end if;
  -- An RPC request ends its transaction after checkout; reset the local
  -- marker to model a second direct API request within this rollback test.
  perform set_config('dailylog.attendance_checkout_rpc', '', true);
  v_blocked := false;
  insert into public.children(daycare_id, classroom_id, first_name, last_name, enrolled_on)
  values(v_center, v_room, 'Direct insert', 'Rollback', public.center_today())
  returning id into v_child_insert;
  begin
    insert into public.attendance_records(
      daycare_id, child_id, date, checked_in_at, checked_in_by,
      checked_out_at, checked_out_by, method, status
    ) values (
      v_center, v_child_insert, public.center_today(), now() - interval '1 hour',
      v_owner, now(), v_owner, 'educator', 'present'
    );
  exception when others then
    v_blocked := sqlerrm like '%verified pickup or an audited attendance correction%';
  end;
  if not v_blocked then raise exception 'FAIL: pre-completed attendance insert bypassed workflow'; end if;
  v_blocked := false;
  begin
    update public.attendance_records set checked_out_at = null
     where child_id = v_child and date = public.center_today();
  exception when others then
    v_blocked := sqlerrm like '%verified pickup or an audited attendance correction%';
  end;
  if not v_blocked then raise exception 'FAIL: direct checkout reversal bypassed workflow'; end if;

  insert into public.pickup_passes(
    daycare_id, child_id, pickup_id, presenter_name, relationship,
    token_hash, code_hash, expires_at, created_by
  ) values (
    v_center, v_child, v_pickup, 'New Verified Adult', 'Family friend',
    extensions.digest(gen_random_uuid()::text, 'sha256'),
    extensions.digest(gen_random_uuid()::text, 'sha256'),
    now() + interval '2 minutes', v_owner
  ) returning id into v_pass;
  update public.child_pickups set approval_status = 'pending' where id = v_pickup;
  v_blocked := false;
  begin
    update public.pickup_passes set used_at = now(), used_by = v_owner where id = v_pass;
  exception when others then
    v_blocked := sqlerrm like '%no longer approved%';
  end;
  if not v_blocked then raise exception 'FAIL: revoked approval did not block pass use'; end if;
  v_blocked := false;
  begin
    insert into public.pickup_passes(
      daycare_id, child_id, pickup_id, presenter_name, relationship,
      token_hash, code_hash, expires_at, created_by
    ) values (
      v_center, v_child, v_pickup, 'New Verified Adult', 'Family friend',
      extensions.digest(gen_random_uuid()::text, 'sha256'),
      extensions.digest(gen_random_uuid()::text, 'sha256'),
      now() + interval '2 minutes', v_owner
    );
  exception when others then
    v_blocked := sqlerrm like '%not approved%';
  end;
  if not v_blocked then raise exception 'FAIL: pending pickup received a new pass'; end if;
end $$;

rollback;
select 'PASS: first-time ID checks and approval boundaries enforced across pickup paths; rolled back' result;
