-- Resettable Parent Mobile Group 23 medication history for Lucia and Mateo.
-- Login: lucia.castillo@parent.test / password123

delete from public.notification_outbox
 where payload->>'group' = 'parent_medication_23';
delete from public.notifications
 where payload->>'group' = 'parent_medication_23';
delete from public.medication_logs
 where id in (
   '52310000-0000-4000-a000-000000000001',
   '52310000-0000-4000-a000-000000000002'
 );
delete from public.medication_authorizations
 where id in (
   '52300000-0000-4000-a000-000000000001',
   '52300000-0000-4000-a000-000000000002',
   '52300000-0000-4000-a000-000000000003'
 );

insert into public.medication_authorizations (
  id, daycare_id, child_id, parent_id, name, dosage, route,
  medication_type, schedule_type, scheduled_times, schedule,
  as_needed_condition, max_daily_doses, notes, active,
  start_date, end_date, signed_name, signed_at, consented_at,
  authorization_version, renewed_from_id
) values (
  '52300000-0000-4000-a000-000000000001',
  '10000000-0000-4000-a000-000000000001',
  '30000000-0000-4000-a000-000000000013',
  '00000000-0000-4000-a000-000000000023',
  'Amoxicillin', '5 ml', 'Oral', 'prescription', 'scheduled',
  array[
    (((now() at time zone 'America/Toronto') + interval '2 hours')::time),
    (((now() at time zone 'America/Toronto') + interval '7 hours')::time)
  ],
  'Twice daily · with food', null, null,
  'Keep refrigerated in the labelled medication bin.', true,
  (now() at time zone 'America/Toronto')::date - 3,
  (now() at time zone 'America/Toronto')::date + 7,
  'Lucia Castillo', now() - interval '3 days', now() - interval '3 days',
  '2026-08-09', null
), (
  '52300000-0000-4000-a000-000000000002',
  '10000000-0000-4000-a000-000000000001',
  '30000000-0000-4000-a000-000000000013',
  '00000000-0000-4000-a000-000000000023',
  'Children''s acetaminophen', '7.5 ml', 'Oral',
  'over_the_counter', 'as_needed', '{}'::time[], 'As needed',
  'Fever above 38.5°C after contacting Lucia', 3,
  'Use only the sealed bottle supplied by the family.', false,
  (now() at time zone 'America/Toronto')::date - 45,
  (now() at time zone 'America/Toronto')::date - 16,
  'Lucia Castillo', now() - interval '45 days', now() - interval '45 days',
  '2026-08-09', null
), (
  '52300000-0000-4000-a000-000000000003',
  '10000000-0000-4000-a000-000000000001',
  '30000000-0000-4000-a000-000000000013',
  '00000000-0000-4000-a000-000000000023',
  'Amoxicillin renewal', '5 ml', 'Oral', 'prescription', 'scheduled',
  array[
    (((now() at time zone 'America/Toronto') + interval '2 hours')::time),
    (((now() at time zone 'America/Toronto') + interval '7 hours')::time)
  ],
  'Twice daily · with food', null, null,
  'Renewed course; use the newly supplied labelled bottle.', true,
  (now() at time zone 'America/Toronto')::date + 8,
  (now() at time zone 'America/Toronto')::date + 15,
  'Lucia Castillo', now(), now(),
  '2026-08-09', '52300000-0000-4000-a000-000000000001'
);

insert into public.medication_logs (
  id, daycare_id, authorization_id, child_id, administered_by, witness_id,
  administered_at, dosage_given, route_given, safety_checks, notes,
  parent_notified_at
) values (
  '52310000-0000-4000-a000-000000000001',
  '10000000-0000-4000-a000-000000000001',
  '52300000-0000-4000-a000-000000000001',
  '30000000-0000-4000-a000-000000000013',
  '00000000-0000-4000-a000-000000000003',
  '00000000-0000-4000-a000-000000000001',
  now() - interval '20 minutes',
  '5 ml', 'Oral',
  '{"right_child":true,"right_medication":true,"right_dose":true,"right_route":true,"right_time":true}'::jsonb,
  'Given with breakfast · no concerns observed.',
  now() - interval '19 minutes'
), (
  '52310000-0000-4000-a000-000000000002',
  '10000000-0000-4000-a000-000000000001',
  '52300000-0000-4000-a000-000000000001',
  '30000000-0000-4000-a000-000000000013',
  '00000000-0000-4000-a000-000000000003',
  '00000000-0000-4000-a000-000000000001',
  (((now() at time zone 'America/Toronto')::date - 1) + time '16:15') at time zone 'America/Toronto',
  '5 ml', 'Oral',
  '{"right_child":true,"right_medication":true,"right_dose":true,"right_route":true,"right_time":true}'::jsonb,
  'Given after afternoon snack.',
  (((now() at time zone 'America/Toronto')::date - 1) + time '16:16') at time zone 'America/Toronto'
);
