-- Cross-app invariant: an admin can publish a regular schedule, the educator
-- sees only their published shifts, and schedule editing stays admin-only.

begin;

create or replace function pg_temp.impersonate(p_role text, p_user_id uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('role', p_role, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id, 'role', p_role)::text,
    true
  );
end;
$$;

do $$
declare
  v_owner uuid := '00000000-0000-4000-a000-000000000001';
  v_educator uuid := '00000000-0000-4000-a000-000000000003';
  v_member uuid := 'b79bdbdd-fbe3-4e5f-99b0-448a868a94ad';
  v_other_member uuid := '9504ddb7-b865-4cc3-aea1-2d00cf58c2c7';
  v_daycare uuid := '10000000-0000-4000-a000-000000000001';
  v_generated integer;
  v_count integer;
begin
  perform pg_temp.impersonate('authenticated', v_owner);
  v_generated := public.save_staff_regular_schedule(
    v_member,
    jsonb_build_array(
      jsonb_build_object(
        'weekday', 1,
        'starts_local', '07:30',
        'ends_local', '15:30',
        'unpaid_break_minutes', 30,
        'classroom_id', null
      ),
      jsonb_build_object(
        'weekday', 3,
        'starts_local', '08:00',
        'ends_local', '16:00',
        'unpaid_break_minutes', 30,
        'classroom_id', null
      )
    )
  );

  if v_generated < 1 then
    raise exception 'FAIL: regular schedule did not publish any upcoming shifts';
  end if;

  insert into public.staff_shifts (
    daycare_id, staff_member_id, starts_at, ends_at, status, created_by
  ) values (
    v_daycare, v_member, now() + interval '100 days', now() + interval '100 days 8 hours', 'draft', v_owner
  ), (
    v_daycare, v_other_member, now() + interval '101 days', now() + interval '101 days 8 hours', 'published', v_owner
  );

  perform pg_temp.impersonate('authenticated', v_educator);
  select count(*) into v_count
    from public.staff_regular_schedules schedule
   where schedule.staff_member_id = v_member;
  if v_count <> 2 then
    raise exception 'FAIL: educator cannot read their saved regular schedule';
  end if;

  if not exists (
    select 1
      from public.staff_shifts shift
     where shift.staff_member_id = v_member
       and shift.regular_schedule_id is not null
       and shift.status = 'published'
  ) then
    raise exception 'FAIL: educator cannot read their published generated shifts';
  end if;

  if exists (
    select 1
      from public.staff_shifts shift
     where (shift.staff_member_id = v_member and shift.status = 'draft')
        or shift.staff_member_id = v_other_member
  ) then
    raise exception 'FAIL: educator can see a draft or another educator shift';
  end if;

  if not exists (
    select 1
      from public.notifications notification
     where notification.profile_id = v_educator
       and notification.kind = 'schedule_update'
       and notification.payload ->> 'screen' = 'MyTime'
  ) then
    raise exception 'FAIL: educator did not receive a routable schedule update';
  end if;

  begin
    perform public.save_staff_regular_schedule(v_member, '[]'::jsonb);
    raise exception 'FAIL: educator changed their own published schedule';
  exception
    when raise_exception then
      if sqlerrm = 'FAIL: educator changed their own published schedule' then
        raise;
      end if;
  end;

  raise notice 'PASS: schedule publishing, educator visibility, and edit authority are intact';
end;
$$;

rollback;

select 'ADMIN/EDUCATOR STAFF SCHEDULE HANDOFF TESTS: ALL PASSED' as result;
