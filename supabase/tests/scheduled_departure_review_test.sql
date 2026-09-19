-- Group 2m scheduled departure completion and reviewed spot release; rollback only.
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
  room_id uuid;
  held_room_id uuid;
  departing_child_id uuid;
  held_child_id uuid;
  linked_enrollment_id uuid;
  candidate_id uuid;
  departure_id uuid;
  held_departure_id uuid;
  review_id uuid;
  review_count integer;
  today date;
  failed boolean := false;
begin
  perform pg_temp.impersonate('postgres', owner_id);
  today := public.center_today();

  insert into public.classrooms (
    daycare_id, name, min_age_months, max_age_months, capacity,
    ratio_children_per_educator, opens_on
  ) values (
    center, 'Rollback scheduled departure', 36, 72, 1, 4, today
  ) returning id into room_id;

  insert into public.children (
    daycare_id, classroom_id, first_name, last_name, date_of_birth, enrolled_on
  ) values (
    center, room_id, 'Departing', 'Child', (today - interval '4 years')::date, today - 200
  ) returning id into departing_child_id;

  insert into public.enrollments (
    daycare_id, classroom_id, child_id, child_first_name, child_last_name,
    child_date_of_birth, guardian_name, guardian_email, stage,
    desired_start_date, waitlist_status
  ) values (
    center, room_id, departing_child_id, 'Departing', 'Child',
    (today - interval '4 years')::date, 'Departing Family',
    'departing-child@dailylog.invalid', 'enrolled', today - 200, 'not_waitlisted'
  ) returning id into linked_enrollment_id;

  insert into public.enrollments (
    daycare_id, classroom_id, child_first_name, child_last_name,
    child_date_of_birth, guardian_name, guardian_email, stage,
    desired_start_date, waitlist_status, waitlist_priority,
    waitlist_position, waitlist_joined_at
  ) values (
    center, room_id, 'Waiting', 'Child', (today - interval '4 years')::date,
    'Waiting Family', 'waiting-departure@dailylog.invalid', 'application',
    today, 'active', 'public', 1, now() - interval '2 months'
  ) returning id into candidate_id;

  perform pg_temp.impersonate('authenticated', owner_id);
  departure_id := public.schedule_child_departure(
    departing_child_id, today + 28, 'Family is moving', 'Rollback notice', true
  );
  if not exists (
    select 1 from public.child_departures departure
     where departure.id = departure_id
       and departure.child_id = departing_child_id
       and departure.last_day = today + 28
       and departure.offer_spot_automatically
       and departure.status = 'scheduled'
  ) then
    raise exception 'FAIL: atomic future departure was not scheduled';
  end if;

  begin
    perform public.schedule_child_departure(
      departing_child_id, today - 1, 'Past date', null, true
    );
  exception when others then
    failed := true;
  end;
  if not failed then raise exception 'FAIL: a past last day was accepted by the scheduler'; end if;

  perform pg_temp.impersonate('postgres', owner_id);
  update public.child_departures set last_day = today - 1 where id = departure_id;

  perform pg_temp.impersonate('authenticated', owner_id);
  perform public.process_due_child_departures();

  if not exists (
    select 1 from public.children child
     where child.id = departing_child_id and child.archived_at is not null
  ) or not exists (
    select 1 from public.child_departures departure
     where departure.id = departure_id and departure.status = 'completed'
  ) or not exists (
    select 1 from public.enrollments enrollment
     where enrollment.id = linked_enrollment_id and enrollment.stage = 'withdrawn'
  ) then
    raise exception 'FAIL: due departure did not atomically preserve the child as alumni';
  end if;

  select review.id into review_id
    from public.get_room_vacancy_reviews() review
   where review.candidate_enrollment_id = candidate_id
     and review.moved_child_name = 'Departing Child''s completed departure';
  if review_id is null then
    raise exception 'FAIL: completed departure did not prepare its safe waitlist review';
  end if;

  perform public.process_due_child_departures();
  select count(*) into review_count
    from public.room_vacancy_reviews vacancy
   where vacancy.source_child_departure_id = departure_id;
  if review_count <> 1 then
    raise exception 'FAIL: repeated due processing created % departure reviews', review_count;
  end if;

  perform pg_temp.impersonate('postgres', owner_id);
  insert into public.classrooms (
    daycare_id, name, min_age_months, max_age_months, capacity,
    ratio_children_per_educator, opens_on
  ) values (
    center, 'Rollback held departure spot', 36, 72, 1, 4, today
  ) returning id into held_room_id;
  insert into public.children (
    daycare_id, classroom_id, first_name, last_name, date_of_birth, enrolled_on
  ) values (
    center, held_room_id, 'Held', 'Spot', (today - interval '4 years')::date, today - 100
  ) returning id into held_child_id;
  insert into public.child_departures (
    daycare_id, child_id, last_day, reason, offer_spot_automatically, status
  ) values (
    center, held_child_id, today - 1, 'Hold for sibling', false, 'scheduled'
  ) returning id into held_departure_id;

  perform pg_temp.impersonate('authenticated', owner_id);
  perform public.process_due_child_departures();
  if exists (
    select 1 from public.room_vacancy_reviews vacancy
     where vacancy.source_child_departure_id = held_departure_id
  ) then
    raise exception 'FAIL: an explicitly held spot entered waitlist review';
  end if;

  perform pg_temp.impersonate('postgres', owner_id);
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    parent_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated', 'departure-parent-' || parent_id || '@dailylog.invalid', '', now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Rollback Departure Parent"}', now(), now()
  );
  update public.profiles set role = 'parent', daycare_id = center where id = parent_id;

  perform pg_temp.impersonate('authenticated', parent_id);
  failed := false;
  begin
    perform public.schedule_child_departure(held_child_id, today + 30, 'No', '', true);
  exception when others then
    failed := true;
  end;
  if not failed then raise exception 'FAIL: parent scheduled a child departure'; end if;

  perform pg_temp.impersonate('postgres', owner_id);
  if not exists (
    select 1 from cron.job where jobname = 'dailylog-child-departures'
  ) then
    raise exception 'FAIL: due departures have no scheduler';
  end if;
end;
$$;

rollback;
select 'PASS: scheduled withdrawals validate atomically, due departures preserve alumni, optional released spots enter one reviewed queue, held spots stay held, permissions and scheduler hold; rolled back' as result;
