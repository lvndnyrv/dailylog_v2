-- Advisory staffing checks only; every fixture and side effect rolls back.
begin;
set local statement_timeout = '30s';
do $$
declare
  center uuid := '10000000-0000-4000-a000-000000000001';
  owner_id uuid := '00000000-0000-4000-a000-000000000001';
  educator_id uuid := gen_random_uuid();
  source_room uuid;
  target_room uuid;
  child_id uuid;
  plan_id uuid;
  member_id uuid;
  day date;
  opens time;
  closes time;
  zone text;
  result record;
begin
  select (now() at time zone timezone)::date + 7, opens_at, closes_at, timezone
    into day, opens, closes, zone from public.daycares where id = center;
  while extract(isodow from day) > 5 or exists (
    select 1 from public.staff_shifts existing
     where existing.daycare_id = center and existing.status = 'published'
       and existing.starts_at < (day + closes) at time zone zone
       and existing.ends_at > (day + opens) at time zone zone
  ) loop
    day := day + 1;
    if day > (now() at time zone zone)::date + 90 then
      raise exception 'No unscheduled test day in the forecast window';
    end if;
  end loop;
  delete from public.center_closures where daycare_id = center and day between starts_on and ends_on;
  insert into public.classrooms(daycare_id, name, capacity, ratio_children_per_educator, min_age_months, max_age_months)
    values(center, 'Rollback staffing source', 10, 2, 0, 120) returning id into source_room;
  insert into public.classrooms(daycare_id, name, capacity, ratio_children_per_educator, min_age_months, max_age_months)
    values(center, 'Rollback staffing destination', 10, 1, 0, 120) returning id into target_room;
  insert into public.children(daycare_id, classroom_id, first_name, last_name, enrolled_on, date_of_birth)
    values(center, source_room, 'Rollback', 'Move', day - 100, day - interval '4 years') returning id into child_id;
  insert into public.room_transition_plans(daycare_id, child_id, from_classroom_id, to_classroom_id, move_on, transition_week)
    values(center, child_id, source_room, target_room, day, false) returning id into plan_id;
  insert into public.child_attendance_bookings(child_id, daycare_id, booked_on, expected, arrives_at, leaves_at)
    values(child_id, center, day, true, opens, closes);

  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select * into result from public.get_room_transition_staffing_review(plan_id);
  if result.status <> 'unknown' then raise exception 'Unpublished day was treated as a confirmed gap'; end if;

  perform set_config('role', 'postgres', true);
  insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values(educator_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'rollback-transition-' || educator_id || '@dailylog.invalid', '', now(),
    '{"provider":"email","providers":["email"]}', '{"full_name":"Rollback transition educator"}', now(), now());
  update public.profiles set role = 'educator', daycare_id = center, classroom_id = source_room where id = educator_id;
  insert into public.staff_members(daycare_id, profile_id, status, background_check_required)
    values(center, educator_id, 'active', false) returning id into member_id;
  insert into public.staff_shifts(daycare_id, staff_member_id, classroom_id, starts_at, ends_at, status, unpaid_break_minutes)
    values(center, member_id, source_room, (day + opens) at time zone zone,
      (day + closes) at time zone zone, 'published', 0);
  perform set_config('role', 'authenticated', true);
  select * into result from public.get_room_transition_staffing_review(plan_id);
  if result.status <> 'gap' or result.maximum_shortfall <> 1 then
    raise exception 'Move-day destination gap was not detected: %', result.status;
  end if;

  perform set_config('role', 'postgres', true);
  update public.staff_shifts set classroom_id = target_room where staff_member_id = member_id;
  perform set_config('role', 'authenticated', true);
  select * into result from public.get_room_transition_staffing_review(plan_id);
  if result.status <> 'covered' then raise exception 'Published destination shift did not cover the move: %', result.status; end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', educator_id, 'role', 'authenticated')::text, true);
  begin
    perform public.get_room_transition_staffing_review(plan_id);
    raise exception 'Educator accessed administrator move review';
  exception when others then
    if sqlerrm = 'Educator accessed administrator move review' then raise; end if;
  end;
  raise notice 'PASS: no schedule stays unknown, uncovered move warns, destination shift covers, and educator cannot read review';
end;
$$;
rollback;
