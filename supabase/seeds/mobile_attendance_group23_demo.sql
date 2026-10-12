-- Realistic Group 23 roll-call and late-pickup data for Sunny Grove Preschool.
-- Idempotent and intentionally date-relative so the mobile demo stays useful.

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

  insert into public.educator_classrooms (educator_id, classroom_id)
  values (v_maria, v_room)
  on conflict do nothing;

  insert into public.late_pickup_policies (
    id, daycare_id, effective_from, closing_time, grace_minutes,
    fee_per_minute_cents, daily_cap_cents, conversation_after_count, created_by
  ) values (
    '42300000-0000-4000-a000-000000000001', v_daycare,
    v_today - 365, time '18:00', 5, 100, 4000, 3, v_owner
  ) on conflict (id) do update set
    daycare_id = excluded.daycare_id,
    effective_from = excluded.effective_from,
    closing_time = excluded.closing_time,
    grace_minutes = excluded.grace_minutes,
    fee_per_minute_cents = excluded.fee_per_minute_cents,
    daily_cap_cents = excluded.daily_cap_cents,
    conversation_after_count = excluded.conversation_after_count;

  delete from public.mobile_roll_call_sessions
   where classroom_id = v_room and attendance_date = v_today;
  delete from public.late_pickup_events
   where child_id in (
     '30000000-0000-4000-a000-000000000013',
     '30000000-0000-4000-a000-000000000014',
     '30000000-0000-4000-a000-000000000015',
     '30000000-0000-4000-a000-000000000016',
     '30000000-0000-4000-a000-000000000017',
     '30000000-0000-4000-a000-000000000018'
   ) and occurred_on = v_today;

  -- Mateo came through the kiosk, Sofia was checked in by Maria, Rosa's
  -- family reported sickness, Lena is coming late, Ruth is still awaited,
  -- and Elvin arrived with an educator check-in.
  insert into public.attendance_records (
    daycare_id, child_id, date, checked_in_at, checked_in_by,
    checked_out_at, checked_out_by, method, status, absence_reason, notes,
    dropped_off_by, picked_up_by
  ) values
    (v_daycare, '30000000-0000-4000-a000-000000000013', v_today,
     now() - interval '2 hours 12 minutes', null, null, null,
     'kiosk', 'present', null, null, 'Carmen Castillo', null),
    (v_daycare, '30000000-0000-4000-a000-000000000014', v_today,
     now() - interval '1 hour 54 minutes', v_maria, null, null,
     'educator', 'present', null, null, 'Miguel Reyes', null),
    (v_daycare, '30000000-0000-4000-a000-000000000015', v_today,
     null, null, null, null, 'parent', 'absent', 'sick',
     'Fever overnight — resting at home.', null, null),
    (v_daycare, '30000000-0000-4000-a000-000000000016', v_today,
     null, null, null, null, 'parent', 'late', null,
     'Parent replied: running late, there in 15 minutes.', null, null),
    (v_daycare, '30000000-0000-4000-a000-000000000018', v_today,
     now() - interval '1 hour 25 minutes', v_maria, null, null,
     'educator', 'present', null, null, 'Rosa Diaz', null)
  on conflict (child_id, date) do update set
    checked_in_at = excluded.checked_in_at,
    checked_in_by = excluded.checked_in_by,
    checked_out_at = excluded.checked_out_at,
    checked_out_by = excluded.checked_out_by,
    method = excluded.method,
    status = excluded.status,
    absence_reason = excluded.absence_reason,
    notes = excluded.notes,
    dropped_off_by = excluded.dropped_off_by,
    picked_up_by = excluded.picked_up_by;

  -- The enrollment and room demo seeds add three more Preschool children.
  -- Keep every non-scenario child present so this seed remains useful after
  -- those fixtures are refreshed or an extra enrolled child is added.
  insert into public.attendance_records (
    daycare_id, child_id, date, checked_in_at, checked_in_by,
    method, status, notes, dropped_off_by
  )
  select v_daycare, child.id, v_today,
         now() - interval '1 hour 10 minutes', v_maria,
         'educator', 'present', 'Morning room roll call', 'Authorized guardian'
    from public.children child
   where child.classroom_id = v_room
     and child.archived_at is null
     and child.id not in (
       '30000000-0000-4000-a000-000000000013',
       '30000000-0000-4000-a000-000000000014',
       '30000000-0000-4000-a000-000000000015',
       '30000000-0000-4000-a000-000000000016',
       '30000000-0000-4000-a000-000000000017',
       '30000000-0000-4000-a000-000000000018'
     )
  on conflict (child_id, date) do update set
    checked_in_at = excluded.checked_in_at,
    checked_in_by = excluded.checked_in_by,
    checked_out_at = null,
    checked_out_by = null,
    method = excluded.method,
    status = excluded.status,
    absence_reason = null,
    notes = excluded.notes,
    dropped_off_by = excluded.dropped_off_by,
    picked_up_by = null;

  delete from public.attendance_records
   where child_id = '30000000-0000-4000-a000-000000000017'
     and date = v_today;

  update public.pickup_plans
     set status = 'cancelled'
   where child_id = '30000000-0000-4000-a000-000000000014'
     and scheduled_on = v_today and status = 'expected';

  insert into public.pickup_plans (
    id, daycare_id, child_id, presenter_profile_id, presenter_name,
    relationship, scheduled_on, scheduled_for, status, created_by
  ) values (
    '42310000-0000-4000-a000-000000000001', v_daycare,
    '30000000-0000-4000-a000-000000000014',
    '00000000-0000-4000-a000-000000000024', 'Miguel Reyes',
    'Father', v_today, now() - interval '22 minutes', 'expected', v_owner
  ) on conflict (id) do update set
    daycare_id = excluded.daycare_id,
    child_id = excluded.child_id,
    presenter_profile_id = excluded.presenter_profile_id,
    pickup_id = null,
    presenter_name = excluded.presenter_name,
    relationship = excluded.relationship,
    scheduled_on = excluded.scheduled_on,
    scheduled_for = excluded.scheduled_for,
    status = excluded.status,
    created_by = excluded.created_by;
end $$;
