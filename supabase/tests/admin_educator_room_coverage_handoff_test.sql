-- Cross-app invariant: a pending invitation is visible but not operational,
-- accepted coverage becomes active educator access, one routed notification is
-- sent, and active/pending reservations cannot overlap.

begin;

do $$
declare
  v_daycare uuid := '10000000-0000-4000-a000-000000000001';
  v_profile uuid := '00000000-0000-4000-a000-000000000007';
  v_room uuid := '20000000-0000-4000-a000-000000000003';
  v_staff uuid;
  v_assignment uuid;
  v_blocked boolean := false;
begin
  select staff.id into v_staff
    from public.staff_members staff
   where staff.profile_id = v_profile;

  insert into public.room_coverage_assignments (
    daycare_id, classroom_id, staff_member_id, starts_at, ends_at,
    status, notes
  ) values (
    v_daycare, v_room, v_staff, now() - interval '5 minutes',
    now() + interval '55 minutes', 'assigned', 'Integration coverage handoff'
  ) returning id into v_assignment;

  perform set_config('request.jwt.claim.sub', v_profile::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;

  if v_room in (select public.my_classroom_ids()) then
    raise exception 'FAIL: pending invitation granted classroom access before acceptance';
  end if;
  if public.can_write_child('30000000-0000-4000-a000-000000000002') then
    raise exception 'FAIL: pending invitation granted child write access before acceptance';
  end if;

  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);

  if not exists (
    select 1 from public.notifications notification
     where notification.profile_id = v_profile
       and notification.kind = 'coverage_assignment'
       and notification.payload ->> 'assignmentId' = v_assignment::text
  ) then
    raise exception 'FAIL: educator coverage notification was not created';
  end if;

  update public.room_coverage_assignments
     set status = 'accepted'
   where id = v_assignment;

  perform set_config('request.jwt.claim.sub', v_profile::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;

  if v_room not in (select public.my_classroom_ids()) then
    raise exception 'FAIL: accepted coverage did not grant classroom access';
  end if;
  if not public.can_write_child('30000000-0000-4000-a000-000000000002') then
    raise exception 'FAIL: accepted coverage did not grant operational child access';
  end if;

  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);

  begin
    insert into public.room_coverage_assignments (
      daycare_id, classroom_id, staff_member_id, starts_at, ends_at, status
    ) values (
      v_daycare, '20000000-0000-4000-a000-000000000002', v_staff,
      now() + interval '30 minutes', now() + interval '90 minutes', 'assigned'
    );
  exception when exclusion_violation then
    v_blocked := true;
  end;

  if not v_blocked then
    raise exception 'FAIL: overlapping room coverage was accepted';
  end if;

  raise notice 'PASS: invitation boundary, accepted access, notification, and overlap guard are intact';
end;
$$;

rollback;
