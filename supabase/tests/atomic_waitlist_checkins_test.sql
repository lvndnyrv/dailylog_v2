-- Group 2j atomic waitlist check-ins and scheduled overdue handling; rollback only.
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
  first_id uuid;
  second_id uuid;
  pending_id uuid;
  payload jsonb;
  failed boolean := false;
  notice_count integer;
begin
  perform pg_temp.impersonate('postgres', owner_id);

  insert into public.classrooms (
    daycare_id, name, min_age_months, max_age_months, capacity,
    ratio_children_per_educator, opens_on
  ) values (
    center, 'Rollback waitlist check-ins', 36, 72, 10, 4, public.center_today()
  ) returning id into room_id;

  insert into public.enrollments (
    daycare_id, classroom_id, child_first_name, child_last_name,
    child_date_of_birth, guardian_name, guardian_email, stage,
    desired_start_date, waitlist_status, waitlist_position,
    waitlist_joined_at, waitlist_unanswered_checkins, offer_code
  ) values (
    center, room_id, 'First', 'Waiting', (public.center_today() - interval '4 years')::date,
    'First Waiting', 'first-checkin@dailylog.invalid', 'application', public.center_today(),
    'active', 1, now() - interval '6 months', 0,
    'CHECKIN-FIRST-' || replace(gen_random_uuid()::text, '-', '')
  ) returning id into first_id;
  insert into public.enrollments (
    daycare_id, classroom_id, child_first_name, child_last_name,
    child_date_of_birth, guardian_name, guardian_email, stage,
    desired_start_date, waitlist_status, waitlist_position,
    waitlist_joined_at, waitlist_unanswered_checkins, offer_code
  ) values (
    center, room_id, 'Second', 'Waiting', (public.center_today() - interval '4 years')::date,
    'Second Waiting', 'second-checkin@dailylog.invalid', 'application', public.center_today(),
    'active', 2, now() - interval '5 months', 0,
    'CHECKIN-SECOND-' || replace(gen_random_uuid()::text, '-', '')
  ) returning id into second_id;
  insert into public.enrollments (
    daycare_id, classroom_id, child_first_name, child_last_name,
    child_date_of_birth, guardian_name, guardian_email, stage,
    desired_start_date, waitlist_status, waitlist_position,
    waitlist_joined_at, waitlist_unanswered_checkins,
    waitlist_response_due_at, offer_code
  ) values (
    center, room_id, 'Pending', 'Reply', (public.center_today() - interval '4 years')::date,
    'Pending Reply', 'pending-checkin@dailylog.invalid', 'application', public.center_today(),
    'active', 3, now() - interval '4 months', 1, now() + interval '3 days',
    'CHECKIN-PENDING-' || replace(gen_random_uuid()::text, '-', '')
  ) returning id into pending_id;

  perform pg_temp.impersonate('authenticated', owner_id);
  begin
    perform public.send_waitlist_checkins(
      array[first_id, pending_id],
      'Please confirm your waitlist plans.'
    );
  exception when others then
    failed := true;
  end;
  if not failed then raise exception 'FAIL: family with an open response window was reminded again'; end if;
  if not exists (
    select 1 from public.enrollments enrollment
     where enrollment.id = first_id
       and enrollment.waitlist_unanswered_checkins = 0
       and enrollment.waitlist_response_due_at is null
  ) then
    raise exception 'FAIL: rejected mixed batch partially updated its first family';
  end if;

  payload := public.send_waitlist_checkins(
    array[first_id, second_id],
    'Please confirm your waitlist plans.'
  );
  if payload->>'status' <> 'sent' or (payload->>'sent_count')::integer <> 2 then
    raise exception 'FAIL: valid check-in batch returned %', payload;
  end if;
  if (select count(*) from public.enrollments enrollment
       where enrollment.id in (first_id, second_id)
         and enrollment.waitlist_unanswered_checkins = 1
         and enrollment.waitlist_response_due_at > now() + interval '6 days') <> 2 then
    raise exception 'FAIL: both families did not receive one seven-day response window';
  end if;
  select count(*) into notice_count
    from public.notification_outbox outbox
   where outbox.dedupe_key in (
     'waitlist-checkin:' || first_id || ':1',
     'waitlist-checkin:' || second_id || ':1'
   )
     and outbox.payload->>'screen' = 'ParentInquiryJourney';
  if notice_count <> 2 then
    raise exception 'FAIL: atomic batch queued % of 2 secure family messages', notice_count;
  end if;

  failed := false;
  begin
    perform public.send_waitlist_checkins(array[first_id], 'Duplicate reminder');
  exception when others then
    failed := true;
  end;
  if not failed then raise exception 'FAIL: duplicate reminder bypassed the open response window'; end if;
  if (select waitlist_unanswered_checkins from public.enrollments where id = first_id) <> 1 then
    raise exception 'FAIL: duplicate attempt incremented the unanswered count';
  end if;

  perform pg_temp.impersonate('postgres', owner_id);
  insert into public.enrollment_settings (daycare_id, auto_archive_checkins)
  values (center, 1)
  on conflict (daycare_id) do update set auto_archive_checkins = excluded.auto_archive_checkins;
  update public.enrollments
     set waitlist_response_due_at = now() - interval '1 minute'
   where id in (first_id, second_id);
  perform public.process_overdue_waitlist_checkins();
  if (select count(*) from public.enrollments enrollment
       where enrollment.id in (first_id, second_id)
         and enrollment.waitlist_status = 'archived'
         and enrollment.waitlist_position is null
         and enrollment.closed_reason = 'Archived after unanswered waitlist check-ins') <> 2 then
    raise exception 'FAIL: overdue unanswered windows did not leave the ranked list';
  end if;

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    parent_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated', 'checkin-parent-' || parent_id || '@dailylog.invalid', '', now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Rollback Check-in Parent"}', now(), now()
  );
  update public.profiles set role = 'parent', daycare_id = center where id = parent_id;

  perform pg_temp.impersonate('authenticated', parent_id);
  failed := false;
  begin
    perform public.send_waitlist_checkins(array[pending_id], 'Not allowed');
  exception when others then
    failed := true;
  end;
  if not failed then raise exception 'FAIL: parent sent an administrator check-in'; end if;

  perform pg_temp.impersonate('postgres', owner_id);
  if not exists (
    select 1 from cron.job where jobname = 'dailylog-overdue-waitlist-checkins'
  ) then
    raise exception 'FAIL: overdue waitlist responses have no scheduler';
  end if;
end;
$$;

rollback;
select 'PASS: waitlist check-ins commit as one secure batch, block duplicate open windows, roll back mixed failures, schedule overdue archiving, preserve records and deny parents; rolled back' as result;
