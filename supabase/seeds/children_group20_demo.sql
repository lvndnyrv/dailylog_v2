-- ============================================================================
-- Group 20 Children roster and medical-register demo state
-- Idempotent: safe after local resets and on the shared development project.
-- ============================================================================

-- setup_state records that each checklist area has been reviewed, including a
-- deliberate "none on file" medical review. Two profiles remain incomplete so
-- 20a always demonstrates its setup warning and progress badges.
update children
set setup_state = jsonb_build_object(
  'basics', true,
  'photo', true,
  'medical', true,
  'emergency', true,
  'parents', true
)
where daycare_id = '10000000-0000-4000-a000-000000000001'
  and archived_at is null;

update children
set setup_state = jsonb_build_object(
  'basics', true,
  'photo', true,
  'medical', false,
  'emergency', false,
  'parents', false
)
where daycare_id = '10000000-0000-4000-a000-000000000001'
  and first_name = 'David'
  and last_name = 'Danyar';

update children
set setup_state = jsonb_build_object(
  'basics', true,
  'photo', false,
  'medical', true,
  'emergency', true,
  'parents', true
)
where daycare_id = '10000000-0000-4000-a000-000000000001'
  and first_name = 'Ada'
  and last_name = 'Whitfield';

-- Medical details give 20b severe, routine, medication-only and pending-
-- authorization rows. Contacts are fictitious development data.
update children
set allergies = array['Peanuts'],
    medical_notes = 'Severe allergy. Carries an EpiPen in the classroom medication box.',
    emergency_contacts = '[{"name":"Sara Danyar","relation":"Mother","phone":"416-555-0199"}]'::jsonb
where id = '30000000-0000-4000-a000-000000000002';

update children
set allergies = array['Dairy'],
    medical_notes = 'Avoid dairy ingredients and shared serving utensils.',
    emergency_contacts = '[{"name":"Rui Whitfield","relation":"Father","phone":"416-555-0144"}]'::jsonb
where id = '30000000-0000-4000-a000-000000000004';

update children
set allergies = array['Bee stings'],
    medical_notes = 'Antihistamine plan is filed with the room lead.',
    emergency_contacts = '[{"name":"Marta Ferreira","relation":"Mother","phone":"416-555-0145"}]'::jsonb
where id = '30000000-0000-4000-a000-000000000005';

update children
set allergies = array[]::text[],
    medical_notes = 'Vitamin D drops are supplied by the family.',
    emergency_contacts = '[{"name":"Chidi Okafor","relation":"Father","phone":"416-555-0146"}]'::jsonb
where id = '30000000-0000-4000-a000-000000000006';

update children
set allergies = array['Eggs'],
    medical_notes = 'History of anaphylaxis. EpiPen travels with the child.',
    emergency_contacts = '[{"name":"Abena Mensah","relation":"Mother","phone":"416-555-0151"}]'::jsonb
where id = '30000000-0000-4000-a000-000000000011';

update children
set allergies = array[]::text[],
    medical_notes = 'Asthma action plan reviewed with the family.',
    emergency_contacts = '[{"name":"Van Tran","relation":"Mother","phone":"416-555-0141"}]'::jsonb
where id = '30000000-0000-4000-a000-000000000001';

insert into medication_authorizations (
  id, daycare_id, child_id, parent_id, name, dosage, schedule, notes, active
)
select
  '52000000-0000-4000-a000-000000000001', c.daycare_id, c.id,
  (select pc.parent_id from parent_children pc where pc.child_id = c.id limit 1),
  'Antihistamine', '5 mL', 'As needed', 'For bee-sting reaction plan.', true
from children c where c.id = '30000000-0000-4000-a000-000000000005'
on conflict (id) do update set
  name = excluded.name, dosage = excluded.dosage, schedule = excluded.schedule,
  notes = excluded.notes, active = excluded.active, updated_at = now();

insert into medication_authorizations (
  id, daycare_id, child_id, parent_id, name, dosage, schedule, notes, active
)
select
  '52000000-0000-4000-a000-000000000002', c.daycare_id, c.id,
  (select pc.parent_id from parent_children pc where pc.child_id = c.id limit 1),
  'Vitamin D drops', '1 drop', 'With breakfast', 'Family-supplied bottle.', true
from children c where c.id = '30000000-0000-4000-a000-000000000006'
on conflict (id) do update set
  name = excluded.name, dosage = excluded.dosage, schedule = excluded.schedule,
  notes = excluded.notes, active = excluded.active, updated_at = now();

insert into medication_authorizations (
  id, daycare_id, child_id, parent_id, name, dosage, schedule, notes, active
)
select
  '52000000-0000-4000-a000-000000000003', c.daycare_id, c.id,
  (select pc.parent_id from parent_children pc where pc.child_id = c.id limit 1),
  'EpiPen Jr.', '0.15 mg', 'Emergency / as needed', 'Stored in the labelled room kit.', true
from children c where c.id = '30000000-0000-4000-a000-000000000011'
on conflict (id) do update set
  name = excluded.name, dosage = excluded.dosage, schedule = excluded.schedule,
  notes = excluded.notes, active = excluded.active, updated_at = now();

insert into medication_authorizations (
  id, daycare_id, child_id, parent_id, name, dosage, schedule, notes, active
)
select
  '52000000-0000-4000-a000-000000000004', c.daycare_id, c.id,
  (select pc.parent_id from parent_children pc where pc.child_id = c.id limit 1),
  'Fluticasone inhaler', '1 puff', 'Before outdoor play', 'Use with spacer.', true
from children c where c.id = '30000000-0000-4000-a000-000000000001'
on conflict (id) do update set
  name = excluded.name, dosage = excluded.dosage, schedule = excluded.schedule,
  notes = excluded.notes, active = excluded.active, updated_at = now();

insert into medication_authorizations (
  id, daycare_id, child_id, parent_id, name, dosage, schedule, notes, active
)
select
  '52000000-0000-4000-a000-000000000005', c.daycare_id, c.id, null,
  'Salbutamol rescue inhaler', '2 puffs', 'Emergency / as needed',
  'Awaiting renewed parent authorization.', false
from children c where c.id = '30000000-0000-4000-a000-000000000001'
on conflict (id) do update set
  name = excluded.name, dosage = excluded.dosage, schedule = excluded.schedule,
  notes = excluded.notes, active = excluded.active, updated_at = now();
