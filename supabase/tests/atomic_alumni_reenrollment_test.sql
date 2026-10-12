-- Group 2m atomic alumni re-enrollment; all fixtures roll back.
begin;

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
  old_room_id uuid;
  target_room_id uuid;
  full_room_id uuid;
  planned_room_id uuid;
  returning_child_id uuid;
  no_pipeline_child_id uuid;
  occupant_id uuid;
  enrollment_id uuid;
  completed_departure_id uuid;
  scheduled_departure_id uuid;
  plan_id uuid;
  wait_id uuid;
  payload jsonb;
  today date;
  failed boolean := false;
  linked_count integer;
begin
  perform pg_temp.impersonate('postgres', owner_id);
  today := public.center_today();

  insert into public.classrooms (
    daycare_id, name, min_age_months, max_age_months, capacity,
    ratio_children_per_educator, opens_on
  ) values (center, 'Rollback alumni source', 36, 72, 4, 4, today - 100)
  returning id into old_room_id;
  insert into public.classrooms (
    daycare_id, name, min_age_months, max_age_months, capacity,
    ratio_children_per_educator, opens_on
  ) values (center, 'Rollback alumni target', 36, 72, 2, 4, today - 100)
  returning id into target_room_id;
  insert into public.classrooms (
    daycare_id, name, min_age_months, max_age_months, capacity,
    ratio_children_per_educator, opens_on
  ) values (center, 'Rollback alumni full', 36, 72, 1, 4, today - 100)
  returning id into full_room_id;
  insert into public.classrooms (
    daycare_id, name, min_age_months, max_age_months, capacity,
    ratio_children_per_educator, opens_on
  ) values (center, 'Rollback alumni stale plan', 36, 72, 4, 4, today - 100)
  returning id into planned_room_id;

  insert into public.children (
    daycare_id, classroom_id, first_name, last_name, date_of_birth,
    enrolled_on, archived_at
  ) values (
    center, old_room_id, 'Returning', 'Alumnus',
    (today - interval '4 years')::date, today - 300, now() - interval '1 month'
  ) returning id into returning_child_id;

  insert into public.children (
    daycare_id, classroom_id, first_name, last_name, date_of_birth, enrolled_on
  ) values (
    center, full_room_id, 'Current', 'Occupant',
    (today - interval '4 years')::date, today - 100
  ) returning id into occupant_id;

  insert into public.enrollments (
    daycare_id, child_id, classroom_id, child_first_name, child_last_name,
    child_date_of_birth, stage, desired_start_date, waitlist_status,
    waitlist_position, waitlist_joined_at, offer_status, offer_sent_at,
    offer_expires_at, offer_viewed_at, closed_reason, closed_at
  ) values (
    center, returning_child_id, old_room_id, 'Returning', 'Alumnus',
    (today - interval '4 years')::date, 'withdrawn', today - 300, 'archived',
    7, now() - interval '1 year', 'expired', now() - interval '2 months',
    now() - interval '1 month', now() - interval '6 weeks', 'Moved away', now() - interval '1 month'
  ) returning id into enrollment_id;

  insert into public.child_departures (
    daycare_id, child_id, last_day, reason, status, completed_at
  ) values (
    center, returning_child_id, today - 31, 'Moved away', 'completed', now() - interval '1 month'
  ) returning id into completed_departure_id;
  insert into public.child_departures (
    daycare_id, child_id, last_day, reason, status
  ) values (
    center, returning_child_id, today + 30, 'Stale later departure', 'scheduled'
  ) returning id into scheduled_departure_id;

  insert into public.room_transition_plans (
    daycare_id, child_id, from_classroom_id, to_classroom_id, move_on, status
  ) values (
    center, returning_child_id, old_room_id, planned_room_id, today + 20, 'planned'
  ) returning id into plan_id;
  insert into public.room_transition_wait_requests (
    daycare_id, child_id, from_classroom_id, to_classroom_id,
    not_before, status, notes
  ) values (
    center, returning_child_id, old_room_id, target_room_id,
    today + 10, 'waiting', 'Stale alumni wait request'
  ) returning id into wait_id;

  perform pg_temp.impersonate('authenticated', owner_id);
  begin
    perform public.re_enroll_alumni(returning_child_id, full_room_id);
  exception when others then
    failed := true;
  end;
  if not failed then raise exception 'FAIL: a full room accepted an alumnus'; end if;
  if not exists (
    select 1 from public.children child
     where child.id = returning_child_id and child.archived_at is not null
       and child.classroom_id = old_room_id
  ) or not exists (
    select 1 from public.enrollments enrollment
     where enrollment.id = enrollment_id and enrollment.stage = 'withdrawn'
  ) or not exists (
    select 1 from public.room_transition_plans plan
     where plan.id = plan_id and plan.status = 'planned'
  ) then
    raise exception 'FAIL: rejected re-enrollment left partial changes';
  end if;

  payload := public.re_enroll_alumni(returning_child_id, target_room_id);
  if payload->>'status' <> 'enrolled' or payload->>'retry' <> 'false' then
    raise exception 'FAIL: successful re-enrollment returned %', payload;
  end if;

  if not exists (
    select 1 from public.children child
     where child.id = returning_child_id
       and child.archived_at is null
       and child.classroom_id = target_room_id
       and child.enrolled_on = today
  ) then
    raise exception 'FAIL: alumni profile was not restored to the chosen room';
  end if;
  if not exists (
    select 1 from public.enrollments enrollment
     where enrollment.id = enrollment_id
       and enrollment.stage = 'enrolled'
       and enrollment.classroom_id = target_room_id
       and enrollment.desired_start_date = today
       and enrollment.waitlist_status = 'not_waitlisted'
       and enrollment.waitlist_position is null
       and enrollment.offer_status = 'draft'
       and enrollment.offer_sent_at is null
       and enrollment.offer_expires_at is null
       and enrollment.closed_reason is null
       and enrollment.closed_at is null
  ) then
    raise exception 'FAIL: linked pipeline record was not normalized';
  end if;
  if not exists (
    select 1 from public.child_departures departure
     where departure.id = completed_departure_id and departure.status = 'completed'
  ) or not exists (
    select 1 from public.child_departures departure
     where departure.id = scheduled_departure_id and departure.status = 'cancelled'
  ) or not exists (
    select 1 from public.room_transition_plans plan
     where plan.id = plan_id and plan.status = 'cancelled'
  ) or not exists (
    select 1 from public.room_transition_wait_requests wait
     where wait.id = wait_id and wait.status = 'cancelled'
  ) then
    raise exception 'FAIL: history was lost or stale future work remained active';
  end if;

  payload := public.re_enroll_alumni(returning_child_id, target_room_id);
  if payload->>'retry' <> 'true' then
    raise exception 'FAIL: same re-enrollment retry was not idempotent';
  end if;
  select count(*) into linked_count
    from public.enrollments enrollment
   where enrollment.child_id = returning_child_id;
  if linked_count <> 1 then
    raise exception 'FAIL: retry produced % linked enrollment records', linked_count;
  end if;

  perform pg_temp.impersonate('postgres', owner_id);
  insert into public.children (
    daycare_id, classroom_id, first_name, last_name, date_of_birth,
    enrolled_on, archived_at
  ) values (
    center, old_room_id, 'History', 'Only',
    (today - interval '4 years')::date, today - 400, now() - interval '2 months'
  ) returning id into no_pipeline_child_id;

  perform pg_temp.impersonate('authenticated', owner_id);
  perform public.re_enroll_alumni(no_pipeline_child_id, target_room_id);
  select count(*) into linked_count
    from public.enrollments enrollment
   where enrollment.child_id = no_pipeline_child_id
     and enrollment.stage = 'enrolled'
     and enrollment.source = 'alumni_reenrollment';
  if linked_count <> 1 then
    raise exception 'FAIL: alumni without a pipeline record received % replacements', linked_count;
  end if;

  perform pg_temp.impersonate('postgres', owner_id);
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    parent_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated', 'reenroll-parent-' || parent_id || '@dailylog.invalid', '', now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Rollback Re-enroll Parent"}', now(), now()
  );
  update public.profiles set role = 'parent', daycare_id = center where id = parent_id;

  perform pg_temp.impersonate('authenticated', parent_id);
  failed := false;
  begin
    perform public.re_enroll_alumni(returning_child_id, target_room_id);
  exception when others then
    failed := true;
  end;
  if not failed then raise exception 'FAIL: parent re-enrolled an alumnus'; end if;
end;
$$;

rollback;
select 'PASS: alumni re-enrollment is atomic, capacity/age/room guarded, restores one pipeline record, preserves completed history, cancels stale work, handles missing pipelines, retries safely and denies parents; rolled back' as result;
