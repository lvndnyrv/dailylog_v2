-- ============================================================================
-- Group 2 enrollment & waitlist demo state
-- Covers every operational variation shown by the admin handoff: ranked
-- waitlist, held offer, tours, applications/documents, onboarding, stale-list
-- check-ins, a scheduled departure, and an alumni record. Safe to rerun.
-- ============================================================================

-- Remove the five non-deterministic baseline examples before replacing them
-- with stable records. This only targets the Sunny Grove demo addresses.
delete from enrollments
 where daycare_id = '10000000-0000-4000-a000-000000000001'
   and guardian_email in (
     'dana.alvarez@family.test', 'yuki.sato@family.test',
     'marc.laurent@family.test', 'anne.moreau@family.test',
     'pat.brennan@family.test'
   )
   and id::text not like '41000000-0000-4000-a000-%';

insert into enrollment_settings (
  daycare_id, siblings_first, staff_children_next, offer_window_hours,
  auto_offer, auto_archive_checkins, inquiry_reply_hours
) values (
  '10000000-0000-4000-a000-000000000001', true, true, 48, true, 2, 24
)
on conflict (daycare_id) do update set
  siblings_first = excluded.siblings_first,
  staff_children_next = excluded.staff_children_next,
  offer_window_hours = excluded.offer_window_hours,
  auto_offer = excluded.auto_offer,
  auto_archive_checkins = excluded.auto_archive_checkins,
  inquiry_reply_hours = excluded.inquiry_reply_hours;

insert into enrollments (
  id, daycare_id, classroom_id, child_first_name, child_last_name,
  child_date_of_birth, guardian_name, guardian_email, guardian_phone,
  stage, desired_start_date, source, notes, waitlist_position,
  schedule, application_data, documents_status, application_progress,
  tour_at, tour_host_id, tour_outcome, tour_notes,
  offer_sent_at, offer_expires_at, offer_viewed_at, offer_nudged_at,
  offer_status, offer_deposit_cents, offer_tuition_cents,
  waitlist_joined_at, waitlist_priority, waitlist_status,
  waitlist_last_contact_at, waitlist_unanswered_checkins,
  onboarding_steps, stage_changed_at, created_at
) values
  (
    '41000000-0000-4000-a000-000000000001',
    '10000000-0000-4000-a000-000000000001',
    '20000000-0000-4000-a000-000000000001',
    'Mia', 'Baker', (current_date - interval '12 months')::date,
    'Olivia Baker', 'olivia.baker@family.test', '555-0201',
    'offer', current_date + 28, 'sibling referral',
    'Older brother is already enrolled in Toddler.', 1,
    '{"days_per_week":5,"label":"Mon–Fri · full day","dropoff":"7:30","pickup":"17:30"}',
    '{"parent_2":"Noah Baker","allergy":"None","start_flexibility":"2 weeks"}',
    '{"immunization":"received","emergency_contacts":"received","medical":"received","handbook":"received"}',
    100, null, null, null, null,
    now() - interval '20 hours', now() + interval '28 hours',
    now() - interval '10 hours', null, 'viewed', 50000, 128000,
    now() - interval '10 months', 'sibling', 'offer', now() - interval '10 hours', 0,
    '{}', now() - interval '20 hours', now() - interval '10 months'
  ),
  (
    '41000000-0000-4000-a000-000000000002',
    '10000000-0000-4000-a000-000000000001',
    '20000000-0000-4000-a000-000000000001',
    'Zane', 'Okafor', (current_date - interval '13 months')::date,
    'Ngozi Okafor', 'ngozi.okafor.waitlist@family.test', '555-0202',
    'application', current_date + 45, 'website',
    'Needs an 8:00 AM start.', 2,
    '{"days_per_week":5,"label":"Mon–Fri · full day","dropoff":"8:00","pickup":"17:00"}',
    '{"parent_2":"Chidi Okafor","allergy":"Egg sensitivity"}',
    '{"immunization":"received","emergency_contacts":"received","medical":"requested","handbook":"received"}',
    80, null, null, null, null,
    null, null, null, null, 'draft', null, null,
    now() - interval '8 months', 'public', 'active', now() - interval '2 months', 0,
    '{}', now() - interval '6 days', now() - interval '8 months'
  ),
  (
    '41000000-0000-4000-a000-000000000003',
    '10000000-0000-4000-a000-000000000001',
    '20000000-0000-4000-a000-000000000003',
    'Chloé', 'Laurent', (current_date - interval '2 years')::date,
    'Camille Laurent', 'marc.laurent@family.test', '555-0103',
    'tour', current_date + 20, 'referral',
    'Parents asked about the summer menu and nap setup.', 3,
    '{"days_per_week":5,"label":"Mon–Fri · full day","dropoff":"7:30","pickup":"17:30"}',
    '{"parent_2":"Marc Laurent","parent_2_email":"marc.l@email.com","allergy":"Peanut allergy — EpiPen in her bag","start_flexibility":"2 weeks"}',
    '{"immunization":"received","emergency_contacts":"received","medical":"missing","handbook":"missing"}',
    55,
    ((current_date + 1 + time '10:00') at time zone 'America/Toronto'),
    '00000000-0000-4000-a000-000000000005', null, null,
    null, null, null, null, 'draft', null, 118000,
    now() - interval '7 months', 'public', 'active', now() - interval '1 month', 0,
    '{}', now() - interval '6 days', now() - interval '7 months'
  ),
  (
    '41000000-0000-4000-a000-000000000004',
    '10000000-0000-4000-a000-000000000001',
    '20000000-0000-4000-a000-000000000002',
    'Jun', 'Kim', (current_date - interval '25 months')::date,
    'Sora Kim', 'sora.kim@family.test', '555-0204',
    'tour', current_date + 30, 'website', 'Needs a vegetarian lunch.', 4,
    '{"days_per_week":3,"label":"Mon · Wed · Fri"}', '{}', '{}', 10,
    ((current_date + 2 + time '09:30') at time zone 'America/Toronto'),
    '00000000-0000-4000-a000-000000000008', null, null,
    null, null, null, null, 'draft', null, null,
    now() - interval '6 months', 'public', 'active', now() - interval '2 months', 0,
    '{}', now() - interval '5 days', now() - interval '6 months'
  ),
  (
    '41000000-0000-4000-a000-000000000005',
    '10000000-0000-4000-a000-000000000001',
    '20000000-0000-4000-a000-000000000001',
    'Leo', 'Alvarez', (current_date - interval '14 months')::date,
    'Dana Alvarez', 'dana.alvarez@family.test', '555-0101',
    'inquiry', current_date + 45, 'website', null, 5,
    '{"days_per_week":5}', '{}', '{}', 0, null, null, null, null,
    null, null, null, null, 'draft', null, null,
    now() - interval '5 months', 'public', 'active', now() - interval '6 weeks', 0,
    '{}', now() - interval '3 days', now() - interval '5 months'
  ),
  (
    '41000000-0000-4000-a000-000000000006',
    '10000000-0000-4000-a000-000000000001',
    '20000000-0000-4000-a000-000000000003',
    'Sofia', 'Rossi', (current_date - interval '4 years')::date,
    'Nina Rossi', 'nina.rossi@family.test', '555-0206',
    'application', current_date + 60, 'website', null, 6,
    '{"days_per_week":5}', '{}', '{"immunization":"received"}', 35,
    null, null, null, null, null, null, null, null, 'draft', null, null,
    now() - interval '8 months', 'public', 'active', now() - interval '5 months', 1,
    '{}', now() - interval '2 months', now() - interval '8 months'
  ),
  (
    '41000000-0000-4000-a000-000000000007',
    '10000000-0000-4000-a000-000000000001',
    '20000000-0000-4000-a000-000000000001',
    'Emil', 'Novak', (current_date - interval '10 months')::date,
    'Petra Novak', 'petra.novak@family.test', '555-0207',
    'inquiry', current_date + 90, 'website', null, 7,
    '{"days_per_week":3}', '{}', '{}', 0, null, null, null, null,
    null, null, null, null, 'draft', null, null,
    now() - interval '7 months', 'public', 'active', now() - interval '6 months', 1,
    '{}', now() - interval '3 months', now() - interval '7 months'
  ),
  (
    '41000000-0000-4000-a000-000000000008',
    '10000000-0000-4000-a000-000000000001',
    '20000000-0000-4000-a000-000000000002',
    'Ada', 'Achebe', (current_date - interval '2 years')::date,
    'Chinwe Achebe', 'chinwe.achebe@family.test', '555-0208',
    'inquiry', current_date + 75, 'referral', null, 8,
    '{"days_per_week":2}', '{}', '{}', 0, null, null, null, null,
    null, null, null, null, 'draft', null, null,
    now() - interval '6 months', 'public', 'active', now() - interval '2 months', 0,
    '{}', now() - interval '2 months', now() - interval '6 months'
  ),
  (
    '41000000-0000-4000-a000-000000000009',
    '10000000-0000-4000-a000-000000000001',
    '20000000-0000-4000-a000-000000000002',
    'Élise', 'Moreau', (current_date - interval '18 months')::date,
    'Anne Moreau', 'anne.moreau@family.test', '555-0104',
    'application', current_date + 60, 'referral', 'Flexible by two weeks.', null,
    '{"days_per_week":5,"label":"Mon–Fri · full day"}',
    '{"parent_2":"Luc Moreau","allergy":"None"}',
    '{"immunization":"received","emergency_contacts":"received","medical":"missing","handbook":"missing"}',
    55, null, null, null, null, null, null, null, null, 'draft', null, 104000,
    null, 'public', 'not_waitlisted', null, 0, '{}', now() - interval '4 days', now() - interval '9 days'
  ),
  (
    '41000000-0000-4000-a000-000000000010',
    '10000000-0000-4000-a000-000000000001',
    '20000000-0000-4000-a000-000000000003',
    'Kenji', 'Sato', (current_date - interval '3 years')::date,
    'Yuki Sato', 'yuki.sato@family.test', '555-0102',
    'inquiry', current_date + 45, 'website', null, null,
    '{"days_per_week":3}', '{}', '{}', 0, null, null, null, null,
    null, null, null, null, 'draft', null, null,
    null, 'public', 'not_waitlisted', null, 0, '{}', now() - interval '1 day', now() - interval '1 day'
  ),
  (
    '41000000-0000-4000-a000-000000000011',
    '10000000-0000-4000-a000-000000000001',
    '20000000-0000-4000-a000-000000000003',
    'Anya', 'Petrov', (current_date - interval '3 years 8 months')::date,
    'Mila Petrov', 'mila.petrov@family.test', '555-0211',
    'application', current_date + 36, 'tour follow-up', 'Very likely to enroll.', null,
    '{"days_per_week":5,"label":"Mon–Fri · full day"}',
    '{"parent_2":"Ivan Petrov","allergy":"Dairy-free meals"}',
    '{"immunization":"received","emergency_contacts":"requested","medical":"received","handbook":"missing"}',
    70, null, null, 'attended', 'Loved the Preschool room.',
    null, null, null, null, 'draft', null, 118000,
    null, 'public', 'not_waitlisted', null, 0, '{}', now() - interval '2 days', now() - interval '12 days'
  ),
  (
    '41000000-0000-4000-a000-000000000012',
    '10000000-0000-4000-a000-000000000001',
    '20000000-0000-4000-a000-000000000003',
    'Zoé', 'Fontaine', (current_date - interval '3 years')::date,
    'Lucie Fontaine', 'lucie.fontaine@family.test', '555-0212',
    'enrolled', current_date + 14, 'website', null, null,
    '{"days_per_week":5,"label":"Mon–Fri · full day"}',
    '{"allergy":"Peanut-free lunch"}',
    '{"immunization":"received","emergency_contacts":"received","medical":"received","handbook":"received"}',
    100, null, null, 'attended', null,
    now() - interval '16 days', now() - interval '14 days', now() - interval '15 days', null,
    'accepted', 50000, 118000, null, 'public', 'not_waitlisted', null, 0,
    '{"room_schedule":"Preschool · Mon–Fri · primary educator assigned","first_day":false}',
    now() - interval '14 days', now() - interval '28 days'
  ),
  (
    '41000000-0000-4000-a000-000000000013',
    '10000000-0000-4000-a000-000000000001',
    '20000000-0000-4000-a000-000000000003',
    'Rory', 'Brennan', (current_date - interval '4 years')::date,
    'Pat Brennan', 'pat.brennan@family.test', '555-0105',
    'inquiry', current_date + 10, 'walk-in', 'Family is comparing two centers.', null,
    '{"days_per_week":5}', '{}', '{}', 0, null, null, null, null,
    null, null, null, null, 'draft', null, null,
    null, 'public', 'not_waitlisted', null, 0, '{}', now() - interval '12 days', now() - interval '12 days'
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
  notes = excluded.notes,
  waitlist_position = excluded.waitlist_position,
  schedule = excluded.schedule,
  application_data = excluded.application_data,
  documents_status = excluded.documents_status,
  application_progress = excluded.application_progress,
  tour_at = excluded.tour_at,
  tour_host_id = excluded.tour_host_id,
  tour_outcome = excluded.tour_outcome,
  tour_notes = excluded.tour_notes,
  offer_sent_at = excluded.offer_sent_at,
  offer_expires_at = excluded.offer_expires_at,
  offer_viewed_at = excluded.offer_viewed_at,
  offer_nudged_at = excluded.offer_nudged_at,
  offer_status = excluded.offer_status,
  offer_deposit_cents = excluded.offer_deposit_cents,
  offer_tuition_cents = excluded.offer_tuition_cents,
  waitlist_joined_at = excluded.waitlist_joined_at,
  waitlist_priority = excluded.waitlist_priority,
  waitlist_status = excluded.waitlist_status,
  waitlist_last_contact_at = excluded.waitlist_last_contact_at,
  waitlist_unanswered_checkins = excluded.waitlist_unanswered_checkins,
  onboarding_steps = excluded.onboarding_steps,
  stage_changed_at = excluded.stage_changed_at,
  created_at = excluded.created_at;

-- Tour slots 2h: two booked slots and two open slots for manual booking.
insert into enrollment_tour_slots (
  id, daycare_id, starts_at, ends_at, classroom_id, host_id,
  enrollment_id, status, created_by
) values
  ('42000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000001',
   ((current_date + 1 + time '10:00') at time zone 'America/Toronto'),
   ((current_date + 1 + time '10:45') at time zone 'America/Toronto'),
   '20000000-0000-4000-a000-000000000003', '00000000-0000-4000-a000-000000000005',
   '41000000-0000-4000-a000-000000000003', 'booked', '00000000-0000-4000-a000-000000000001'),
  ('42000000-0000-4000-a000-000000000002', '10000000-0000-4000-a000-000000000001',
   ((current_date + 2 + time '09:30') at time zone 'America/Toronto'),
   ((current_date + 2 + time '10:15') at time zone 'America/Toronto'),
   '20000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000008',
   '41000000-0000-4000-a000-000000000004', 'booked', '00000000-0000-4000-a000-000000000001'),
  ('42000000-0000-4000-a000-000000000003', '10000000-0000-4000-a000-000000000001',
   ((current_date + 3 + time '10:00') at time zone 'America/Toronto'),
   ((current_date + 3 + time '10:45') at time zone 'America/Toronto'),
   '20000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000003',
   null, 'open', '00000000-0000-4000-a000-000000000001'),
  ('42000000-0000-4000-a000-000000000004', '10000000-0000-4000-a000-000000000001',
   ((current_date + 4 + time '16:00') at time zone 'America/Toronto'),
   ((current_date + 4 + time '16:45') at time zone 'America/Toronto'),
   '20000000-0000-4000-a000-000000000003', null,
   null, 'open', '00000000-0000-4000-a000-000000000001')
on conflict (id) do update set
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  classroom_id = excluded.classroom_id,
  host_id = excluded.host_id,
  enrollment_id = excluded.enrollment_id,
  status = excluded.status;

-- One completed departure powers the alumni/re-enroll popover. The scheduled
-- example shows the retained roster state and future opening logic.
insert into children (
  id, daycare_id, classroom_id, first_name, last_name, date_of_birth,
  enrolled_on, archived_at
) values (
  '43000000-0000-4000-a000-000000000001',
  '10000000-0000-4000-a000-000000000001',
  '20000000-0000-4000-a000-000000000003',
  'Avery', 'Morgan', (current_date - interval '6 years')::date,
  current_date - interval '2 years', now() - interval '6 months'
)
on conflict (id) do update set
  classroom_id = excluded.classroom_id,
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  date_of_birth = excluded.date_of_birth,
  enrolled_on = excluded.enrolled_on,
  archived_at = excluded.archived_at;

insert into child_departures (
  id, daycare_id, child_id, last_day, reason, notes,
  offer_spot_automatically, status, scheduled_by, completed_at
) values
  ('44000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000001',
   '43000000-0000-4000-a000-000000000001', current_date - interval '6 months',
   'Family moved', 'Records retained for a possible return.', true, 'completed',
   '00000000-0000-4000-a000-000000000001', now() - interval '6 months'),
  ('44000000-0000-4000-a000-000000000002', '10000000-0000-4000-a000-000000000001',
   '30000000-0000-4000-a000-000000000013', current_date + 30,
   'Family is moving', 'Four weeks notice received.', true, 'scheduled',
   '00000000-0000-4000-a000-000000000001', null)
on conflict (id) do update set
  last_day = excluded.last_day,
  reason = excluded.reason,
  notes = excluded.notes,
  offer_spot_automatically = excluded.offer_spot_automatically,
  status = excluded.status,
  completed_at = excluded.completed_at;
