-- Group 2f: an accepted offer amount becomes the child's scheduled/effective
-- tuition rate on the first day without rewriting invoice history.
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
  parent_id uuid := gen_random_uuid();
  educator_id uuid := gen_random_uuid();
  room_id uuid;
  current_child_id uuid;
  future_child_id uuid;
  current_enrollment_id uuid;
  future_enrollment_id uuid;
  current_rate_id uuid;
  visible_count integer;
  failed boolean := false;
begin
  perform pg_temp.impersonate('postgres', owner_id);
  insert into public.classrooms (
    daycare_id, name, min_age_months, max_age_months, capacity,
    ratio_children_per_educator
  ) values (center, 'Rollback enrollment tuition room', 18, 72, 12, 6)
  returning id into room_id;

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    parent_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated', 'tuition-parent-' || parent_id || '@dailylog.invalid', '', now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Rollback Tuition Parent"}', now(), now()
  );
  update public.profiles set role = 'parent', daycare_id = center where id = parent_id;

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    educator_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated', 'tuition-educator-' || educator_id || '@dailylog.invalid', '', now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Rollback Tuition Educator"}', now(), now()
  );
  update public.profiles
     set role = 'educator', daycare_id = center, classroom_id = room_id
   where id = educator_id;

  insert into public.children (
    daycare_id, classroom_id, first_name, last_name, date_of_birth, enrolled_on
  ) values (
    center, room_id, 'Current', 'Tuition', public.center_today() - 1200, public.center_today()
  ) returning id into current_child_id;
  insert into public.children (
    daycare_id, classroom_id, first_name, last_name, date_of_birth, enrolled_on
  ) values (
    center, room_id, 'Future', 'Tuition', public.center_today() - 1200, public.center_today() + 10
  ) returning id into future_child_id;
  insert into public.parent_children(parent_id, child_id, relationship, is_primary)
  values (parent_id, future_child_id, 'Parent', true);

  insert into public.enrollments (
    daycare_id, child_id, classroom_id, child_first_name, child_last_name,
    child_date_of_birth, guardian_name, guardian_email, stage,
    desired_start_date, offer_status, offer_tuition_cents
  ) values (
    center, current_child_id, room_id, 'Current', 'Tuition', public.center_today() - 1200,
    'Current Tuition Family', 'current-tuition@dailylog.invalid', 'enrolled',
    public.center_today(), 'accepted', 123400
  ) returning id into current_enrollment_id;

  select rate.id into current_rate_id
    from public.child_tuition_rates rate
   where rate.source_enrollment_id = current_enrollment_id
     and rate.child_id = current_child_id
     and rate.amount_cents = 123400
     and rate.effective_from = public.center_today()
     and rate.status = 'effective';
  if current_rate_id is null then
    raise exception 'FAIL: first-day tuition was not made effective';
  end if;
  if not exists (
    select 1 from public.enrollments enrollment
     where enrollment.id = current_enrollment_id
       and enrollment.onboarding_steps->>'billing_status' = 'effective'
       and (enrollment.onboarding_steps->>'billing_amount_cents')::integer = 123400
  ) then
    raise exception 'FAIL: enrollment lifecycle did not receive active billing state';
  end if;

  insert into public.enrollments (
    daycare_id, child_id, classroom_id, child_first_name, child_last_name,
    child_date_of_birth, guardian_name, guardian_email, stage,
    desired_start_date, offer_status, offer_tuition_cents
  ) values (
    center, future_child_id, room_id, 'Future', 'Tuition', public.center_today() - 1200,
    'Future Tuition Family', 'future-tuition@dailylog.invalid', 'enrolled',
    public.center_today() + 10, 'accepted', 135000
  ) returning id into future_enrollment_id;
  if not exists (
    select 1 from public.child_tuition_rates rate
     where rate.source_enrollment_id = future_enrollment_id
       and rate.amount_cents = 135000
       and rate.effective_from = public.center_today() + 10
       and rate.status = 'scheduled'
  ) then
    raise exception 'FAIL: future tuition was not scheduled for the first day';
  end if;
  if not exists (
    select 1 from public.enrollments enrollment
     where enrollment.id = future_enrollment_id
       and enrollment.onboarding_steps->>'billing_status' = 'scheduled'
       and (enrollment.onboarding_steps->>'billing_starts_on')::date = public.center_today() + 10
  ) then
    raise exception 'FAIL: enrollment lifecycle did not receive scheduled billing state';
  end if;

  perform pg_temp.impersonate('authenticated', parent_id);
  select count(*) into visible_count
    from public.child_tuition_rates rate
   where rate.source_enrollment_id = future_enrollment_id;
  if visible_count <> 1 then
    raise exception 'FAIL: linked parent saw % scheduled tuition rates, expected 1', visible_count;
  end if;
  failed := false;
  begin
    perform public.activate_due_enrollment_tuition_rates(center);
  exception when others then
    failed := true;
  end;
  if not failed then raise exception 'FAIL: parent invoked tuition activation worker'; end if;

  perform pg_temp.impersonate('authenticated', educator_id);
  select count(*) into visible_count
    from public.child_tuition_rates rate
   where rate.source_enrollment_id in (current_enrollment_id, future_enrollment_id);
  if visible_count <> 0 then
    raise exception 'FAIL: educator read family tuition data';
  end if;

  perform pg_temp.impersonate('authenticated', owner_id);
  update public.enrollments set stage = 'withdrawn' where id = current_enrollment_id;
  if not exists (
    select 1 from public.child_tuition_rates rate
     where rate.id = current_rate_id and rate.status = 'effective' and rate.effective_to is not null
  ) then
    raise exception 'FAIL: withdrawn enrollment left an open tuition rate';
  end if;

  perform pg_temp.impersonate('postgres', owner_id);
  if not exists (
    select 1 from cron.job where jobname = 'dailylog-enrollment-tuition-activation'
  ) then
    raise exception 'FAIL: tuition activation worker is not scheduled';
  end if;
end;
$$;

rollback;
select 'PASS: enrollment tuition is scheduled/effective from the first day, parent-visible, educator-private, withdrawal-safe and backed by an hourly worker; rolled back' result;
