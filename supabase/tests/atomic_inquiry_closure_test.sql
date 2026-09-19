-- Group 2l atomic inquiry closure; rollback only.
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
  target_id uuid;
  enrolled_id uuid;
  slot_id uuid;
  payload jsonb;
  closed_at timestamptz;
  failed boolean := false;
  active_count integer;
  position_count integer;
  max_position integer;
begin
  perform pg_temp.impersonate('postgres', owner_id);

  insert into public.classrooms (
    daycare_id, name, min_age_months, max_age_months, capacity,
    ratio_children_per_educator, opens_on
  ) values (
    center, 'Rollback inquiry closure', 36, 72, 10, 5, public.center_today()
  ) returning id into room_id;

  insert into public.enrollments (
    daycare_id, classroom_id, child_first_name, child_last_name,
    child_date_of_birth, guardian_name, guardian_email, stage,
    desired_start_date, waitlist_status, waitlist_priority,
    waitlist_position, waitlist_joined_at, offer_status,
    offer_sent_at, offer_expires_at
  ) values (
    center, room_id, 'Closing', 'Family',
    (public.center_today() - interval '4 years')::date,
    'Closing Family', 'closing-family@dailylog.invalid', 'offer',
    public.center_today() + 40, 'offer', 'sibling',
    999, now() - interval '3 months', 'sent',
    now(), now() + interval '2 days'
  ) returning id into target_id;

  insert into public.enrollments (
    daycare_id, classroom_id, child_first_name, child_last_name,
    child_date_of_birth, guardian_name, guardian_email, stage,
    desired_start_date, waitlist_status, waitlist_priority,
    waitlist_position, waitlist_joined_at
  ) values (
    center, room_id, 'Still', 'Waiting',
    (public.center_today() - interval '4 years')::date,
    'Still Waiting', 'still-waiting@dailylog.invalid', 'application',
    public.center_today() + 45, 'active', 'public',
    1000, now() - interval '2 months'
  );

  insert into public.enrollment_tour_slots (
    daycare_id, starts_at, ends_at, classroom_id, enrollment_id, status
  ) values (
    center, now() + interval '103 days 3 minutes',
    now() + interval '103 days 48 minutes', room_id, target_id, 'booked'
  ) returning id into slot_id;

  insert into public.enrollments (
    daycare_id, classroom_id, child_first_name, child_last_name,
    child_date_of_birth, guardian_name, guardian_email, stage,
    desired_start_date, waitlist_status, offer_status, child_id
  )
  select center, room_id, child.first_name, child.last_name,
    child.date_of_birth, 'Enrolled Guardian', 'enrolled-closure@dailylog.invalid',
    'enrolled', public.center_today(), 'not_waitlisted', 'accepted', child.id
  from public.children child
  where child.daycare_id = center and child.archived_at is null
  limit 1
  returning id into enrolled_id;
  if enrolled_id is null then
    raise exception 'FAIL: closure test needs one seeded active child';
  end if;

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    parent_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated', 'closure-parent-' || parent_id || '@dailylog.invalid', '', now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Rollback Closure Parent"}', now(), now()
  );
  update public.profiles set role = 'parent', daycare_id = center where id = parent_id;

  perform pg_temp.impersonate('authenticated', parent_id);
  begin
    perform public.close_enrollment_inquiry(target_id, 'Not allowed', false, true);
  exception when others then failed := true;
  end;
  if not failed then raise exception 'FAIL: parent closed an inquiry'; end if;

  perform pg_temp.impersonate('authenticated', owner_id);
  failed := false;
  begin
    perform public.close_enrollment_inquiry(enrolled_id, 'Wrong flow', false, true);
  exception when others then failed := true;
  end;
  if not failed then raise exception 'FAIL: enrolled family bypassed scheduled withdrawal'; end if;
  if (select stage from public.enrollments where id = enrolled_id) <> 'enrolled' then
    raise exception 'FAIL: rejected enrolled-family closure partially changed its record';
  end if;

  payload := public.close_enrollment_inquiry(
    target_id, 'Family chose another program', true, true
  );
  if payload->>'status' <> 'closed' or (payload->>'retry')::boolean then
    raise exception 'FAIL: valid inquiry closure returned %', payload;
  end if;
  if not exists (
    select 1 from public.enrollments enrollment
     where enrollment.id = target_id
       and enrollment.stage = 'withdrawn'
       and enrollment.waitlist_status = 'archived'
       and enrollment.waitlist_position is null
       and enrollment.offer_status = 'withdrawn'
       and enrollment.closed_reason = 'Family chose another program'
       and enrollment.keep_on_file
  ) then
    raise exception 'FAIL: closure did not save all lifecycle fields';
  end if;
  if not exists (
    select 1 from public.enrollment_tour_slots slot
     where slot.id = slot_id and slot.status = 'open' and slot.enrollment_id is null
  ) then
    raise exception 'FAIL: closure stranded the future booked tour slot';
  end if;
  if not exists (
    select 1 from public.room_vacancy_reviews review
     where review.source_enrollment_id = target_id
       and review.release_reason = 'withdrawn'
  ) then
    raise exception 'FAIL: closing an open offer did not enter vacancy review';
  end if;
  if (select count(*) from public.notification_outbox outbox
       where outbox.kind = 'inquiry_closed'
         and outbox.payload->>'enrollmentId' = target_id::text
         and outbox.payload->>'screen' = 'ParentInquiryJourney') <> 1 then
    raise exception 'FAIL: closure did not queue one secure goodbye notice';
  end if;

  select count(*), count(distinct waitlist_position), max(waitlist_position)
    into active_count, position_count, max_position
    from public.enrollments enrollment
   where enrollment.daycare_id = center
     and enrollment.waitlist_status in ('active', 'offer');
  if active_count <> position_count or coalesce(max_position, 0) <> active_count then
    raise exception 'FAIL: closing waitlist entry left non-contiguous positions';
  end if;

  select enrollment.closed_at into closed_at
    from public.enrollments enrollment where enrollment.id = target_id;
  payload := public.close_enrollment_inquiry(
    target_id, 'Repeat click', true, false
  );
  if not (payload->>'retry')::boolean then
    raise exception 'FAIL: repeat closure was not idempotent';
  end if;
  if (select enrollment.closed_at from public.enrollments enrollment where enrollment.id = target_id) <> closed_at then
    raise exception 'FAIL: retry changed the original closure time';
  end if;
  if (select count(*) from public.notification_outbox outbox
       where outbox.kind = 'inquiry_closed'
         and outbox.payload->>'enrollmentId' = target_id::text) <> 1 then
    raise exception 'FAIL: retry duplicated the goodbye notice';
  end if;
end;
$$;

rollback;
select 'PASS: inquiry closure is atomic, permissioned and retry-safe; releases open offers and future tours, re-ranks waitlists, preserves history and queues one family notice; rolled back' as result;
