-- Parent Groups 5–6 daily/weekly visibility smoke test. The rolling-week
-- fixture is created inside this transaction so it never expires or mutates
-- the shared demo family.
begin;
set local statement_timeout = '30s';

create function pg_temp.impersonate(p_role text, p_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('role', p_role, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_id, 'role', p_role)::text,
    true
  );
end;
$$;

do $$
declare
  center uuid := '10000000-0000-4000-a000-000000000001';
  owner_id uuid := '00000000-0000-4000-a000-000000000001';
  parent_id uuid := gen_random_uuid();
  room_id uuid;
  v_child_id uuid;
  v_other_child_id uuid;
  log_id uuid;
  v_week_start date := (date_trunc('week', public.center_today()) - interval '7 days')::date;
  v_day integer;
  v_meal integer;
  v_log_count integer;
  v_entry_count integer;
  v_other_children integer;
begin
  perform pg_temp.impersonate('postgres', owner_id);
  insert into public.classrooms (
    daycare_id, name, min_age_months, max_age_months, capacity,
    ratio_children_per_educator
  ) values (center, 'Rollback parent recap room', 18, 72, 8, 4)
  returning id into room_id;

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    parent_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated', 'parent-recap-' || parent_id || '@dailylog.invalid', '', now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Rollback Parent Recap"}', now(), now()
  );
  update public.profiles set role = 'parent', daycare_id = center where id = parent_id;

  insert into public.children (
    daycare_id, classroom_id, first_name, last_name, date_of_birth, enrolled_on
  ) values (
    center, room_id, 'Recap', 'Child', public.center_today() - 1200,
    v_week_start - 30
  ) returning id into v_child_id;
  insert into public.children (
    daycare_id, classroom_id, first_name, last_name, date_of_birth, enrolled_on
  ) values (
    center, room_id, 'Other', 'Family', public.center_today() - 1200,
    v_week_start - 30
  ) returning id into v_other_child_id;
  insert into public.parent_children(parent_id, child_id, relationship, is_primary)
  values (parent_id, v_child_id, 'Parent', true);

  for v_day in 0..4 loop
    insert into public.daily_logs (
      daycare_id, child_id, educator_id, log_date, moods, notes,
      sent_to_parents, sent_at
    ) values (
      center, v_child_id, owner_id, v_week_start + v_day, array['happy'],
      'Completed rollback family recap', true, now()
    ) returning id into log_id;
    for v_meal in 1..3 loop
      insert into public.meal_entries(daily_log_id, time, food_type, amount)
      values (
        log_id,
        (time '08:00' + make_interval(hours => v_meal * 2))::time,
        case v_meal when 1 then 'Morning snack' when 2 then 'Lunch' else 'Afternoon snack' end,
        'all'
      );
    end loop;
  end loop;
  insert into public.daily_logs (
    daycare_id, child_id, educator_id, log_date, sent_to_parents, sent_at
  ) values (center, v_other_child_id, owner_id, v_week_start, true, now());
  insert into public.attendance_records (
    daycare_id, child_id, date, checked_in_at, method, status
  ) values (center, v_child_id, public.center_today(), now(), 'kiosk', 'present');

  perform pg_temp.impersonate('authenticated', parent_id);
  select count(*) into v_log_count
    from public.daily_logs daily_log
   where daily_log.child_id = v_child_id
     and daily_log.log_date between v_week_start and v_week_start + 4
     and daily_log.sent_to_parents;
  if v_log_count <> 5 then
    raise exception 'FAIL: expected 5 completed prior-week logs, got %', v_log_count;
  end if;

  select count(*) into v_entry_count
    from public.meal_entries meal
    join public.daily_logs daily_log on daily_log.id = meal.daily_log_id
   where daily_log.child_id = v_child_id
     and daily_log.log_date between v_week_start and v_week_start + 4;
  if v_entry_count <> 15 then
    raise exception 'FAIL: expected 15 prior-week meal entries, got %', v_entry_count;
  end if;

  select count(*) into v_other_children
    from public.daily_logs daily_log
   where daily_log.child_id = v_other_child_id;
  if v_other_children <> 0 then
    raise exception 'FAIL: parent can read another family''s daily logs';
  end if;

  if not exists (
    select 1 from public.attendance_records attendance
     where attendance.child_id = v_child_id
       and attendance.date = public.center_today()
  ) then raise exception 'FAIL: current-day attendance state is missing'; end if;
end;
$$;

rollback;
select 'MOBILE PARENT GROUPS 5-6 TESTS: ALL PASSED' result;
