-- Cross-app payroll invariant: admin/manual entries cannot overlap an
-- educator's existing time, so mobile and web totals stay identical.

begin;

do $$
declare
  v_staff uuid;
  v_daycare uuid;
  v_first uuid;
  v_blocked boolean := false;
  v_start timestamptz := date_trunc('day', now()) + interval '10 years';
begin
  select staff.id, staff.daycare_id
    into v_staff, v_daycare
    from public.staff_members staff
   where staff.profile_id = '00000000-0000-4000-a000-000000000003';

  -- A live timer intentionally spans into the future. Close it inside this
  -- rollback-only test so the assertion can isolate two manual entries.
  update public.staff_time_entries
     set clocked_out_at = now(), status = 'submitted'
   where staff_member_id = v_staff
     and clocked_out_at is null;

  insert into public.staff_time_entries (
    daycare_id, staff_member_id, clocked_in_at, clocked_out_at,
    break_minutes, source, status
  ) values (
    v_daycare, v_staff, v_start, v_start + interval '8 hours',
    30, 'manual', 'submitted'
  ) returning id into v_first;

  begin
    insert into public.staff_time_entries (
      daycare_id, staff_member_id, clocked_in_at, clocked_out_at,
      break_minutes, source, status
    ) values (
      v_daycare, v_staff, v_start + interval '4 hours', v_start + interval '9 hours',
      0, 'manual', 'submitted'
    );
  exception when exclusion_violation then
    v_blocked := true;
  end;

  if not v_blocked then
    raise exception 'FAIL: overlapping staff time entries were accepted';
  end if;

  raise notice 'PASS: overlapping staff time entries are rejected';
end;
$$;

rollback;
