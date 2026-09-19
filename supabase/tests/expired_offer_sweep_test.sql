-- Group 2j overdue offer sweep and reviewed successor release; rollback only.
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
  expired_id uuid;
  candidate_id uuid;
  held_expired_id uuid;
  review_id uuid;
  review_count integer;
  processed integer;
  today date;
  failed boolean := false;
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
    center, 'Rollback expired offer sweep', 36, 72, 1, 4, today
  ) returning id into room_id;

  insert into public.enrollments (
    daycare_id, classroom_id, child_first_name, child_last_name,
    child_date_of_birth, guardian_name, guardian_email, stage,
    desired_start_date, waitlist_status, waitlist_priority, waitlist_position,
    waitlist_joined_at, offer_status, offer_sent_at, offer_expires_at,
    offer_tuition_cents, offer_deposit_cents
  ) values (
    center, room_id, 'Expired', 'Child', (today - interval '4 years')::date,
    'Expired Family', 'expired-sweep@dailylog.invalid', 'offer', today,
    'offer', 'public', 1, now() - interval '3 months', 'sent',
    now() - interval '3 days', now() - interval '1 minute', 145000, 20000
  ) returning id into expired_id;

  insert into public.enrollments (
    daycare_id, classroom_id, child_first_name, child_last_name,
    child_date_of_birth, guardian_name, guardian_email, stage,
    desired_start_date, waitlist_status, waitlist_priority, waitlist_position,
    waitlist_joined_at
  ) values (
    center, room_id, 'Next', 'Family', (today - interval '4 years')::date,
    'Next Family', 'next-expired-sweep@dailylog.invalid', 'application', today,
    'active', 'public', 2, now() - interval '1 month'
  ) returning id into candidate_id;

  perform pg_temp.impersonate('authenticated', owner_id);
  processed := public.process_expired_enrollment_offers();
  if processed < 1 then
    raise exception 'FAIL: expiry sweep reported no processed offers';
  end if;

  if not exists (
    select 1 from public.enrollments enrollment
     where enrollment.id = expired_id
       and enrollment.offer_status = 'expired'
       and enrollment.stage = 'inquiry'
       and enrollment.waitlist_status = 'active'
  ) then
    raise exception 'FAIL: expired family did not return safely to the active waitlist';
  end if;

  if not exists (
    select 1 from public.enrollments enrollment
     where enrollment.id = candidate_id
       and enrollment.offer_status = 'draft'
       and enrollment.waitlist_status = 'active'
  ) then
    raise exception 'FAIL: expiry sweep silently contacted or mutated the successor family';
  end if;

  select review.id into review_id
    from public.get_room_vacancy_reviews() review
   where review.candidate_enrollment_id = candidate_id
     and review.moved_child_name = 'Expired''s expired offer';
  if review_id is null then
    raise exception 'FAIL: expired offer did not create a reviewed successor vacancy';
  end if;

  perform public.process_expired_enrollment_offers();
  select count(*) into review_count
    from public.room_vacancy_reviews vacancy
   where vacancy.source_enrollment_id = expired_id;
  if review_count <> 1 then
    raise exception 'FAIL: repeated expiry processing created % reviews', review_count;
  end if;

  perform pg_temp.impersonate('postgres', owner_id);
  update public.enrollment_settings set auto_offer = false where daycare_id = center;

  insert into public.classrooms (
    daycare_id, name, min_age_months, max_age_months, capacity,
    ratio_children_per_educator, opens_on
  ) values (
    center, 'Rollback held expired offer', 36, 72, 1, 4, today
  ) returning id into held_room_id;

  insert into public.enrollments (
    daycare_id, classroom_id, child_first_name, child_last_name,
    child_date_of_birth, guardian_name, guardian_email, stage,
    desired_start_date, waitlist_status, waitlist_priority, waitlist_position,
    waitlist_joined_at, offer_status, offer_sent_at, offer_expires_at
  ) values (
    center, held_room_id, 'Held', 'Expired', (today - interval '4 years')::date,
    'Held Family', 'held-expired-sweep@dailylog.invalid', 'offer', today,
    'offer', 'public', 1, now() - interval '2 months', 'viewed',
    now() - interval '2 days', now() - interval '1 minute'
  ) returning id into held_expired_id;

  perform pg_temp.impersonate('authenticated', owner_id);
  perform public.process_expired_enrollment_offers();
  if not exists (
    select 1 from public.enrollments enrollment
     where enrollment.id = held_expired_id
       and enrollment.offer_status = 'expired'
       and enrollment.stage = 'inquiry'
       and enrollment.waitlist_status = 'active'
  ) then
    raise exception 'FAIL: held expired offer was not normalized';
  end if;
  if exists (
    select 1 from public.room_vacancy_reviews vacancy
     where vacancy.source_enrollment_id = held_expired_id
  ) then
    raise exception 'FAIL: disabled review automation released a held spot';
  end if;

  perform pg_temp.impersonate('postgres', owner_id);
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    parent_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated', 'expiry-parent-' || parent_id || '@dailylog.invalid', '', now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Rollback Expiry Parent"}', now(), now()
  );
  update public.profiles set role = 'parent', daycare_id = center where id = parent_id;

  perform pg_temp.impersonate('authenticated', parent_id);
  begin
    perform public.process_expired_enrollment_offers();
  exception when others then
    failed := true;
  end;
  if not failed then
    raise exception 'FAIL: parent was allowed to run the offer expiry sweep';
  end if;

  perform pg_temp.impersonate('postgres', owner_id);
  if not exists (
    select 1 from cron.job where jobname = 'dailylog-expired-enrollment-offers'
  ) then
    raise exception 'FAIL: expired offers have no background scheduler';
  end if;
end;
$$;

rollback;
select 'PASS: overdue offers expire in the background, return safely to the waitlist, create at most one reviewed successor vacancy, respect held spots and reject parent execution; rolled back' as result;
