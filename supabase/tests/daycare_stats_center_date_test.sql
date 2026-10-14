-- Run with: supabase db query --linked --file supabase/tests/daycare_stats_center_date_test.sql
-- The test child, attendance and center setting are rolled back.
begin;

create or replace function pg_temp.impersonate(p_role text, p_user uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', p_role)::text, true);
  perform set_config('role', p_role, true);
end;
$$;

do $$
declare
  v_center uuid := '10000000-0000-4000-a000-000000000001';
  v_owner uuid := '00000000-0000-4000-a000-000000000001';
  v_room uuid := '20000000-0000-4000-a000-000000000001';
  v_child uuid;
  v_before integer;
  v_after integer;
  v_today date;
begin
  perform pg_temp.impersonate('authenticated', v_owner);
  v_today := public.center_today();
  perform set_config('TimeZone', 'Pacific/Kiritimati', true);
  if current_date = v_today then
    perform set_config('TimeZone', 'Pacific/Honolulu', true);
  end if;
  if current_date = v_today then
    raise exception 'FAIL: test could not establish a different database session date';
  end if;
  v_before := (public.get_daycare_stats()->>'present_today')::integer;

  perform pg_temp.impersonate('postgres');
  update public.daycares set ratio_block_checkins = false where id = v_center;
  insert into public.children (daycare_id, classroom_id, first_name, last_name, date_of_birth, enrolled_on)
  values (v_center, v_room, 'Rollback', 'Date boundary', date '2026-01-01', v_today)
  returning id into v_child;
  insert into public.attendance_records
    (daycare_id, child_id, date, checked_in_at, checked_in_by, method, status)
  values (v_center, v_child, v_today, now(), v_owner, 'educator', 'present');

  perform pg_temp.impersonate('authenticated', v_owner);
  v_after := (public.get_daycare_stats()->>'present_today')::integer;
  if v_after <> v_before + 1 then
    raise exception 'FAIL: center-local check-in did not increment admin stats (% to %)', v_before, v_after;
  end if;
end;
$$;

rollback;
select 'PASS: admin stats use the daycare local date across session timezones' as result;
