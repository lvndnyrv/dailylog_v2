-- Application fit checks use dated capacity, age and published staffing data.
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
  educator_id uuid := gen_random_uuid();
  parent_id uuid := gen_random_uuid();
  member_id uuid;
  room_id uuid;
  child_id uuid;
  second_child_id uuid;
  enrollment_id uuid;
  day date;
  opens time;
  closes time;
  zone text;
  fit record;
begin
  perform pg_temp.impersonate('postgres', owner_id);
  select public.center_today() + 14, opens_at, closes_at, timezone
    into day, opens, closes, zone
    from public.daycares where id = center;
  while extract(isodow from day) not between 1 and 5 loop day := day + 1; end loop;
  delete from public.center_closures
   where daycare_id = center and day between starts_on and ends_on;

  insert into public.classrooms (
    daycare_id, name, min_age_months, max_age_months, capacity,
    ratio_children_per_educator, opens_on
  ) values (
    center, 'Rollback application fit room', 18, 72, 3, 2, day
  ) returning id into room_id;

  insert into public.children (
    daycare_id, classroom_id, first_name, last_name, date_of_birth, enrolled_on
  ) values (
    center, room_id, 'Existing', 'Child', (day - interval '3 years')::date, day - 100
  ) returning id into child_id;
  insert into public.child_attendance_bookings (
    child_id, daycare_id, booked_on, expected, arrives_at, leaves_at
  ) values (child_id, center, day, true, opens, closes);

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    educator_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated', 'fit-educator-' || educator_id || '@dailylog.invalid', '', now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Rollback Fit Educator"}', now(), now()
  );
  update public.profiles
     set role = 'educator', daycare_id = center, classroom_id = room_id
   where id = educator_id;
  insert into public.staff_members (
    daycare_id, profile_id, job_title, status, background_check_required
  ) values (
    center, educator_id, 'Rollback educator', 'active', false
  ) returning id into member_id;
  insert into public.staff_shifts (
    daycare_id, staff_member_id, classroom_id, starts_at, ends_at,
    status, unpaid_break_minutes, published_at
  ) values (
    center, member_id, room_id,
    (day + opens) at time zone zone,
    (day + closes) at time zone zone,
    'published', 0, now()
  );

  insert into public.enrollments (
    daycare_id, classroom_id, child_first_name, child_last_name,
    child_date_of_birth, guardian_name, guardian_email, stage,
    desired_start_date, application_progress
  ) values (
    center, room_id, 'Applicant', 'Child', (day - interval '3 years')::date,
    'Fit Check Family', 'fit-family@dailylog.invalid', 'application', day, 100
  ) returning id into enrollment_id;

  perform pg_temp.impersonate('authenticated', owner_id);
  select * into fit from public.get_enrollment_fit_check(enrollment_id);
  if fit.age_status <> 'pass' or fit.capacity_status <> 'pass'
     or fit.staffing_status <> 'pass' then
    raise exception 'FAIL: valid fit was not all-pass: %, %, %',
      fit.age_status, fit.capacity_status, fit.staffing_status;
  end if;
  if fit.projected_children_before <> 1 or fit.projected_children_after <> 2 then
    raise exception 'FAIL: dated occupancy was % before / % after, expected 1 / 2',
      fit.projected_children_before, fit.projected_children_after;
  end if;

  -- A sent offer already holds its own place; the fit preview must not count it twice.
  perform pg_temp.impersonate('postgres', owner_id);
  update public.enrollments
     set stage = 'offer', offer_status = 'sent', offer_expires_at = now() + interval '2 days'
   where id = enrollment_id;
  perform pg_temp.impersonate('authenticated', owner_id);
  select * into fit from public.get_enrollment_fit_check(enrollment_id);
  if fit.projected_children_before <> 1 or fit.projected_children_after <> 2 then
    raise exception 'FAIL: current offer hold was double-counted: % / %',
      fit.projected_children_before, fit.projected_children_after;
  end if;

  perform pg_temp.impersonate('postgres', owner_id);
  update public.enrollments set stage = 'application', offer_status = 'draft' where id = enrollment_id;
  update public.classrooms set capacity = 1 where id = room_id;
  perform pg_temp.impersonate('authenticated', owner_id);
  select * into fit from public.get_enrollment_fit_check(enrollment_id);
  if fit.capacity_status <> 'fail' then
    raise exception 'FAIL: full dated room reported %', fit.capacity_status;
  end if;

  perform pg_temp.impersonate('postgres', owner_id);
  update public.classrooms set capacity = 4 where id = room_id;
  update public.enrollments
     set child_date_of_birth = (day - interval '8 years')::date
   where id = enrollment_id;
  perform pg_temp.impersonate('authenticated', owner_id);
  select * into fit from public.get_enrollment_fit_check(enrollment_id);
  if fit.age_status <> 'fail' then
    raise exception 'FAIL: out-of-band child reported %', fit.age_status;
  end if;

  perform pg_temp.impersonate('postgres', owner_id);
  update public.enrollments
     set child_date_of_birth = (day - interval '3 years')::date
   where id = enrollment_id;
  insert into public.children (
    daycare_id, classroom_id, first_name, last_name, date_of_birth, enrolled_on
  ) values (
    center, room_id, 'Second', 'Child', (day - interval '3 years')::date, day - 100
  ) returning id into second_child_id;
  insert into public.child_attendance_bookings (
    child_id, daycare_id, booked_on, expected, arrives_at, leaves_at
  ) values (second_child_id, center, day, true, opens, closes);
  perform pg_temp.impersonate('authenticated', owner_id);
  select * into fit from public.get_enrollment_fit_check(enrollment_id);
  if fit.staffing_status <> 'fail' or fit.maximum_educator_gap <> 1 then
    raise exception 'FAIL: post-admission ratio gap was hidden: %, gap %',
      fit.staffing_status, fit.maximum_educator_gap;
  end if;

  perform pg_temp.impersonate('postgres', owner_id);
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    parent_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated', 'fit-parent-' || parent_id || '@dailylog.invalid', '', now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Rollback Fit Parent"}', now(), now()
  );
  update public.profiles set role = 'parent', daycare_id = center where id = parent_id;
  perform pg_temp.impersonate('authenticated', parent_id);
  begin
    perform public.get_enrollment_fit_check(enrollment_id);
    raise exception 'FAIL: parent read the administrator fit check';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
end;
$$;

rollback;
select 'PASS: enrollment fit checks use dated occupancy, age bands, offer holds, published staffing and administrator scope; rolled back' result;
