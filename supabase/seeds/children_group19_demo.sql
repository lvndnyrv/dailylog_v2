-- ============================================================================
-- Group 19 child-profile demo state
-- David Danyar reproduces 19a-19d with a 40% checklist, weekly schedule,
-- medical authorizations, pickups, consents, documents, and a parent invite.
-- Idempotent and intended for local/shared development data only.
-- ============================================================================

update children
set classroom_id = (select id from classrooms where daycare_id = children.daycare_id and name = 'Preschool' limit 1),
    preferred_name = 'Davey',
    pronouns = 'he / him',
    date_of_birth = '2023-12-22',
    enrolled_on = '2026-02-03',
    home_address = '142 Maplewood Ave, Toronto, ON M6H 2K4',
    dietary_needs = 'Nut-free meals and snacks',
    allergies = array['Peanuts'],
    medical_notes = 'Severe allergy. Carries an EpiPen in the classroom medication box. Mild seasonal asthma; inhaler on file.',
    emergency_contacts = '[{"name":"Sara Danyar","relation":"Mother","phone":"416-555-0199"}]'::jsonb,
    setup_state = '{"basics":true,"photo":true,"medical":false,"emergency":false,"parents":false,"weekly_schedule":{"mon":"full","tue":"full","wed":"full","thu":"full","fri":"off"}}'::jsonb
where id = '30000000-0000-4000-a000-000000000002';

delete from medication_authorizations
where child_id = '30000000-0000-4000-a000-000000000002';

insert into medication_authorizations (
  id, daycare_id, child_id, parent_id, name, dosage, schedule, notes, active
) values
  (
    '51900000-0000-4000-a000-000000000001',
    '10000000-0000-4000-a000-000000000001',
    '30000000-0000-4000-a000-000000000002',
    '00000000-0000-4000-a000-000000000012',
    'EpiPen Jr.', '0.15 mg', 'Emergency / as needed',
    'Stored in the labelled Preschool medication box.', true
  ),
  (
    '51900000-0000-4000-a000-000000000002',
    '10000000-0000-4000-a000-000000000001',
    '30000000-0000-4000-a000-000000000002',
    null,
    'Salbutamol inhaler', '2 puffs', 'Before outdoor play',
    'Awaiting renewed parent authorization.', false
  );

update child_pickups
set archived_at = now()
where child_id = '30000000-0000-4000-a000-000000000002';

insert into child_pickups (
  id, daycare_id, child_id, full_name, relationship, phone, pin,
  is_primary, created_by, archived_at
) values
  (
    '41900000-0000-4000-a000-000000000001',
    '10000000-0000-4000-a000-000000000001',
    '30000000-0000-4000-a000-000000000002',
    'Marc Danyar', 'Father', '416-555-0171', '4471', true,
    '00000000-0000-4000-a000-000000000001', null
  ),
  (
    '41900000-0000-4000-a000-000000000002',
    '10000000-0000-4000-a000-000000000001',
    '30000000-0000-4000-a000-000000000002',
    'Rosa Torres', 'Grandmother', '416-555-0182', '8820', false,
    '00000000-0000-4000-a000-000000000001', null
  )
on conflict (id) do update set
  full_name = excluded.full_name,
  relationship = excluded.relationship,
  phone = excluded.phone,
  pin = excluded.pin,
  is_primary = excluded.is_primary,
  archived_at = null,
  updated_at = now();

delete from child_invite_codes
where child_id = '30000000-0000-4000-a000-000000000002'
  and used_at is null;

insert into child_invite_codes (
  id, daycare_id, child_id, code, email, relationship, created_by, expires_at
) values (
  '61900000-0000-4000-a000-000000000001',
  '10000000-0000-4000-a000-000000000001',
  '30000000-0000-4000-a000-000000000002',
  'DAVID19A', 'sara.danyar@parent.test', 'Mother',
  '00000000-0000-4000-a000-000000000001', now() + interval '14 days'
);

insert into consents (
  daycare_id, child_id, parent_id, kind, version, granted, granted_at
) values
  (
    '10000000-0000-4000-a000-000000000001',
    '30000000-0000-4000-a000-000000000002',
    '00000000-0000-4000-a000-000000000012',
    'Photo & media consent', '1', true, now() - interval '3 months'
  ),
  (
    '10000000-0000-4000-a000-000000000001',
    '30000000-0000-4000-a000-000000000002',
    '00000000-0000-4000-a000-000000000012',
    'Field-trip permission', '1', true, now() - interval '2 months'
  ),
  (
    '10000000-0000-4000-a000-000000000001',
    '30000000-0000-4000-a000-000000000002',
    '00000000-0000-4000-a000-000000000012',
    'Sunscreen application', '1', false, null
  )
on conflict (child_id, kind, version) do update set
  parent_id = excluded.parent_id,
  granted = excluded.granted,
  granted_at = excluded.granted_at,
  revoked_at = case when excluded.granted then null else now() end,
  updated_at = now();

update documents
set archived_at = now()
where child_id = '30000000-0000-4000-a000-000000000002'
  and category in ('immunization_record', 'enrollment_agreement');

insert into documents (
  id, daycare_id, child_id, title, category, storage_path, mime_type,
  size_bytes, uploaded_by, archived_at
) values
  (
    '71900000-0000-4000-a000-000000000001',
    '10000000-0000-4000-a000-000000000001',
    '30000000-0000-4000-a000-000000000002',
    'Immunization record', 'immunization_record',
    'demo://group19/immunization-record', 'application/pdf', 18432,
    '00000000-0000-4000-a000-000000000001', null
  ),
  (
    '71900000-0000-4000-a000-000000000002',
    '10000000-0000-4000-a000-000000000001',
    '30000000-0000-4000-a000-000000000002',
    'Enrollment agreement', 'enrollment_agreement',
    'demo://group19/enrollment-agreement', 'application/pdf', 22528,
    '00000000-0000-4000-a000-000000000001', null
  )
on conflict (id) do update set
  title = excluded.title,
  category = excluded.category,
  storage_path = excluded.storage_path,
  mime_type = excluded.mime_type,
  size_bytes = excluded.size_bytes,
  archived_at = null,
  updated_at = now();
