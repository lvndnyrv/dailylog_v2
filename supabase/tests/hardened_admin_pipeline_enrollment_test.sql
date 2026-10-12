-- Group 2f hardened admin offer completion; all fixtures roll back.
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
  other_room_id uuid;
  blocker_id uuid;
  enrollment_id uuid;
  unaccepted_id uuid;
  created_child_id uuid;
  retry_child_id uuid;
  start_on date;
  failed boolean := false;
  child_count integer;
begin
  perform pg_temp.impersonate('postgres', owner_id);
  start_on := public._next_center_open_on_or_after(center, public.center_today());

  insert into public.classrooms (
    daycare_id, name, min_age_months, max_age_months, capacity,
    ratio_children_per_educator, opens_on
  ) values (
    center, 'Rollback accepted-offer room', 36, 72, 1, 4, start_on - 100
  ) returning id into room_id;
  insert into public.classrooms (
    daycare_id, name, min_age_months, max_age_months, capacity,
    ratio_children_per_educator, opens_on
  ) values (
    center, 'Rollback different offer room', 36, 72, 3, 4, start_on - 100
  ) returning id into other_room_id;

  insert into public.enrollments (
    daycare_id, classroom_id, child_first_name, child_last_name,
    child_date_of_birth, guardian_name, guardian_email, stage,
    desired_start_date, waitlist_status, waitlist_position,
    offer_status, offer_sent_at, offer_expires_at, offer_accepted_at,
    offer_deposit_cents, deposit_status, deposit_paid_at,
    application_submitted_at, agreement_signed_at, application_data
  ) values (
    center, room_id, 'Accepted', 'Original',
    (start_on - interval '4 years')::date, 'Accepted Parent',
    'accepted-admin-completion@dailylog.invalid', 'offer', start_on,
    'offer', 1, 'accepted', now() - interval '2 days', now() + interval '2 days',
    now() - interval '1 day', 20000, 'paid', now() - interval '1 day',
    now() - interval '1 day', now() - interval '1 day',
    jsonb_build_object(
      'allergies', jsonb_build_array('Peanuts'),
      'emergency_contact_name', 'Aunt Avery',
      'emergency_contact_phone', '555-0100'
    )
  ) returning id into enrollment_id;

  insert into public.enrollments (
    daycare_id, classroom_id, child_first_name, child_last_name,
    child_date_of_birth, guardian_name, guardian_email, stage,
    desired_start_date, waitlist_status, offer_status, offer_sent_at,
    offer_expires_at, offer_deposit_cents
  ) values (
    center, other_room_id, 'Not', 'Accepted',
    (start_on - interval '4 years')::date, 'Waiting Parent',
    'not-accepted-admin-completion@dailylog.invalid', 'offer', start_on,
    'offer', 'sent', now(), now() + interval '2 days', 0
  ) returning id into unaccepted_id;

  perform pg_temp.impersonate('authenticated', owner_id);
  begin
    perform public.enroll_from_pipeline(unaccepted_id, other_room_id, 'Accepted');
  exception when others then
    failed := true;
  end;
  if not failed then raise exception 'FAIL: an unaccepted offer was enrolled'; end if;
  if exists (select 1 from public.children child where child.daycare_id = center and child.first_name = 'Not') then
    raise exception 'FAIL: rejected unaccepted offer created a child';
  end if;

  failed := false;
  begin
    perform public.enroll_from_pipeline(enrollment_id, other_room_id, 'Final');
  exception when others then
    failed := true;
  end;
  if not failed then raise exception 'FAIL: admin changed the room after family acceptance'; end if;

  perform pg_temp.impersonate('postgres', owner_id);
  insert into public.children (
    daycare_id, classroom_id, first_name, last_name, date_of_birth, enrolled_on
  ) values (
    center, room_id, 'Capacity', 'Blocker',
    (start_on - interval '4 years')::date, start_on - 30
  ) returning id into blocker_id;

  perform pg_temp.impersonate('authenticated', owner_id);
  failed := false;
  begin
    perform public.enroll_from_pipeline(enrollment_id, room_id, 'Final');
  exception when others then
    failed := true;
  end;
  if not failed then raise exception 'FAIL: invalidated room capacity was ignored'; end if;
  if exists (select 1 from public.enrollments enrollment where enrollment.id = enrollment_id and enrollment.child_id is not null) then
    raise exception 'FAIL: rejected capacity check partially linked a child';
  end if;

  perform pg_temp.impersonate('postgres', owner_id);
  update public.children set archived_at = now() where id = blocker_id;

  perform pg_temp.impersonate('authenticated', owner_id);
  created_child_id := public.enroll_from_pipeline(enrollment_id, room_id, 'Final');
  if created_child_id is null then raise exception 'FAIL: ready accepted offer did not enroll'; end if;

  if not exists (
    select 1 from public.children child
     where child.id = created_child_id
       and child.daycare_id = center
       and child.classroom_id = room_id
       and child.first_name = 'Accepted'
       and child.last_name = 'Final'
       and child.enrolled_on = start_on
       and child.allergies = array['Peanuts']::text[]
       and child.emergency_contacts->0->>'name' = 'Aunt Avery'
  ) then
    raise exception 'FAIL: child profile did not retain the accepted application data';
  end if;
  if not exists (
    select 1 from public.enrollments enrollment
     where enrollment.id = enrollment_id
       and enrollment.child_id = created_child_id
       and enrollment.stage = 'enrolled'
       and enrollment.classroom_id = room_id
       and enrollment.waitlist_status = 'not_waitlisted'
       and enrollment.waitlist_position is null
       and enrollment.parent_workflow_step = 'enrolled'
       and enrollment.onboarding_steps ? 'room_schedule'
  ) then
    raise exception 'FAIL: accepted offer and onboarding state were not finalized';
  end if;

  retry_child_id := public.enroll_from_pipeline(enrollment_id, room_id, 'Final');
  if retry_child_id <> created_child_id then
    raise exception 'FAIL: retry returned a different child';
  end if;
  select count(*) into child_count
    from public.children child
   where child.id = created_child_id;
  if child_count <> 1 then raise exception 'FAIL: retry produced % children', child_count; end if;

  perform pg_temp.impersonate('postgres', owner_id);
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    parent_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated', 'pipeline-parent-' || parent_id || '@dailylog.invalid', '', now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Rollback Pipeline Parent"}', now(), now()
  );
  update public.profiles set role = 'parent', daycare_id = center where id = parent_id;

  perform pg_temp.impersonate('authenticated', parent_id);
  failed := false;
  begin
    perform public.enroll_from_pipeline(enrollment_id, room_id, 'Final');
  exception when others then
    failed := true;
  end;
  if not failed then raise exception 'FAIL: parent invoked the admin completion path'; end if;
end;
$$;

rollback;
select 'PASS: admin pipeline completion requires an accepted, paid and completed offer, fixes the accepted room, rechecks age/open-day/capacity, restores application data, commits atomically, retries safely and denies parents; rolled back' as result;
