-- Idempotent Group 15 demo data for parent and educator medication flows.

update medication_authorizations
   set route = 'Oral',
       as_needed_condition = 'Give with breakfast',
       max_daily_doses = 1,
       end_date = current_date + 60,
       signed_name = 'Chidi Okafor',
       signed_at = coalesce(signed_at, created_at)
 where id = '52000000-0000-4000-a000-000000000002'
   and signed_at is null;

update medication_authorizations
   set route = 'Injection',
       as_needed_condition = 'Emergency allergic reaction',
       max_daily_doses = 1,
       end_date = current_date + 35,
       signed_name = 'Marc Danyar',
       signed_at = coalesce(signed_at, created_at)
 where id = '51900000-0000-4000-a000-000000000001'
   and signed_at is null;

update medication_authorizations
   set route = 'Inhaled',
       as_needed_condition = coalesce(as_needed_condition, schedule),
       max_daily_doses = coalesce(max_daily_doses, 4),
       end_date = coalesce(end_date, current_date + 90),
       signed_name = coalesce(signed_name, parent.full_name),
       signed_at = coalesce(signed_at, medication_authorizations.created_at)
  from profiles parent
 where medication_authorizations.parent_id = parent.id
   and medication_authorizations.active
   and medication_authorizations.signed_at is null
   and (
     lower(medication_authorizations.name) like '%inhaler%'
     or lower(medication_authorizations.dosage) like '%puff%'
   );

insert into medication_logs (
  id,
  daycare_id,
  authorization_id,
  child_id,
  administered_by,
  witness_id,
  administered_at,
  dosage_given,
  route_given,
  safety_checks,
  notes,
  parent_notified_at
)
select
  '52900000-0000-4000-a000-000000000001',
  auth_row.daycare_id,
  auth_row.id,
  auth_row.child_id,
  '00000000-0000-4000-a000-000000000003',
  '00000000-0000-4000-a000-000000000001',
  (current_date + time '09:05') at time zone 'America/Toronto',
  auth_row.dosage,
  auth_row.route,
  '{"right_child": true, "right_medication": true, "right_dose": true, "right_route": true, "right_time": true}'::jsonb,
  'Given with breakfast; no concerns observed.',
  (current_date + time '09:06') at time zone 'America/Toronto'
from medication_authorizations auth_row
where auth_row.id = '52000000-0000-4000-a000-000000000002'
on conflict (id) do update set
  administered_at = excluded.administered_at,
  dosage_given = excluded.dosage_given,
  route_given = excluded.route_given,
  safety_checks = excluded.safety_checks,
  notes = excluded.notes,
  parent_notified_at = excluded.parent_notified_at;
