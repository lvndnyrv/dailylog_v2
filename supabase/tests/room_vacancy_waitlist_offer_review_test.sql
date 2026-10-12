-- Transition vacancy -> reviewed waitlist offer; every fixture rolls back.
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
  source_room uuid;
  target_room uuid;
  empty_source_room uuid;
  empty_target_room uuid;
  moving_child uuid;
  remaining_child uuid;
  empty_moving_child uuid;
  eligible_public uuid;
  eligible_sibling uuid;
  wrong_age uuid;
  no_email uuid;
  plan_id uuid;
  empty_plan_id uuid;
  cancelled_plan_id uuid;
  plan_version timestamptz;
  review_id uuid;
  review_version timestamptz;
  offer_start date;
  today date;
  payload jsonb;
  row_count integer;
begin
  perform pg_temp.impersonate('postgres', owner_id);
  today := public.center_today();
  if extract(isodow from today) not between 1 and 5 then
    raise notice 'SKIP: vacancy release starts with an actual room move, which is closed on weekends';
    return;
  end if;
  delete from public.center_closures closure
   where closure.daycare_id = center
     and today between closure.starts_on and closure.ends_on;

  insert into public.classrooms (
    daycare_id, name, min_age_months, max_age_months, capacity,
    ratio_children_per_educator, opens_on
  ) values (
    center, 'Rollback vacancy source', 36, 72, 2, 4, today
  ) returning id into source_room;
  insert into public.classrooms (
    daycare_id, name, min_age_months, max_age_months, capacity,
    ratio_children_per_educator, opens_on
  ) values (
    center, 'Rollback vacancy target', 0, 120, 10, 4, today
  ) returning id into target_room;

  insert into public.children (
    daycare_id, classroom_id, first_name, last_name, date_of_birth, enrolled_on
  ) values (
    center, source_room, 'Moving', 'Child', (today - interval '4 years')::date, today - 100
  ) returning id into moving_child;
  insert into public.children (
    daycare_id, classroom_id, first_name, last_name, date_of_birth, enrolled_on
  ) values (
    center, source_room, 'Remaining', 'Child', (today - interval '4 years')::date, today - 100
  ) returning id into remaining_child;

  insert into public.enrollments (
    daycare_id, classroom_id, child_first_name, child_last_name,
    child_date_of_birth, guardian_name, guardian_email, stage,
    desired_start_date, waitlist_status, waitlist_priority,
    waitlist_position, waitlist_joined_at
  ) values (
    center, source_room, 'Older', 'Applicant',
    (today - interval '8 years')::date, 'Wrong Age Family',
    'wrong-age@dailylog.invalid', 'application', today,
    'active', 'sibling', 1, now() - interval '4 months'
  ) returning id into wrong_age;
  insert into public.enrollments (
    daycare_id, classroom_id, child_first_name, child_last_name,
    child_date_of_birth, guardian_name, guardian_email, stage,
    desired_start_date, waitlist_status, waitlist_priority,
    waitlist_position, waitlist_joined_at
  ) values (
    center, source_room, 'No', 'Email',
    (today - interval '4 years')::date, 'Missing Email Family',
    null, 'application', today,
    'active', 'sibling', 2, now() - interval '3 months'
  ) returning id into no_email;
  insert into public.enrollments (
    daycare_id, classroom_id, child_first_name, child_last_name,
    child_date_of_birth, guardian_name, guardian_email, stage,
    desired_start_date, waitlist_status, waitlist_priority,
    waitlist_position, waitlist_joined_at
  ) values (
    center, source_room, 'Public', 'Applicant',
    (today - interval '4 years')::date, 'Public Family',
    'public-family@dailylog.invalid', 'application', today,
    'active', 'public', 3, now() - interval '2 months'
  ) returning id into eligible_public;
  insert into public.enrollments (
    daycare_id, classroom_id, child_first_name, child_last_name,
    child_date_of_birth, guardian_name, guardian_email, stage,
    desired_start_date, waitlist_status, waitlist_priority,
    waitlist_position, waitlist_joined_at
  ) values (
    center, source_room, 'Sibling', 'Applicant',
    (today - interval '4 years')::date, 'Sibling Family',
    'sibling-family@dailylog.invalid', 'application', today,
    'active', 'sibling', 4, now() - interval '1 month'
  ) returning id into eligible_sibling;

  insert into public.room_transition_plans (
    daycare_id, child_id, from_classroom_id, to_classroom_id,
    move_on, transition_week, status
  ) values (
    center, moving_child, source_room, target_room, today, false, 'planned'
  ) returning id, updated_at into plan_id, plan_version;

  if exists (
    select 1 from public.room_vacancy_reviews
     where source_transition_plan_id = plan_id
  ) then
    raise exception 'FAIL: merely planning a move released a spot';
  end if;

  perform pg_temp.impersonate('authenticated', owner_id);
  perform public.complete_reviewed_room_transition(plan_id, plan_version);
  perform public.complete_reviewed_room_transition(plan_id, plan_version);

  perform pg_temp.impersonate('postgres', owner_id);
  select count(*) into row_count
    from public.room_vacancy_reviews
   where source_transition_plan_id = plan_id;
  if row_count <> 1 then
    raise exception 'FAIL: completion retry created % vacancy reviews', row_count;
  end if;
  if (select classroom_id from public.children where id = moving_child) <> target_room then
    raise exception 'FAIL: transition fixture did not move the child';
  end if;

  perform pg_temp.impersonate('authenticated', owner_id);
  select review.id,
         review.updated_at,
         review.candidate_offer_start_on
    into review_id, review_version, offer_start
    from public.get_room_vacancy_reviews() review
   where review.source_transition_plan_id = plan_id
     and review.candidate_enrollment_id = eligible_sibling
     and review.projected_children = 1
     and review.capacity = 2;
  if review_id is null then
    raise exception 'FAIL: review did not choose the first eligible priority family';
  end if;
  if offer_start <> today then
    raise exception 'FAIL: reviewed first day was %, expected %', offer_start, today;
  end if;

  perform pg_temp.impersonate('postgres', owner_id);
  update public.classrooms set capacity = 1 where id = source_room;
  perform pg_temp.impersonate('authenticated', owner_id);
  if exists (
    select 1 from public.get_room_vacancy_reviews()
     where id = review_id and candidate_enrollment_id is not null
  ) then
    raise exception 'FAIL: review ignored the live capacity change';
  end if;
  perform pg_temp.impersonate('postgres', owner_id);
  update public.classrooms set capacity = 2 where id = source_room;

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    parent_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated', 'vacancy-parent-' || parent_id || '@dailylog.invalid', '', now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Rollback Vacancy Parent"}', now(), now()
  );
  update public.profiles set role = 'parent', daycare_id = center where id = parent_id;

  perform pg_temp.impersonate('authenticated', parent_id);
  begin
    perform public.get_room_vacancy_reviews();
    raise exception 'FAIL: parent read the admin vacancy review';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  begin
    perform public.send_reviewed_enrollment_offer(
      eligible_sibling, source_room, offer_start, 48, 145000, 20000,
      review_id, review_version
    );
    raise exception 'FAIL: parent sent an enrollment offer';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  perform pg_temp.impersonate('authenticated', owner_id);
  begin
    perform public.send_reviewed_enrollment_offer(
      eligible_sibling, source_room, offer_start, 48, 145000, 20000,
      review_id, review_version - interval '1 second'
    );
    raise exception 'FAIL: stale vacancy review was accepted';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  begin
    perform public.send_reviewed_enrollment_offer(
      eligible_public, source_room, offer_start, 48, 145000, 20000,
      review_id, review_version
    );
    raise exception 'FAIL: admin skipped the reviewed next family';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  payload := public.send_reviewed_enrollment_offer(
    eligible_sibling, source_room, offer_start, 48, 145000, 20000,
    review_id, review_version
  );
  if payload->>'status' <> 'offer_sent' or payload->>'retry' <> 'false' then
    raise exception 'FAIL: reviewed offer did not return its committed result: %', payload;
  end if;
  if not exists (
    select 1 from public.room_vacancy_reviews
     where id = review_id and status = 'offer_sent'
       and enrollment_id = eligible_sibling and reviewed_by = owner_id
  ) then
    raise exception 'FAIL: vacancy review did not retain its offer handoff';
  end if;
  if not exists (
    select 1 from public.enrollments
     where id = eligible_sibling and stage = 'offer'
       and waitlist_status = 'offer' and offer_status = 'sent'
       and offer_code is not null and desired_start_date = offer_start
       and offer_tuition_cents = 145000 and offer_deposit_cents = 20000
  ) then
    raise exception 'FAIL: existing secure parent offer lifecycle was not opened';
  end if;
  select count(*) into row_count
    from public.notification_outbox outbox
   where outbox.dedupe_key = 'room-vacancy-offer:' || review_id
     and outbox.kind = 'waitlist_offer'
     and outbox.payload->>'offerCode' is not null;
  if row_count <> 1 then
    raise exception 'FAIL: reviewed offer queued % parent messages', row_count;
  end if;

  payload := public.send_reviewed_enrollment_offer(
    eligible_sibling, source_room, offer_start, 48, 145000, 20000,
    review_id, review_version
  );
  if payload->>'retry' <> 'true' then
    raise exception 'FAIL: offer retry was not idempotent';
  end if;
  select count(*) into row_count
    from public.notification_outbox outbox
   where outbox.dedupe_key = 'room-vacancy-offer:' || review_id;
  if row_count <> 1 then
    raise exception 'FAIL: offer retry duplicated the family message';
  end if;

  begin
    perform public.send_reviewed_enrollment_offer(
      eligible_public, source_room, offer_start, 48, 145000, 20000
    );
    raise exception 'FAIL: a manual offer double-booked the released spot';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  perform pg_temp.impersonate('postgres', owner_id);
  insert into public.classrooms (
    daycare_id, name, min_age_months, max_age_months, capacity,
    ratio_children_per_educator, opens_on
  ) values (
    center, 'Rollback empty vacancy source', 36, 72, 1, 4, today
  ) returning id into empty_source_room;
  insert into public.classrooms (
    daycare_id, name, min_age_months, max_age_months, capacity,
    ratio_children_per_educator, opens_on
  ) values (
    center, 'Rollback empty vacancy target', 0, 120, 10, 4, today
  ) returning id into empty_target_room;
  insert into public.children (
    daycare_id, classroom_id, first_name, last_name, date_of_birth, enrolled_on
  ) values (
    center, empty_source_room, 'No', 'Waitlist', (today - interval '4 years')::date, today - 100
  ) returning id into empty_moving_child;
  insert into public.room_transition_plans (
    daycare_id, child_id, from_classroom_id, to_classroom_id,
    move_on, transition_week, status
  ) values (
    center, empty_moving_child, empty_source_room, empty_target_room,
    today, false, 'planned'
  ) returning id, updated_at into empty_plan_id, plan_version;

  perform pg_temp.impersonate('authenticated', owner_id);
  perform public.complete_reviewed_room_transition(empty_plan_id, plan_version);
  if not exists (
    select 1 from public.get_room_vacancy_reviews()
     where source_transition_plan_id = empty_plan_id
       and candidate_enrollment_id is null
       and blocking_reason = 'No active waitlist family matches this room yet.'
  ) then
    raise exception 'FAIL: an unmatched released spot disappeared from review';
  end if;

  perform pg_temp.impersonate('postgres', owner_id);
  insert into public.room_transition_plans (
    daycare_id, child_id, from_classroom_id, to_classroom_id,
    move_on, transition_week, status
  ) values (
    center, remaining_child, source_room, target_room,
    today, false, 'planned'
  ) returning id into cancelled_plan_id;
  update public.room_transition_plans set status = 'cancelled'
   where id = cancelled_plan_id;
  if exists (
    select 1 from public.room_vacancy_reviews
     where source_transition_plan_id = cancelled_plan_id
  ) then
    raise exception 'FAIL: a cancelled transition released a room spot';
  end if;
end;
$$;

rollback;
select 'PASS: completed moves create one durable review; matching, permissions, live capacity, stale state, atomic offers, idempotency, secure parent handoff, unmatched spots, and cancellation all hold; rolled back' as result;
