-- Idempotent Group 12 demo state for the linked Sunny Grove development center.
-- This creates no official center documents; upload those through the vault so
-- the stored original and audit trail remain genuine.

update public.staff_members
   set background_check_required = true
 where profile_id = '00000000-0000-4000-a000-000000000004';

insert into public.staff_credentials (
  daycare_id, staff_member_id, name, issuer, completed_on, expires_on,
  required, ratio_qualifying
)
select member.daycare_id, member.id, 'Background check', 'Provincial registry',
       date '2023-03-01', null, true, false
  from public.staff_members member
 where member.profile_id = '00000000-0000-4000-a000-000000000004'
on conflict (staff_member_id, (lower(btrim(name)))) do update
  set required = true,
      issuer = excluded.issuer,
      completed_on = excluded.completed_on,
      archived_at = null;

insert into public.compliance_drills (
  id, daycare_id,kind,conducted_at,lead_staff_id,duration_seconds,
  children_count,staff_count,attendance_children,attendance_staff,notes,
  next_due_on,created_by
)
select
  fixture.id,
  '10000000-0000-4000-a000-000000000001'::uuid,
  fixture.kind,
  fixture.conducted_at,
  member.id,
  fixture.duration_seconds,
  fixture.children_count,
  fixture.staff_count,
  fixture.children_count,
  fixture.staff_count,
  fixture.notes,
  fixture.next_due_on,
  '00000000-0000-4000-a000-000000000001'::uuid
from public.staff_members member
cross join (values
  ('d1200000-0000-4000-a000-000000000001'::uuid,'fire',
    now()-interval '18 days',128,26,6,'All rooms cleared; west exit opened cleanly.',current_date+13),
  ('d1200000-0000-4000-a000-000000000002'::uuid,'lockdown',
    now()-interval '2 months',245,24,6,'Classroom blinds and attendance cards verified.',current_date+31),
  ('d1200000-0000-4000-a000-000000000003'::uuid,'severe_weather',
    now()-interval '4 months',310,23,5,'Basement muster and emergency radio check complete.',current_date+52)
) as fixture(id,kind,conducted_at,duration_seconds,children_count,staff_count,notes,next_due_on)
where member.profile_id = '00000000-0000-4000-a000-000000000003'
on conflict (id) do update
  set conducted_at = excluded.conducted_at,
      next_due_on = excluded.next_due_on,
      notes = excluded.notes;

select 'PASS: Group 12 demo clearance and drill history are ready' as result;
