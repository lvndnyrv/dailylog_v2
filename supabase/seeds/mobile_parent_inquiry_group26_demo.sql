-- Realistic Parent Mobile Group 26 enrollment-journey fixtures.
-- Deep links:
--   dailylog://inquiry?code=PARENT26-INQUIRY-2026
--   dailylog://inquiry?code=PARENT26-TOUR-2026
--   dailylog://inquiry?code=PARENT26-WAITLIST-2026
--   dailylog://inquiry?code=PARENT26-CHECKIN-2026

do $$
declare
  v_daycare constant uuid := '10000000-0000-4000-a000-000000000001';
  v_preschool constant uuid := '20000000-0000-4000-a000-000000000003';
  v_host constant uuid := '00000000-0000-4000-a000-000000000008';
  v_inquiry constant uuid := '42600000-0000-4000-a000-000000000001';
  v_tour constant uuid := '42600000-0000-4000-a000-000000000002';
  v_waitlist constant uuid := '42600000-0000-4000-a000-000000000003';
  v_checkin constant uuid := '42600000-0000-4000-a000-000000000004';
  v_next_monday date := current_date + 7 + ((1 - extract(dow from current_date)::int + 7) % 7);
  v_booked_at timestamptz;
  v_search_weeks int := 0;
begin
  if not exists (select 1 from public.daycares where id = v_daycare) then
    raise notice 'Skipping Group 26 demo: Sunny Grove is not seeded';
    return;
  end if;

  -- Other demo groups seed closures relative to today. Move this fixture as a
  -- unit until every tour date is operational instead of bypassing the guard.
  while exists (
    select 1
    from public.center_closures closure
    where closure.daycare_id = v_daycare
      and (
        v_next_monday between closure.starts_on and closure.ends_on
        or v_next_monday + 2 between closure.starts_on and closure.ends_on
        or v_next_monday + 3 between closure.starts_on and closure.ends_on
        or v_next_monday + 7 between closure.starts_on and closure.ends_on
      )
  ) loop
    v_next_monday := v_next_monday + 7;
    v_search_weeks := v_search_weeks + 1;
    if v_search_weeks > 52 then
      raise exception 'Could not find an open demo week for Group 26 tours';
    end if;
  end loop;

  v_booked_at := (v_next_monday + 3 + time '10:30') at time zone 'America/Toronto';

  insert into public.enrollment_settings (daycare_id, auto_archive_checkins, inquiry_reply_hours)
  values (v_daycare, 2, 24)
  on conflict (daycare_id) do update set
    auto_archive_checkins = 2,
    inquiry_reply_hours = 24,
    updated_at = now();

  insert into public.enrollments (
    id, daycare_id, classroom_id, child_first_name, child_last_name,
    child_date_of_birth, guardian_name, guardian_email, guardian_phone,
    stage, desired_start_date, source, schedule, offer_code,
    waitlist_status, waitlist_position, waitlist_joined_at,
    waitlist_priority, waitlist_unanswered_checkins,
    waitlist_response_due_at, waitlist_last_contact_at, created_at
  ) values
  (
    v_inquiry, v_daycare, v_preschool, 'Nora', 'Adeyemi',
    current_date - interval '3 years 4 months', 'Femi Adeyemi',
    'femi.adeyemi@family.test', '905-555-0261', 'inquiry',
    current_date + 65, 'website', '{"days_per_week":5}',
    'PARENT26-INQUIRY-2026', 'not_waitlisted', null, null, 'public', 0,
    null, null, now() - interval '2 hours'
  ),
  (
    v_tour, v_daycare, v_preschool, 'Chloé', 'Laurent',
    current_date - interval '3 years 9 months', 'Camille Laurent',
    'camille.laurent@family.test', '905-555-0262', 'tour',
    current_date + 54, 'referral', '{"days_per_week":5}',
    'PARENT26-TOUR-2026', 'not_waitlisted', null, null, 'public', 0,
    null, null, now() - interval '4 days'
  ),
  (
    v_waitlist, v_daycare, v_preschool, 'Amina', 'Okafor',
    current_date - interval '4 years 1 month', 'Ada Okafor',
    'ada.okafor@family.test', '905-555-0263', 'application',
    current_date + 42, 'tour', '{"days_per_week":3}',
    'PARENT26-WAITLIST-2026', 'active', 3, now() - interval '6 months',
    'sibling', 0, null, now() - interval '2 months',
    now() - interval '6 months'
  ),
  (
    v_checkin, v_daycare, v_preschool, 'Theo', 'Martin',
    current_date - interval '3 years 7 months', 'Sophie Martin',
    'sophie.martin@family.test', '905-555-0264', 'application',
    current_date + 49, 'tour', '{"days_per_week":5}',
    'PARENT26-CHECKIN-2026', 'active', 4, now() - interval '7 months',
    'public', 1, now() + interval '5 days', now() - interval '2 days',
    now() - interval '7 months'
  )
  on conflict (id) do update set
    classroom_id = excluded.classroom_id,
    child_first_name = excluded.child_first_name,
    child_last_name = excluded.child_last_name,
    child_date_of_birth = excluded.child_date_of_birth,
    guardian_name = excluded.guardian_name,
    guardian_email = excluded.guardian_email,
    guardian_phone = excluded.guardian_phone,
    stage = excluded.stage,
    desired_start_date = excluded.desired_start_date,
    source = excluded.source,
    schedule = excluded.schedule,
    offer_code = excluded.offer_code,
    offer_status = 'draft',
    offer_sent_at = null,
    offer_viewed_at = null,
    offer_expires_at = null,
    waitlist_status = excluded.waitlist_status,
    waitlist_position = excluded.waitlist_position,
    waitlist_joined_at = excluded.waitlist_joined_at,
    waitlist_priority = excluded.waitlist_priority,
    waitlist_unanswered_checkins = excluded.waitlist_unanswered_checkins,
    waitlist_response_due_at = excluded.waitlist_response_due_at,
    waitlist_last_contact_at = excluded.waitlist_last_contact_at,
    closed_reason = null,
    closed_at = null,
    updated_at = now();

  delete from public.enrollment_tour_slots
  where enrollment_id in (v_inquiry, v_tour, v_waitlist, v_checkin)
     or id in (
       '42610000-0000-4000-a000-000000000001',
       '42610000-0000-4000-a000-000000000002',
       '42610000-0000-4000-a000-000000000003',
       '42610000-0000-4000-a000-000000000004'
     );

  insert into public.enrollment_tour_slots (
    id, daycare_id, starts_at, ends_at, classroom_id, host_id,
    enrollment_id, status, created_by
  ) values
  (
    '42610000-0000-4000-a000-000000000001', v_daycare,
    (v_next_monday + time '09:30') at time zone 'America/Toronto',
    (v_next_monday + time '10:15') at time zone 'America/Toronto',
    v_preschool, v_host, null, 'open', v_host
  ),
  (
    '42610000-0000-4000-a000-000000000002', v_daycare,
    (v_next_monday + 2 + time '15:15') at time zone 'America/Toronto',
    (v_next_monday + 2 + time '16:00') at time zone 'America/Toronto',
    v_preschool, v_host, null, 'open', v_host
  ),
  (
    '42610000-0000-4000-a000-000000000003', v_daycare,
    (v_next_monday + 7 + time '10:15') at time zone 'America/Toronto',
    (v_next_monday + 7 + time '11:00') at time zone 'America/Toronto',
    v_preschool, v_host, null, 'open', v_host
  ),
  (
    '42610000-0000-4000-a000-000000000004', v_daycare,
    v_booked_at, v_booked_at + interval '45 minutes',
    v_preschool, v_host, v_tour, 'booked', v_host
  );

  update public.enrollments
  set tour_at = v_booked_at, tour_host_id = v_host
  where id = v_tour;

  perform public.reindex_center_waitlist(v_daycare);
end;
$$;
