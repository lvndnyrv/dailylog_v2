-- Group 2j closed-offer -> reviewed waitlist advancement; all fixtures roll back.
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
  room_id uuid;
  decline_room_id uuid;
  offered_id uuid;
  candidate_id uuid;
  wrong_age_id uuid;
  declined_id uuid;
  decline_candidate_id uuid;
  decline_code text;
  review_id uuid;
  review_version timestamptz;
  offer_start date;
  today date;
  payload jsonb;
  total integer;
begin
  perform pg_temp.impersonate('postgres', owner_id);
  today := public._next_center_open_on_or_after(center, public.center_today());

  insert into public.enrollment_settings (daycare_id, auto_offer)
  values (center, true)
  on conflict (daycare_id) do update set auto_offer = excluded.auto_offer;

  insert into public.classrooms (
    daycare_id, name, min_age_months, max_age_months, capacity,
    ratio_children_per_educator, opens_on
  ) values (
    center, 'Rollback offer release', 36, 72, 1, 4, today
  ) returning id into room_id;

  insert into public.enrollments (
    daycare_id, classroom_id, child_first_name, child_last_name,
    child_date_of_birth, guardian_name, guardian_email, stage,
    desired_start_date, waitlist_status, waitlist_priority, waitlist_position,
    waitlist_joined_at, offer_status, offer_sent_at, offer_expires_at,
    offer_tuition_cents, offer_deposit_cents
  ) values (
    center, room_id, 'Released', 'Child', (today - interval '4 years')::date,
    'Released Family', 'released-family@dailylog.invalid', 'offer', today,
    'offer', 'public', 1, now() - interval '3 months', 'sent',
    now() - interval '2 days', now() + interval '2 days', 145000, 20000
  ) returning id into offered_id;

  insert into public.enrollments (
    daycare_id, classroom_id, child_first_name, child_last_name,
    child_date_of_birth, guardian_name, guardian_email, stage,
    desired_start_date, waitlist_status, waitlist_priority, waitlist_position,
    waitlist_joined_at
  ) values (
    center, room_id, 'Too old', 'Child', (today - interval '9 years')::date,
    'Wrong Age Family', 'wrong-age-release@dailylog.invalid', 'application', today,
    'active', 'sibling', 2, now() - interval '2 months'
  ) returning id into wrong_age_id;

  insert into public.enrollments (
    daycare_id, classroom_id, child_first_name, child_last_name,
    child_date_of_birth, guardian_name, guardian_email, stage,
    desired_start_date, waitlist_status, waitlist_priority, waitlist_position,
    waitlist_joined_at
  ) values (
    center, room_id, 'Next', 'Child', (today - interval '4 years')::date,
    'Next Family', 'next-release@dailylog.invalid', 'application', today,
    'active', 'public', 3, now() - interval '1 month'
  ) returning id into candidate_id;

  perform pg_temp.impersonate('authenticated', owner_id);
  payload := public.withdraw_enrollment_offer(offered_id, true, 'No response');
  if payload->>'status' <> 'withdrawn' or payload->>'retry' <> 'false' then
    raise exception 'FAIL: atomic withdrawal returned %', payload;
  end if;
  review_id := nullif(payload->>'review_id', '')::uuid;
  if review_id is null then raise exception 'FAIL: auto-review rule did not retain the released spot'; end if;

  if not exists (
    select 1 from public.enrollments enrollment
     where enrollment.id = offered_id
       and enrollment.offer_status = 'withdrawn'
       and enrollment.stage = 'inquiry'
       and enrollment.waitlist_status = 'active'
       and enrollment.waitlist_priority = 'public'
  ) then
    raise exception 'FAIL: withdrawn family was not safely returned to the public tier';
  end if;

  if not exists (
    select 1 from public.enrollments enrollment
     where enrollment.id = candidate_id
       and enrollment.offer_status = 'draft'
       and enrollment.waitlist_status = 'active'
  ) then
    raise exception 'FAIL: closing the first offer silently contacted or mutated the next family';
  end if;

  select review.updated_at, review.candidate_offer_start_on
    into review_version, offer_start
    from public.get_room_vacancy_reviews() review
   where review.id = review_id
     and review.source_transition_plan_id is null
     and review.candidate_enrollment_id = candidate_id
     and review.moved_child_name = 'Released''s withdrawn offer';
  if review_version is null then
    raise exception 'FAIL: release review did not skip the source family and invalid older child';
  end if;

  select count(*) into total
    from public.notification_outbox outbox
   where outbox.kind = 'offer_withdrawn'
     and outbox.dedupe_key like 'offer-withdrawn:' || offered_id || ':%';
  if total <> 1 then raise exception 'FAIL: withdrawal queued % family notices', total; end if;

  payload := public.withdraw_enrollment_offer(offered_id, true, 'No response');
  if payload->>'retry' <> 'true' then raise exception 'FAIL: withdrawal retry was not idempotent'; end if;
  select count(*) into total from public.room_vacancy_reviews vacancy
   where vacancy.source_enrollment_id = offered_id;
  if total <> 1 then raise exception 'FAIL: withdrawal retry created % reviews', total; end if;

  payload := public.send_reviewed_enrollment_offer(
    candidate_id, room_id, offer_start, 48, 145000, 20000,
    review_id, review_version
  );
  if payload->>'status' <> 'offer_sent' then
    raise exception 'FAIL: confirmed successor offer did not use the secure lifecycle';
  end if;

  insert into public.classrooms (
    daycare_id, name, min_age_months, max_age_months, capacity,
    ratio_children_per_educator, opens_on
  ) values (
    center, 'Rollback parent decline release', 36, 72, 1, 4, today
  ) returning id into decline_room_id;

  insert into public.enrollments (
    daycare_id, classroom_id, child_first_name, child_last_name,
    child_date_of_birth, guardian_name, guardian_email, stage,
    desired_start_date, waitlist_status, waitlist_priority, waitlist_position,
    waitlist_joined_at, offer_status, offer_sent_at, offer_expires_at, offer_code
  ) values (
    center, decline_room_id, 'Declining', 'Child', (today - interval '4 years')::date,
    'Declining Family', 'declining-release@dailylog.invalid', 'offer', today,
    'offer', 'public', 1, now() - interval '2 months', 'sent', now(),
    now() + interval '2 days', 'ROLLBACK-DECLINE-' || replace(gen_random_uuid()::text, '-', '')
  ) returning id, offer_code into declined_id, decline_code;

  insert into public.enrollments (
    daycare_id, classroom_id, child_first_name, child_last_name,
    child_date_of_birth, guardian_name, guardian_email, stage,
    desired_start_date, waitlist_status, waitlist_priority, waitlist_position,
    waitlist_joined_at
  ) values (
    center, decline_room_id, 'After', 'Decline', (today - interval '4 years')::date,
    'After Decline Family', 'after-decline@dailylog.invalid', 'application', today,
    'active', 'public', 2, now() - interval '1 month'
  ) returning id into decline_candidate_id;

  perform pg_temp.impersonate('anon', null);
  perform public.decline_parent_enrollment_offer(
    decline_code,
    'Not needed now'
  );

  perform pg_temp.impersonate('authenticated', owner_id);
  if not exists (
    select 1 from public.get_room_vacancy_reviews() review
     where review.candidate_enrollment_id = decline_candidate_id
       and review.moved_child_name = 'Declining''s declined offer'
  ) then
    raise exception 'FAIL: a parent-declined offer did not enter the reviewed successor queue';
  end if;
end;
$$;

rollback;
select 'PASS: withdrawals and parent declines release one durable reviewed spot; successor matching is safe, explicit, atomic and retry-safe; rolled back' as result;
