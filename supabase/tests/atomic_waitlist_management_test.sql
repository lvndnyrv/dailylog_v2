-- Group 2k atomic waitlist placement and rules; rollback only.
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
  foreign_center uuid := gen_random_uuid();
  foreign_room uuid;
  public_id uuid;
  sibling_id uuid;
  mismatch_id uuid;
  payload jsonb;
  failed boolean := false;
  joined_at timestamptz;
  notice_count integer;
begin
  perform pg_temp.impersonate('postgres', owner_id);

  insert into public.classrooms (
    daycare_id, name, min_age_months, max_age_months, capacity,
    ratio_children_per_educator, opens_on
  ) values (
    center, 'Rollback atomic waitlist', 36, 72, 10, 5, public.center_today()
  ) returning id into room_id;

  insert into public.enrollments (
    daycare_id, classroom_id, child_first_name, child_last_name,
    child_date_of_birth, guardian_name, guardian_email, stage,
    desired_start_date, waitlist_status, waitlist_priority,
    waitlist_position, waitlist_joined_at
  ) values (
    center, room_id, 'Earlier', 'Public',
    (public.center_today() - interval '4 years')::date,
    'Earlier Public', 'earlier-waitlist@dailylog.invalid', 'application',
    public.center_today() + 20, 'active', 'public', 900, now() - interval '2 months'
  ) returning id into public_id;

  insert into public.enrollments (
    daycare_id, child_first_name, child_last_name, child_date_of_birth,
    guardian_name, guardian_email, stage, desired_start_date, waitlist_status
  ) values (
    center, 'Sibling', 'Candidate',
    (public.center_today() - interval '4 years')::date,
    'Sibling Candidate', 'sibling-waitlist@dailylog.invalid', 'application',
    public.center_today() + 30, 'not_waitlisted'
  ) returning id into sibling_id;

  insert into public.enrollments (
    daycare_id, child_first_name, child_last_name, child_date_of_birth,
    guardian_name, guardian_email, stage, desired_start_date, waitlist_status
  ) values (
    center, 'Young', 'Candidate',
    (public.center_today() - interval '1 year')::date,
    'Young Candidate', 'young-waitlist@dailylog.invalid', 'application',
    public.center_today() + 30, 'not_waitlisted'
  ) returning id into mismatch_id;

  insert into public.daycares (id, name, timezone)
  values (foreign_center, 'Rollback Foreign Center', 'America/Toronto');
  insert into public.classrooms (
    daycare_id, name, min_age_months, max_age_months, capacity,
    ratio_children_per_educator
  ) values (foreign_center, 'Foreign room', 36, 72, 10, 5)
  returning id into foreign_room;

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    parent_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated', 'waitlist-parent-' || parent_id || '@dailylog.invalid', '', now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Rollback Waitlist Parent"}', now(), now()
  );
  update public.profiles set role = 'parent', daycare_id = center where id = parent_id;

  perform pg_temp.impersonate('authenticated', parent_id);
  begin
    perform public.add_enrollment_to_waitlist(
      sibling_id, room_id, public.center_today() + 30, true
    );
  exception when others then failed := true;
  end;
  if not failed then raise exception 'FAIL: parent added an enrollment to the waitlist'; end if;

  perform pg_temp.impersonate('authenticated', owner_id);
  failed := false;
  begin
    perform public.add_enrollment_to_waitlist(
      mismatch_id, room_id, public.center_today() + 30, false
    );
  exception when others then failed := true;
  end;
  if not failed then raise exception 'FAIL: age-ineligible child joined a room waitlist'; end if;
  if (select waitlist_status from public.enrollments where id = mismatch_id) <> 'not_waitlisted' then
    raise exception 'FAIL: rejected age mismatch partially changed the enrollment';
  end if;

  failed := false;
  begin
    perform public.add_enrollment_to_waitlist(
      sibling_id, foreign_room, public.center_today() + 30, true
    );
  exception when others then failed := true;
  end;
  if not failed then raise exception 'FAIL: foreign-center room was accepted'; end if;

  payload := public.add_enrollment_to_waitlist(
    sibling_id, room_id, public.center_today() + 30, true
  );
  if payload->>'status' <> 'active' or (payload->>'retry')::boolean then
    raise exception 'FAIL: valid waitlist placement returned %', payload;
  end if;
  if not exists (
    select 1 from public.enrollments enrollment
     where enrollment.id = sibling_id
       and enrollment.classroom_id = room_id
       and enrollment.desired_start_date = public.center_today() + 30
       and enrollment.waitlist_status = 'active'
       and enrollment.waitlist_priority = 'sibling'
  ) then
    raise exception 'FAIL: sibling placement did not save';
  end if;
  if (select waitlist_position from public.enrollments where id = sibling_id) >=
     (select waitlist_position from public.enrollments where id = public_id) then
    raise exception 'FAIL: existing public family was not re-ranked behind sibling';
  end if;
  select waitlist_joined_at into joined_at from public.enrollments where id = sibling_id;
  select count(*) into notice_count
    from public.notification_outbox outbox
   where outbox.kind = 'waitlist_confirmation'
     and outbox.payload->>'enrollmentId' = sibling_id::text
     and outbox.payload->>'screen' = 'ParentInquiryJourney';
  if notice_count <> 1 then
    raise exception 'FAIL: atomic placement queued % confirmation notices', notice_count;
  end if;

  payload := public.add_enrollment_to_waitlist(
    sibling_id, room_id, public.center_today() + 30, true
  );
  if not (payload->>'retry')::boolean then
    raise exception 'FAIL: repeat placement was not idempotent';
  end if;
  if (select waitlist_joined_at from public.enrollments where id = sibling_id) <> joined_at then
    raise exception 'FAIL: retry reset the family waiting age';
  end if;
  if (select count(*) from public.notification_outbox outbox
       where outbox.kind = 'waitlist_confirmation'
         and outbox.payload->>'enrollmentId' = sibling_id::text) <> 1 then
    raise exception 'FAIL: retry duplicated the waitlist confirmation';
  end if;

  payload := public.update_enrollment_waitlist_rules(false, false, 168, false, 3);
  if payload->>'status' <> 'saved' then
    raise exception 'FAIL: valid rule update returned %', payload;
  end if;
  if (select waitlist_position from public.enrollments where id = public_id) >=
     (select waitlist_position from public.enrollments where id = sibling_id) then
    raise exception 'FAIL: disabling sibling priority did not restore chronological order';
  end if;
  if not exists (
    select 1 from public.enrollment_settings settings
     where settings.daycare_id = center
       and not settings.siblings_first
       and not settings.staff_children_next
       and settings.offer_window_hours = 168
       and not settings.auto_offer
       and settings.auto_archive_checkins = 3
  ) then
    raise exception 'FAIL: waitlist rules did not save together';
  end if;
  if not exists (
    select 1 from public.notification_outbox outbox
     where outbox.kind = 'waitlist_position_changed'
       and outbox.payload->>'enrollmentId' = sibling_id::text
       and outbox.payload->>'screen' = 'ParentInquiryJourney'
  ) then
    raise exception 'FAIL: re-ranked family did not receive a secure position notice';
  end if;

  failed := false;
  begin
    perform public.update_enrollment_waitlist_rules(true, true, 1, true, 2);
  exception when others then failed := true;
  end;
  if not failed then raise exception 'FAIL: invalid one-hour offer window saved'; end if;
  if (select offer_window_hours from public.enrollment_settings where daycare_id = center) <> 168 then
    raise exception 'FAIL: rejected rules partially changed settings';
  end if;

  perform pg_temp.impersonate('authenticated', parent_id);
  failed := false;
  begin
    perform public.update_enrollment_waitlist_rules(true, true, 48, true, 2);
  exception when others then failed := true;
  end;
  if not failed then raise exception 'FAIL: parent changed center waitlist rules'; end if;
end;
$$;

rollback;
select 'PASS: waitlist placement and rule changes are atomic, center-scoped, age-safe, retry-safe, settings-aware and notify families; rolled back' as result;
