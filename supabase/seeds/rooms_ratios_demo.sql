-- ============================================================================
-- Rooms & ratios demo state (7a–7f)
-- Runs after seed.sql and can also be applied independently to the shared dev
-- project. Every mutable record is marked/upserted so reruns stay deterministic.
-- ============================================================================

do $rooms_demo$
declare
  v_today date := (now() at time zone 'America/Toronto')::date;
  v_row record;
  v_member uuid;
  v_shift uuid;
begin

-- Make the room-settings and policy cards useful on first load.
update daycares
   set ratio_alert_after_minutes = 10,
       ratio_notify_floaters = true,
       ratio_block_checkins = false
 where id = '10000000-0000-4000-a000-000000000001';

update classrooms
   set lead_educator_id = case id
         when '20000000-0000-4000-a000-000000000001' then '00000000-0000-4000-a000-000000000003'::uuid
         when '20000000-0000-4000-a000-000000000002' then '00000000-0000-4000-a000-000000000004'::uuid
         when '20000000-0000-4000-a000-000000000003' then '00000000-0000-4000-a000-000000000005'::uuid
         when '20000000-0000-4000-a000-000000000004' then '00000000-0000-4000-a000-000000000006'::uuid
       end,
       nap_start = case
         when id = '20000000-0000-4000-a000-000000000004' then null
         else time '12:30'
       end,
       nap_end = case id
         when '20000000-0000-4000-a000-000000000001' then time '14:30'
         when '20000000-0000-4000-a000-000000000002' then time '14:00'
         when '20000000-0000-4000-a000-000000000003' then time '14:00'
         else null
       end
 where daycare_id = '10000000-0000-4000-a000-000000000001';

-- Today always has a varied published schedule, even when the seed is run on a
-- weekend. Existing same-day shifts are updated instead of duplicated.
  for v_row in
    select * from (values
      ('00000000-0000-4000-a000-000000000003'::uuid, '20000000-0000-4000-a000-000000000001'::uuid, time '07:00', time '15:00', 'Maria · Infant lead'),
      ('00000000-0000-4000-a000-000000000004'::uuid, '20000000-0000-4000-a000-000000000002'::uuid, time '07:30', time '15:30', 'Sam · Toddler lead'),
      ('00000000-0000-4000-a000-000000000005'::uuid, '20000000-0000-4000-a000-000000000003'::uuid, time '08:00', time '16:00', 'Pete · Preschool lead'),
      ('00000000-0000-4000-a000-000000000008'::uuid, '20000000-0000-4000-a000-000000000003'::uuid, time '09:00', time '17:30', 'Grace · approved sick day'),
      ('00000000-0000-4000-a000-000000000006'::uuid, '20000000-0000-4000-a000-000000000004'::uuid, time '07:00', time '15:00', 'Priya · Kindergarten lead'),
      ('00000000-0000-4000-a000-000000000007'::uuid, null::uuid,                                             time '08:00', time '16:00', 'Tara · floating today')
    ) as schedule(profile_id, classroom_id, starts_at, ends_at, label)
  loop
    select id into v_member from staff_members where profile_id = v_row.profile_id;
    select id into v_shift
      from staff_shifts
     where staff_member_id = v_member
       and (starts_at at time zone 'America/Toronto')::date = v_today
       and status = 'published'
     order by starts_at
     limit 1;

    if v_shift is null then
      insert into staff_shifts (
        daycare_id, staff_member_id, classroom_id, starts_at, ends_at,
        unpaid_break_minutes, status, notes, published_at
      ) values (
        '10000000-0000-4000-a000-000000000001', v_member, v_row.classroom_id,
        (v_today + v_row.starts_at) at time zone 'America/Toronto',
        (v_today + v_row.ends_at) at time zone 'America/Toronto',
        30, 'published', '[rooms-demo] ' || v_row.label, now()
      );
    else
      update staff_shifts
         set classroom_id = v_row.classroom_id,
             starts_at = (v_today + v_row.starts_at) at time zone 'America/Toronto',
             ends_at = (v_today + v_row.ends_at) at time zone 'America/Toronto',
             unpaid_break_minutes = 30,
             status = 'published',
             notes = '[rooms-demo] ' || v_row.label,
             published_at = coalesce(published_at, now())
       where id = v_shift;
    end if;
  end loop;

-- Grace's bar is visibly marked away; Tara remains in the floater pool and is
-- temporarily assigned to Preschool for the lunch gap.
delete from staff_time_off_requests
 where daycare_id = '10000000-0000-4000-a000-000000000001'
   and reason = '[rooms-demo] Sick today';

insert into staff_time_off_requests (
  daycare_id, staff_member_id, starts_on, ends_on, kind, status, reason,
  reviewed_by, reviewed_at
) values (
  '10000000-0000-4000-a000-000000000001',
  (select id from staff_members where profile_id = '00000000-0000-4000-a000-000000000008'),
  (now() at time zone 'America/Toronto')::date,
  (now() at time zone 'America/Toronto')::date,
  'sick', 'approved', '[rooms-demo] Sick today',
  '00000000-0000-4000-a000-000000000001', now()
);

delete from room_coverage_assignments
 where daycare_id = '10000000-0000-4000-a000-000000000001'
   and (
     notes like '[rooms-demo]%'
     or (
       classroom_id = '20000000-0000-4000-a000-000000000003'
       and staff_member_id = (
         select id from staff_members
          where profile_id = '00000000-0000-4000-a000-000000000007'
       )
       and starts_at = ((v_today + time '12:00') at time zone 'America/Toronto')
       and ends_at = ((v_today + time '14:00') at time zone 'America/Toronto')
     )
   );

insert into room_coverage_assignments (
  daycare_id, classroom_id, staff_member_id, starts_at, ends_at, status, notes
) values (
  '10000000-0000-4000-a000-000000000001',
  '20000000-0000-4000-a000-000000000003',
  (select id from staff_members where profile_id = '00000000-0000-4000-a000-000000000007'),
  (((now() at time zone 'America/Toronto')::date + time '12:00') at time zone 'America/Toronto'),
  (((now() at time zone 'America/Toronto')::date + time '14:00') at time zone 'America/Toronto'),
  'accepted', '[rooms-demo] Lunch coverage while Grace is away'
);

-- Current attendance gives each room a meaningful live count. Infant is
-- intentionally over its 1:3 ratio with one home-room educator.
with ranked_children as (
  select c.id, c.classroom_id,
         row_number() over (partition by c.classroom_id order by c.first_name, c.last_name) as rn,
         case c.classroom_id
           when '20000000-0000-4000-a000-000000000001' then 6
           when '20000000-0000-4000-a000-000000000002' then 4
           when '20000000-0000-4000-a000-000000000003' then 6
           when '20000000-0000-4000-a000-000000000004' then 4
         end as present_target,
         case c.classroom_id
           when '20000000-0000-4000-a000-000000000001' then '00000000-0000-4000-a000-000000000003'::uuid
           when '20000000-0000-4000-a000-000000000002' then '00000000-0000-4000-a000-000000000004'::uuid
           when '20000000-0000-4000-a000-000000000003' then '00000000-0000-4000-a000-000000000005'::uuid
           when '20000000-0000-4000-a000-000000000004' then '00000000-0000-4000-a000-000000000006'::uuid
         end as educator_id
    from children c
   where c.daycare_id = '10000000-0000-4000-a000-000000000001'
     and c.archived_at is null
), demo_attendance as (
  select id, classroom_id, educator_id, rn <= present_target as is_present,
         (((now() at time zone 'America/Toronto')::date + time '07:35') at time zone 'America/Toronto')
           + ((rn * 7) || ' minutes')::interval as arrived_at
    from ranked_children
)
insert into attendance_records (
  daycare_id, child_id, date, checked_in_at, checked_in_by,
  checked_out_at, checked_out_by, method, status, absence_reason, notes
)
select '10000000-0000-4000-a000-000000000001', id,
       (now() at time zone 'America/Toronto')::date,
       case when is_present then arrived_at end,
       case when is_present then educator_id end,
       null, null, 'educator',
       case when is_present then 'present' else 'absent' end,
       case when is_present then null else 'vacation' end,
       '[rooms-demo] Live Rooms & ratios state'
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

-- Three children exercise each transition state: Ada is planned, Noah needs a
-- plan, and Elvin is waiting because the next room is currently at capacity.
update children
   set date_of_birth = ((now() at time zone 'America/Toronto')::date - interval '17 months')::date
 where id = '30000000-0000-4000-a000-000000000004';
update children
   set date_of_birth = ((now() at time zone 'America/Toronto')::date - interval '35 months')::date
 where first_name = 'Noah' and last_name = 'Berg'
   and daycare_id = '10000000-0000-4000-a000-000000000001';
update children
   set date_of_birth = ((now() at time zone 'America/Toronto')::date - interval '59 months')::date
 where first_name = 'Elvin' and last_name = 'Diaz'
   and daycare_id = '10000000-0000-4000-a000-000000000001';

update classrooms
   set capacity = (
     select count(*) from children
      where classroom_id = '20000000-0000-4000-a000-000000000004'
        and archived_at is null
   )
 where id = '20000000-0000-4000-a000-000000000004';

insert into room_transition_plans (
  daycare_id, child_id, from_classroom_id, to_classroom_id,
  move_on, transition_week, status, notes
) values (
  '10000000-0000-4000-a000-000000000001',
  '30000000-0000-4000-a000-000000000004',
  '20000000-0000-4000-a000-000000000001',
  '20000000-0000-4000-a000-000000000002',
  (now() at time zone 'America/Toronto')::date + 14,
  true, 'planned', '[rooms-demo] Family notified; two morning visits next week'
)
on conflict (child_id) where status = 'planned' do update set
  from_classroom_id = excluded.from_classroom_id,
  to_classroom_id = excluded.to_classroom_id,
  move_on = excluded.move_on,
  transition_week = excluded.transition_week,
  notes = excluded.notes;

-- Open and close combinations surface both timeline markers and editable 7f
-- state without moving any child's home room.
insert into room_combinations (
  daycare_id, period, source_classroom_id, host_classroom_id,
  starts_at, ends_at, enabled
) values
  ('10000000-0000-4000-a000-000000000001', 'morning',
   '20000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000002',
   time '07:00', time '08:00', true),
  ('10000000-0000-4000-a000-000000000001', 'evening',
   '20000000-0000-4000-a000-000000000004', '20000000-0000-4000-a000-000000000003',
   time '17:00', time '18:00', true)
on conflict (daycare_id, period) do update set
  source_classroom_id = excluded.source_classroom_id,
  host_classroom_id = excluded.host_classroom_id,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  enabled = excluded.enabled;

end
$rooms_demo$;
