-- ==========================================================================
-- Mobile Group 18 — deterministic over-ratio demo for the educator app
-- ==========================================================================

do $mobile_group18$
declare
  v_daycare_id uuid := '10000000-0000-4000-a000-000000000001';
  v_today date := (now() at time zone 'America/Toronto')::date;
begin
  update public.daycares
     set time_tracking_enabled = false,
         ratio_alert_after_minutes = 10,
         ratio_notify_floaters = true
   where id = v_daycare_id;

  delete from public.notifications
   where daycare_id = v_daycare_id
     and kind = 'ratio_alert'
     and title = 'Coverage assignment'
     and payload ->> 'screen' = 'RoomRatios';

  -- Reset only prior Group 18 demo/action coverage. Pete is then placed in
  -- Toddler temporarily, leaving Preschool with one educator and nine children.
  delete from public.room_coverage_assignments
   where daycare_id = v_daycare_id
     and (
       notes like '[mobile-group18]%'
       or notes = 'Mobile ratio restoration'
       or notes like '[rooms-demo]%'
     );

  insert into public.room_coverage_assignments (
    id, daycare_id, classroom_id, staff_member_id, starts_at, ends_at,
    status, notes
  ) values (
    '55000000-0000-4000-a000-000000000001',
    v_daycare_id,
    '20000000-0000-4000-a000-000000000002',
    (select id from public.staff_members
      where profile_id = '00000000-0000-4000-a000-000000000005'),
    now() - interval '5 minutes',
    now() + interval '2 hours',
    'accepted',
    '[mobile-group18] Pete covering Toddler'
  )
  on conflict (id) do update set
    classroom_id = excluded.classroom_id,
    staff_member_id = excluded.staff_member_id,
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    status = excluded.status,
    notes = excluded.notes;

  -- Preschool is the interrupt state. Other rooms stay safely in ratio so the
  -- dashboard demonstrates both visual states and safe floater candidates.
  with ranked_children as (
    select
      child.id,
      child.classroom_id,
      row_number() over (
        partition by child.classroom_id
        order by child.first_name, child.last_name, child.id
      ) as room_rank,
      case child.classroom_id
        when '20000000-0000-4000-a000-000000000001'::uuid then 3
        when '20000000-0000-4000-a000-000000000002'::uuid then 5
        when '20000000-0000-4000-a000-000000000003'::uuid then 9
        when '20000000-0000-4000-a000-000000000004'::uuid then 4
      end as present_target,
      case child.classroom_id
        when '20000000-0000-4000-a000-000000000001'::uuid then '00000000-0000-4000-a000-000000000003'::uuid
        when '20000000-0000-4000-a000-000000000002'::uuid then '00000000-0000-4000-a000-000000000004'::uuid
        when '20000000-0000-4000-a000-000000000003'::uuid then '00000000-0000-4000-a000-000000000008'::uuid
        when '20000000-0000-4000-a000-000000000004'::uuid then '00000000-0000-4000-a000-000000000006'::uuid
      end as educator_id
    from public.children child
    where child.daycare_id = v_daycare_id
      and child.archived_at is null
  ), demo_attendance as (
    select
      id,
      educator_id,
      room_rank <= present_target as is_present,
      now() - interval '2 hours' + (room_rank * interval '4 minutes') as checked_in_at
    from ranked_children
  )
  insert into public.attendance_records (
    daycare_id, child_id, date, checked_in_at, checked_in_by,
    checked_out_at, checked_out_by, method, status, absence_reason, notes
  )
  select
    v_daycare_id,
    id,
    v_today,
    case when is_present then checked_in_at end,
    case when is_present then educator_id end,
    null,
    null,
    'educator',
    case when is_present then 'present' else 'absent' end,
    case when is_present then null else 'vacation' end,
    '[mobile-group18] Live room-ratio scenario'
  from demo_attendance
  on conflict (child_id, date) do update set
    checked_in_at = excluded.checked_in_at,
    checked_in_by = excluded.checked_in_by,
    checked_out_at = null,
    checked_out_by = null,
    method = excluded.method,
    status = excluded.status,
    absence_reason = excluded.absence_reason,
    notes = excluded.notes;

  perform public._refresh_room_ratio_event(room.id, false)
    from public.classrooms room
   where room.daycare_id = v_daycare_id
     and room.archived_at is null;

  update public.room_ratio_events
     set started_at = now() - interval '15 minutes'
   where classroom_id = '20000000-0000-4000-a000-000000000003'
     and resolved_at is null;
end
$mobile_group18$;
