-- ============================================================================
-- Group 4g/4h delegation demo state. Safe to rerun.
-- ============================================================================

insert into staff_delegations (
  id, daycare_id, delegate_profile_id, access_level, areas,
  starts_at, ends_at, granted_by, revoked_at, revoked_by
) values
  (
    '47000000-0000-4000-a000-000000000001',
    '10000000-0000-4000-a000-000000000001',
    '00000000-0000-4000-a000-000000000008',
    'full_admin', '{}',
    now() - interval '4 days', now() + interval '14 days',
    '00000000-0000-4000-a000-000000000001', null, null
  ),
  (
    '47000000-0000-4000-a000-000000000002',
    '10000000-0000-4000-a000-000000000001',
    '00000000-0000-4000-a000-000000000007',
    'specific_areas', array['enrollment'],
    now() - interval '46 days', now() - interval '39 days',
    '00000000-0000-4000-a000-000000000001', null, null
  )
on conflict (id) do update set
  delegate_profile_id = excluded.delegate_profile_id,
  access_level = excluded.access_level,
  areas = excluded.areas,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  granted_by = excluded.granted_by,
  revoked_at = excluded.revoked_at,
  revoked_by = excluded.revoked_by;

-- Fourteen representative actions make the active card's attribution count
-- meaningful without changing operational records. Stable IDs prevent reruns
-- from inflating the number.
insert into audit_log (
  id, daycare_id, actor_id, action, entity_type, entity_id, before, after, created_at
)
select
  ('47100000-0000-4000-a000-' || lpad(n::text, 12, '0'))::uuid,
  '10000000-0000-4000-a000-000000000001'::uuid,
  '00000000-0000-4000-a000-000000000008'::uuid,
  case when n % 3 = 0 then 'update' else 'insert' end,
  case n % 4
    when 0 then 'attendance_records'
    when 1 then 'enrollments'
    when 2 then 'incident_reports'
    else 'announcements'
  end,
  null,
  null,
  jsonb_build_object('demo', true, 'sequence', n),
  now() - interval '4 days' + (n || ' hours')::interval
from generate_series(1, 14) n
on conflict (id) do update set
  actor_id = excluded.actor_id,
  action = excluded.action,
  entity_type = excluded.entity_type,
  after = excluded.after,
  created_at = excluded.created_at;

insert into audit_log (
  id, daycare_id, actor_id, action, entity_type, entity_id, before, after, created_at
) values (
  '47100000-0000-4000-a001-000000000001',
  '10000000-0000-4000-a000-000000000001',
  '00000000-0000-4000-a000-000000000007',
  'update', 'enrollments', null, null,
  '{"demo":true,"note":"covered enrollment"}',
  now() - interval '43 days'
)
on conflict (id) do update set created_at = excluded.created_at;
