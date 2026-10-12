-- Realistic Group 19 data for Sunny Grove's Preschool room.
-- Idempotent and safe to rerun in the local/demo Supabase project.

do $$
declare
  v_daycare uuid := '10000000-0000-4000-a000-000000000001';
  v_room uuid := '20000000-0000-4000-a000-000000000003';
  v_maria uuid := '00000000-0000-4000-a000-000000000003';
  v_owner uuid := '00000000-0000-4000-a000-000000000001';
  v_today date;
  v_zone text;
begin
  select coalesce(timezone, 'America/Toronto') into v_zone
    from public.daycares where id = v_daycare;
  v_today := (now() at time zone v_zone)::date;

  delete from public.pickup_plans
   where id in (
     '41910000-0000-4000-a000-000000000001',
     '41910000-0000-4000-a000-000000000002',
     '41910000-0000-4000-a000-000000000003',
     '41910000-0000-4000-a000-000000000004'
   );

  -- Let Maria switch from Infant to Preschool to exercise the educator flow.
  insert into public.educator_classrooms (educator_id, classroom_id)
  values (v_maria, v_room)
  on conflict do nothing;

  update public.profiles set phone = case email
    when 'marc.danyar@parent.test' then '416-555-0171'
    when 'rosa.diaz@parent.test' then '416-555-0134'
    when 'lucia.castillo@parent.test' then '416-555-0162'
    when 'miguel.reyes@parent.test' then '416-555-0198'
    else phone end
  where email in (
    'marc.danyar@parent.test', 'rosa.diaz@parent.test',
    'lucia.castillo@parent.test', 'miguel.reyes@parent.test'
  );

  update public.parent_children
     set relationship = 'Father'
   where parent_id = '00000000-0000-4000-a000-000000000012'
     and child_id = '30000000-0000-4000-a000-000000000002';

  -- Re-running the demo after parent-flow testing must not leave duplicate
  -- pending/removed cards for the named examples. Keep any referenced handoff
  -- history intact; the mobile list also collapses repeated lifecycle rows.
  delete from public.child_pickups pickup
   where pickup.child_id = '30000000-0000-4000-a000-000000000013'
     and lower(btrim(pickup.full_name)) in ('elena ruiz', 'rafael torres')
     and pickup.id not in (
       '41900000-0000-4000-a000-000000000021',
       '41900000-0000-4000-a000-000000000022'
     )
     and not exists (
       select 1 from public.pickup_plans plan where plan.pickup_id = pickup.id
     )
     and not exists (
       select 1 from public.pickup_passes pass where pass.pickup_id = pickup.id
     );

  insert into public.child_pickups (
    id, daycare_id, child_id, full_name, relationship, phone, pin, created_by,
    approval_status, requested_by, requested_at, reviewed_by, reviewed_at,
    review_note, archived_at
  ) values
    ('41900000-0000-4000-a000-000000000019', v_daycare,
     '30000000-0000-4000-a000-000000000013', 'Carmen Castillo',
     'Grandmother', '416-555-0192', '6173', v_owner,
     'approved', null, null, v_owner, now() - interval '6 months', null, null),
    ('41900000-0000-4000-a000-000000000020', v_daycare,
     '30000000-0000-4000-a000-000000000018', 'Ana Diaz',
     'Aunt', '416-555-0120', '9084', v_owner,
     'approved', null, null, v_owner, now() - interval '4 months', null, null),
    ('41900000-0000-4000-a000-000000000021', v_daycare,
     '30000000-0000-4000-a000-000000000013', 'Elena Ruiz',
     'Aunt · emergency contact', '416-555-0147', '3618',
     '00000000-0000-4000-a000-000000000023',
     'pending', '00000000-0000-4000-a000-000000000023', now() - interval '2 hours',
     null, null, null, null),
    ('41900000-0000-4000-a000-000000000022', v_daycare,
     '30000000-0000-4000-a000-000000000013', 'Rafael Torres',
     'Former neighbour', null, '4825',
     '00000000-0000-4000-a000-000000000023',
     'approved', '00000000-0000-4000-a000-000000000023', now() - interval '1 year',
     v_owner, now() - interval '1 year', null, now() - interval '4 months')
  on conflict (id) do update set
    full_name = excluded.full_name,
    relationship = excluded.relationship,
    phone = excluded.phone,
    approval_status = excluded.approval_status,
    requested_by = excluded.requested_by,
    requested_at = excluded.requested_at,
    reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at,
    review_note = excluded.review_note,
    archived_at = excluded.archived_at;

  -- Three upcoming hand-offs and one completed example.
  insert into public.attendance_records (
    daycare_id, child_id, date, checked_in_at, checked_in_by,
    checked_out_at, checked_out_by, method, status, dropped_off_by, picked_up_by
  ) values
    (v_daycare, '30000000-0000-4000-a000-000000000002', v_today,
     (v_today + time '07:42') at time zone v_zone, v_maria,
     null, null, 'educator', 'present', 'Marc Danyar', null),
    (v_daycare, '30000000-0000-4000-a000-000000000018', v_today,
     (v_today + time '08:05') at time zone v_zone, v_maria,
     null, null, 'educator', 'present', 'Rosa Diaz', null),
    (v_daycare, '30000000-0000-4000-a000-000000000013', v_today,
     (v_today + time '09:24') at time zone v_zone, v_maria,
     null, null, 'educator', 'present', 'Lucia Castillo', null),
    (v_daycare, '30000000-0000-4000-a000-000000000014', v_today,
     (v_today + time '08:12') at time zone v_zone, v_maria,
     (v_today + time '13:15') at time zone v_zone, v_maria,
     'educator', 'present', 'Miguel Reyes', 'Miguel Reyes')
  on conflict (child_id, date) do update set
    checked_in_at = excluded.checked_in_at,
    checked_in_by = excluded.checked_in_by,
    checked_out_at = excluded.checked_out_at,
    checked_out_by = excluded.checked_out_by,
    method = excluded.method,
    status = excluded.status,
    dropped_off_by = excluded.dropped_off_by,
    picked_up_by = excluded.picked_up_by;

  update public.pickup_plans
     set status = 'cancelled'
   where child_id = '30000000-0000-4000-a000-000000000014'
     and scheduled_on = v_today
     and status = 'expected';

  insert into public.pickup_plans (
    id, daycare_id, child_id, presenter_profile_id, pickup_id,
    presenter_name, relationship, scheduled_on, scheduled_for,
    status, completed_at, completed_by, created_by
  ) values
    ('41910000-0000-4000-a000-000000000001', v_daycare,
     '30000000-0000-4000-a000-000000000002',
     '00000000-0000-4000-a000-000000000012', null,
     'Marc Danyar', 'Father', v_today,
     (v_today + time '15:30') at time zone v_zone,
     'expected', null, null, v_owner),
    ('41910000-0000-4000-a000-000000000002', v_daycare,
     '30000000-0000-4000-a000-000000000018',
     '00000000-0000-4000-a000-000000000028', null,
     'Rosa Diaz', 'Mother', v_today,
     (v_today + time '16:00') at time zone v_zone,
     'expected', null, null, v_owner),
    ('41910000-0000-4000-a000-000000000003', v_daycare,
     '30000000-0000-4000-a000-000000000013', null,
     '41900000-0000-4000-a000-000000000019',
     'Carmen Castillo', 'Grandmother', v_today,
     (v_today + time '16:20') at time zone v_zone,
     'expected', null, null, v_owner)
  on conflict (child_id, scheduled_on) where status = 'expected'
  do update set
    presenter_profile_id = excluded.presenter_profile_id,
    pickup_id = excluded.pickup_id,
    presenter_name = excluded.presenter_name,
    relationship = excluded.relationship,
    scheduled_for = excluded.scheduled_for,
    created_by = excluded.created_by;

  insert into public.pickup_plans (
    id, daycare_id, child_id, presenter_profile_id, presenter_name,
    relationship, scheduled_on, scheduled_for, status,
    completed_at, completed_by, created_by
  ) values (
    '41910000-0000-4000-a000-000000000004', v_daycare,
    '30000000-0000-4000-a000-000000000014',
    '00000000-0000-4000-a000-000000000024', 'Miguel Reyes',
    'Father', v_today, (v_today + time '13:15') at time zone v_zone,
    'completed', (v_today + time '13:15') at time zone v_zone,
    v_maria, v_owner
  ) on conflict (id) do update set
    scheduled_on = excluded.scheduled_on,
    scheduled_for = excluded.scheduled_for,
    status = 'completed',
    completed_at = excluded.completed_at,
    completed_by = excluded.completed_by;
end $$;
