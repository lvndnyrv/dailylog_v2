-- Group 2f: accepted families stay in admin preparation while educator and
-- attendance access begins on the agreed first day.
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
  room_id uuid;
  current_child_id uuid;
  future_child_id uuid;
  enrollment_id uuid;
  starts_on date;
  failed boolean;
  visible_count integer;
  roll_call jsonb;
  scheduled_at timestamptz;
begin
  perform pg_temp.impersonate('postgres', owner_id);
  starts_on := public.center_today() + 7;

  insert into public.classrooms (
    daycare_id, name, min_age_months, max_age_months, capacity,
    ratio_children_per_educator
  ) values (
    center, 'Rollback first-day handoff room', 18, 72, 8, 4
  ) returning id into room_id;

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    educator_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated', 'handoff-educator-' || educator_id || '@dailylog.invalid', '', now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Rollback Handoff Educator"}', now(), now()
  );
  update public.profiles
     set role = 'educator', daycare_id = center, classroom_id = room_id
   where id = educator_id;
  insert into public.staff_members (
    daycare_id, profile_id, job_title, status, background_check_required
  ) values (center, educator_id, 'Rollback educator', 'active', false);

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    parent_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated', 'handoff-parent-' || parent_id || '@dailylog.invalid', '', now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Rollback Handoff Parent"}', now(), now()
  );
  update public.profiles set role = 'parent', daycare_id = center where id = parent_id;

  insert into public.children (
    daycare_id, classroom_id, first_name, last_name, date_of_birth, enrolled_on
  ) values (
    center, room_id, 'Current', 'Roster', public.center_today() - 1200, public.center_today()
  ) returning id into current_child_id;
  insert into public.children (
    daycare_id, classroom_id, first_name, last_name, date_of_birth, enrolled_on
  ) values (
    center, room_id, 'Future', 'Roster', starts_on - 1200, starts_on
  ) returning id into future_child_id;
  insert into public.parent_children(parent_id, child_id, relationship, is_primary)
  values (parent_id, future_child_id, 'Parent', true);
  insert into public.child_pickups(
    daycare_id, child_id, full_name, relationship, pin, approval_status
  ) values (
    center, future_child_id, 'Future Pickup', 'Parent', '7319', 'approved'
  );

  insert into public.enrollments (
    daycare_id, child_id, classroom_id, child_first_name, child_last_name,
    child_date_of_birth, guardian_name, guardian_email, stage,
    desired_start_date, offer_status, offer_sent_at, offer_accepted_at,
    offer_deposit_cents, deposit_status, application_submitted_at,
    agreement_signed_at, documents_status
  ) values (
    center, future_child_id, room_id, 'Future', 'Roster', starts_on - 1200,
    'Future Family', 'first-day-handoff@dailylog.invalid', 'enrolled', starts_on,
    'accepted', now() - interval '2 days', now() - interval '1 day',
    50000, 'paid', now() - interval '1 day', now() - interval '1 day',
    jsonb_build_object(
      'immunization', 'received', 'emergency_contacts', 'received',
      'medical', 'received', 'handbook', 'received'
    )
  ) returning id into enrollment_id;

  perform pg_temp.impersonate('authenticated', educator_id);
  if public.can_access_child(future_child_id) or public.can_write_child(future_child_id) then
    raise exception 'FAIL: educator received future child access';
  end if;
  if not public.can_access_child(current_child_id) or not public.can_write_child(current_child_id) then
    raise exception 'FAIL: educator lost access to a child whose first day has begun';
  end if;
  select count(*) into visible_count
    from public.children child
   where child.id in (current_child_id, future_child_id);
  if visible_count <> 1 then
    raise exception 'FAIL: educator saw % of 2 current/future roster children, expected 1', visible_count;
  end if;
  roll_call := public.get_mobile_roll_call(room_id);
  if not exists (
    select 1 from jsonb_array_elements(roll_call->'children') item
     where item->>'id' = current_child_id::text
  ) or exists (
    select 1 from jsonb_array_elements(roll_call->'children') item
     where item->>'id' = future_child_id::text
  ) then
    raise exception 'FAIL: educator roll call did not enforce the first-day boundary';
  end if;
  select count(*) into visible_count from public.kiosk_lookup_pin('7319');
  if visible_count <> 0 then
    raise exception 'FAIL: kiosk lookup exposed a child before the first day';
  end if;
  failed := false;
  begin
    perform public.kiosk_check(future_child_id, '7319');
  exception when others then
    failed := true;
  end;
  if not failed then raise exception 'FAIL: kiosk checked in a child before the first day'; end if;

  perform pg_temp.impersonate('authenticated', parent_id);
  if not public.can_access_child(future_child_id) then
    raise exception 'FAIL: linked parent lost preparation access to future child';
  end if;
  if not exists (select 1 from public.children where id = future_child_id) then
    raise exception 'FAIL: linked parent could not read future child';
  end if;

  perform pg_temp.impersonate('authenticated', owner_id);
  if not public.can_access_child(future_child_id) then
    raise exception 'FAIL: administrator lost preparation access to future child';
  end if;
  failed := false;
  begin
    insert into public.attendance_records(daycare_id, child_id, date, status)
    values (center, future_child_id, starts_on - 1, 'present');
  exception when others then
    failed := true;
  end;
  if not failed then raise exception 'FAIL: attendance was recorded before the first day'; end if;

  insert into public.attendance_records(daycare_id, child_id, date, status)
  values (center, current_child_id, public.center_today(), 'present');

  failed := false;
  begin
    perform public.save_enrollment_onboarding(enrollment_id, owner_id, 'C-12', true);
  exception when others then
    failed := true;
  end;
  if not failed then raise exception 'FAIL: a non-educator was accepted as primary educator'; end if;

  perform public.save_enrollment_onboarding(enrollment_id, educator_id, 'C-12', true);
  if not exists (
    select 1 from public.enrollments enrollment
     where enrollment.id = enrollment_id
       and enrollment.onboarding_steps->'room_schedule'->>'primary_educator_id' = educator_id::text
       and enrollment.onboarding_steps->'room_schedule'->>'cubby_label' = 'C-12'
  ) then
    raise exception 'FAIL: room handoff was not stored on the enrollment';
  end if;
  if not exists (
    select 1 from public.children child
     where child.id = future_child_id
       and child.setup_state->>'primary_educator_id' = educator_id::text
       and child.setup_state->>'cubby_label' = 'C-12'
  ) then
    raise exception 'FAIL: room handoff was not stored on the child';
  end if;
  select outbox.available_at into scheduled_at
    from public.notification_outbox outbox
   where outbox.daycare_id = center
     and outbox.dedupe_key = 'enrollment-welcome:' || enrollment_id;
  if scheduled_at is null or scheduled_at <= now() then
    raise exception 'FAIL: welcome was not scheduled before the future first day';
  end if;

  perform pg_temp.impersonate('authenticated', educator_id);
  if exists (select 1 from public.children where id = future_child_id) then
    raise exception 'FAIL: room handoff prematurely exposed the future child to educators';
  end if;
end;
$$;

rollback;
select 'PASS: first-day handoff preserves admin/parent preparation, delays educator roster access, blocks early attendance, validates room educators and stores cubby/welcome setup; rolled back' result;
