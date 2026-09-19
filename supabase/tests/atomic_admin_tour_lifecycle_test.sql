-- Group 2m atomic admin tour lifecycle; rollback only.
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
  competitor_id uuid;
  outcome_id uuid;
  old_slot_id uuid;
  new_slot_id uuid;
  old_day date;
  new_day date;
  old_start timestamptz;
  new_start timestamptz;
  payload jsonb;
  failed boolean := false;
begin
  perform pg_temp.impersonate('postgres', owner_id);

  insert into public.classrooms (
    daycare_id, name, min_age_months, max_age_months, capacity,
    ratio_children_per_educator, opens_on
  ) values (
    center, 'Rollback admin tours', 36, 72, 10, 5, public.center_today()
  ) returning id into room_id;

  old_day := public._next_center_open_on_or_after(center, public.center_today() + 107);
  new_day := public._next_center_open_on_or_after(center, old_day + 1);
  old_start := (old_day + time '10:00') at time zone 'America/Toronto';
  new_start := (new_day + time '10:00') at time zone 'America/Toronto';

  insert into public.enrollments (
    daycare_id, child_first_name, child_last_name, child_date_of_birth,
    guardian_name, guardian_email, stage, desired_start_date, waitlist_status
  ) values (
    center, 'Tour', 'Family', (public.center_today() - interval '4 years')::date,
    'Tour Family', 'tour-family@dailylog.invalid', 'inquiry',
    public.center_today() + 30, 'not_waitlisted'
  ) returning id into target_id;
  insert into public.enrollments (
    daycare_id, child_first_name, child_last_name, child_date_of_birth,
    guardian_name, guardian_email, stage, desired_start_date, waitlist_status
  ) values (
    center, 'Other', 'Family', (public.center_today() - interval '4 years')::date,
    'Other Family', 'other-tour-family@dailylog.invalid', 'inquiry',
    public.center_today() + 30, 'not_waitlisted'
  ) returning id into competitor_id;

  insert into public.enrollment_tour_slots (
    daycare_id, starts_at, ends_at, classroom_id, enrollment_id, host_id, status
  ) values (
    center, old_start, old_start + interval '45 minutes',
    room_id, target_id, owner_id, 'booked'
  ) returning id into old_slot_id;
  update public.enrollments
     set stage = 'tour', tour_at = old_start, tour_host_id = owner_id
   where id = target_id;

  insert into public.enrollment_tour_slots (
    daycare_id, starts_at, ends_at, classroom_id, status
  ) values (
    center, new_start, new_start + interval '45 minutes',
    room_id, 'open'
  ) returning id into new_slot_id;

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    parent_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated', 'tour-parent-' || parent_id || '@dailylog.invalid', '', now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Rollback Tour Parent"}', now(), now()
  );
  update public.profiles set role = 'parent', daycare_id = center where id = parent_id;

  perform pg_temp.impersonate('authenticated', parent_id);
  begin
    perform public.book_admin_enrollment_tour(target_id, new_slot_id, owner_id);
  exception when others then failed := true;
  end;
  if not failed then raise exception 'FAIL: parent used administrator tour booking'; end if;

  perform pg_temp.impersonate('authenticated', owner_id);
  failed := false;
  begin
    perform public.book_admin_enrollment_tour(target_id, new_slot_id, parent_id);
  exception when others then failed := true;
  end;
  if not failed then raise exception 'FAIL: parent profile was accepted as tour host'; end if;

  payload := public.book_admin_enrollment_tour(target_id, new_slot_id, owner_id);
  if payload->>'status' <> 'booked' or (payload->>'retry')::boolean then
    raise exception 'FAIL: valid admin booking returned %', payload;
  end if;
  if not exists (
    select 1 from public.enrollment_tour_slots slot
     where slot.id = new_slot_id and slot.status = 'booked'
       and slot.enrollment_id = target_id and slot.host_id = owner_id
  ) then
    raise exception 'FAIL: replacement slot was not booked';
  end if;
  if not exists (
    select 1 from public.enrollment_tour_slots slot
     where slot.id = old_slot_id and slot.status = 'open'
       and slot.enrollment_id is null
  ) then
    raise exception 'FAIL: reschedule did not release the previous slot';
  end if;
  if not exists (
    select 1 from public.enrollments enrollment
     where enrollment.id = target_id and enrollment.stage = 'tour'
       and enrollment.tour_at = (select starts_at from public.enrollment_tour_slots where id = new_slot_id)
       and enrollment.tour_host_id = owner_id and enrollment.classroom_id = room_id
  ) then
    raise exception 'FAIL: booked slot and pipeline card disagree';
  end if;
  if (select count(*) from public.notification_outbox outbox
       where outbox.kind = 'tour_confirmation'
         and outbox.payload->>'enrollment_id' = target_id::text) <> 2 then
    raise exception 'FAIL: confirmation and reminder were not queued together';
  end if;

  failed := false;
  begin
    perform public.book_admin_enrollment_tour(competitor_id, new_slot_id, owner_id);
  exception when others then failed := true;
  end;
  if not failed then raise exception 'FAIL: second family took an occupied tour slot'; end if;
  if (select tour_at from public.enrollments where id = competitor_id) is not null then
    raise exception 'FAIL: rejected competing booking partially changed its family';
  end if;

  payload := public.book_admin_enrollment_tour(target_id, new_slot_id, owner_id);
  if not (payload->>'retry')::boolean then
    raise exception 'FAIL: repeated booking was not retry-safe';
  end if;
  if (select count(*) from public.notification_outbox outbox
       where outbox.kind = 'tour_confirmation'
         and outbox.payload->>'enrollment_id' = target_id::text) <> 2 then
    raise exception 'FAIL: repeated booking duplicated family notices';
  end if;

  payload := public.cancel_admin_enrollment_tour(target_id);
  if payload->>'status' <> 'cancelled' or (payload->>'retry')::boolean then
    raise exception 'FAIL: valid tour cancellation returned %', payload;
  end if;
  if not exists (
    select 1 from public.enrollment_tour_slots slot
     where slot.id = new_slot_id and slot.status = 'open' and slot.enrollment_id is null
  ) then
    raise exception 'FAIL: cancelled slot did not reopen';
  end if;
  if not exists (
    select 1 from public.enrollments enrollment
     where enrollment.id = target_id and enrollment.stage = 'inquiry'
       and enrollment.tour_at is null and enrollment.tour_host_id is null
       and enrollment.tour_outcome = 'cancelled'
  ) then
    raise exception 'FAIL: cancelled pipeline state is incomplete';
  end if;
  if (select count(*) from public.notification_outbox outbox
       where outbox.kind = 'tour_confirmation'
         and outbox.payload->>'enrollment_id' = target_id::text
         and outbox.payload->>'type' = 'tour_cancelled') <> 1 then
    raise exception 'FAIL: cancellation did not replace stale reminders with one notice';
  end if;
  if not (public.cancel_admin_enrollment_tour(target_id)->>'retry')::boolean then
    raise exception 'FAIL: repeat cancellation was not retry-safe';
  end if;

  perform pg_temp.impersonate('postgres', owner_id);
  insert into public.enrollments (
    daycare_id, classroom_id, child_first_name, child_last_name,
    child_date_of_birth, guardian_name, guardian_email, stage,
    desired_start_date, waitlist_status, tour_at, tour_host_id
  ) values (
    center, room_id, 'Visited', 'Family',
    (public.center_today() - interval '4 years')::date,
    'Visited Family', 'visited-family@dailylog.invalid', 'tour',
    public.center_today() + 30, 'not_waitlisted', now() - interval '1 hour', owner_id
  ) returning id into outcome_id;
  perform pg_temp.impersonate('authenticated', owner_id);
  payload := public.record_admin_enrollment_tour_outcome(
    outcome_id, 'attended', 'Family liked the room.', true
  );
  if payload->>'status' <> 'recorded' or not (payload->>'application_sent')::boolean then
    raise exception 'FAIL: attended outcome returned %', payload;
  end if;
  if not exists (
    select 1 from public.enrollments enrollment
     where enrollment.id = outcome_id and enrollment.stage = 'application'
       and enrollment.tour_outcome = 'attended'
       and enrollment.tour_notes = 'Family liked the room.'
       and enrollment.application_progress >= 20
  ) then
    raise exception 'FAIL: attended tour did not advance to application';
  end if;
  if (select count(*) from public.notification_outbox outbox
       where outbox.kind = 'enrollment_application'
         and outbox.payload->>'enrollment_id' = outcome_id::text) <> 1 then
    raise exception 'FAIL: application notice did not commit with outcome';
  end if;
  if not (public.record_admin_enrollment_tour_outcome(
    outcome_id, 'attended', 'Repeat', true
  )->>'retry')::boolean then
    raise exception 'FAIL: repeated outcome was not retry-safe';
  end if;
  if (select count(*) from public.notification_outbox outbox
       where outbox.kind = 'enrollment_application'
         and outbox.payload->>'enrollment_id' = outcome_id::text) <> 1 then
    raise exception 'FAIL: repeated outcome duplicated application notice';
  end if;
end;
$$;

rollback;
select 'PASS: admin tour booking, rescheduling, cancellation and outcomes are atomic, permissioned, host/slot guarded, retry-safe and synchronized with secure family notices; rolled back' as result;
