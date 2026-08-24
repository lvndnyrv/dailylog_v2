-- Group 17 mobile demo data for Maria Kowalski at Sunny Grove.
-- Re-runnable: only deterministic demo rows below are refreshed.

do $$
declare
  v_member_id uuid;
  v_daycare_id uuid;
  v_profile_id uuid;
  v_room_id uuid;
  v_admin_id uuid;
  v_timezone text;
  v_today date;
  v_week_start date;
begin
  select sm.id, sm.daycare_id, sm.profile_id, p.classroom_id
    into v_member_id, v_daycare_id, v_profile_id, v_room_id
    from public.staff_members sm
    join public.profiles p on p.id = sm.profile_id
   where lower(p.email) = 'maria@sunnygrove.test'
     and sm.status = 'active'
     and sm.archived_at is null
   limit 1;

  if v_member_id is null then
    raise exception 'Maria Kowalski seed staff record was not found';
  end if;

  select coalesce(d.timezone, 'America/Toronto')
    into v_timezone
    from public.daycares d
   where d.id = v_daycare_id;

  select p.id
    into v_admin_id
    from public.profiles p
   where p.daycare_id = v_daycare_id
     and p.role in ('owner_admin', 'admin')
   order by case when p.role = 'owner_admin' then 0 else 1 end, p.created_at
   limit 1;

  v_today := timezone(v_timezone, now())::date;
  v_week_start := date_trunc('week', v_today::timestamp)::date;

  update public.staff_members
     set annual_paid_leave_days = 12
   where id = v_member_id;

  insert into public.staff_shifts (
    id, daycare_id, staff_member_id, classroom_id, starts_at, ends_at,
    unpaid_break_minutes, status, notes, created_by, published_at
  ) values
    ('54000000-0000-4000-a000-000000000001', v_daycare_id, v_member_id, v_room_id,
      (v_week_start + time '08:00') at time zone v_timezone,
      (v_week_start + time '17:30') at time zone v_timezone,
      60, 'published', 'Group 17 demo · regular shift', v_admin_id, now()),
    ('54000000-0000-4000-a000-000000000002', v_daycare_id, v_member_id, v_room_id,
      (v_week_start + 1 + time '08:00') at time zone v_timezone,
      (v_week_start + 1 + time '17:30') at time zone v_timezone,
      60, 'published', 'Group 17 demo · regular shift', v_admin_id, now()),
    ('54000000-0000-4000-a000-000000000003', v_daycare_id, v_member_id, v_room_id,
      (v_week_start + 2 + time '08:00') at time zone v_timezone,
      (v_week_start + 2 + time '17:30') at time zone v_timezone,
      60, 'published', 'Group 17 demo · regular shift', v_admin_id, now()),
    ('54000000-0000-4000-a000-000000000004', v_daycare_id, v_member_id, v_room_id,
      (v_week_start + 3 + time '08:00') at time zone v_timezone,
      (v_week_start + 3 + time '17:30') at time zone v_timezone,
      60, 'published', 'Group 17 demo · regular shift', v_admin_id, now()),
    ('54000000-0000-4000-a000-000000000005', v_daycare_id, v_member_id, v_room_id,
      (v_week_start + 4 + time '08:00') at time zone v_timezone,
      (v_week_start + 4 + time '17:30') at time zone v_timezone,
      60, 'published', 'Group 17 demo · regular shift', v_admin_id, now())
  on conflict (id) do update set
    daycare_id = excluded.daycare_id,
    staff_member_id = excluded.staff_member_id,
    classroom_id = excluded.classroom_id,
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    unpaid_break_minutes = excluded.unpaid_break_minutes,
    status = excluded.status,
    notes = excluded.notes,
    created_by = excluded.created_by,
    published_at = excluded.published_at;

  delete from public.staff_time_entries
   where id in (
    '54100000-0000-4000-a000-000000000001',
    '54100000-0000-4000-a000-000000000002',
    '54100000-0000-4000-a000-000000000003',
    '54100000-0000-4000-a000-000000000004',
    '54100000-0000-4000-a000-000000000005',
    '54100000-0000-4000-a000-000000000006'
  );

  insert into public.staff_time_entries (
    id, daycare_id, staff_member_id, shift_id, classroom_id,
    clocked_in_at, clocked_out_at, break_minutes, source, status,
    notes, created_by, approved_by, approved_at
  ) values
    ('54100000-0000-4000-a000-000000000001', v_daycare_id, v_member_id,
      '54000000-0000-4000-a000-000000000001', v_room_id,
      (v_week_start + time '08:00') at time zone v_timezone,
      (v_week_start + time '17:30') at time zone v_timezone,
      60, 'mobile', 'approved', 'Group 17 demo · on time', v_profile_id, v_admin_id, now()),
    ('54100000-0000-4000-a000-000000000002', v_daycare_id, v_member_id,
      '54000000-0000-4000-a000-000000000002', v_room_id,
      (v_week_start + 1 + time '08:02') at time zone v_timezone,
      (v_week_start + 1 + time '17:31') at time zone v_timezone,
      60, 'mobile', 'approved', 'Group 17 demo · approved', v_profile_id, v_admin_id, now()),
    ('54100000-0000-4000-a000-000000000003', v_daycare_id, v_member_id,
      '54000000-0000-4000-a000-000000000003', v_room_id,
      (v_week_start + 2 + time '07:58') at time zone v_timezone,
      (v_week_start + 2 + time '17:28') at time zone v_timezone,
      60, 'mobile', 'submitted', 'Group 17 demo · awaiting approval', v_profile_id, null, null),
    ('54100000-0000-4000-a000-000000000004', v_daycare_id, v_member_id,
      '54000000-0000-4000-a000-000000000004', v_room_id,
      (v_week_start + 3 + time '08:05') at time zone v_timezone,
      (v_week_start + 3 + time '17:30') at time zone v_timezone,
      60, 'mobile', 'submitted', 'Group 17 demo · awaiting approval', v_profile_id, null, null),
    ('54100000-0000-4000-a000-000000000005', v_daycare_id, v_member_id,
      '54000000-0000-4000-a000-000000000005', v_room_id,
      (v_week_start + 4 + time '08:03') at time zone v_timezone,
      (v_week_start + 4 + time '16:45') at time zone v_timezone,
      60, 'mobile', 'submitted', 'Group 17 demo · early finish', v_profile_id, null, null);

  -- Keep one live timer for the clocked-in variant without disturbing a real
  -- clock-in an educator may already have created while testing.
  if not exists (
    select 1 from public.staff_time_entries
     where staff_member_id = v_member_id and clocked_out_at is null
  ) then
    insert into public.staff_time_entries (
      id, daycare_id, staff_member_id, classroom_id, clocked_in_at,
      break_minutes, source, status, notes, created_by
    ) values (
      '54100000-0000-4000-a000-000000000006', v_daycare_id, v_member_id,
      v_room_id, now() - interval '6 hours 12 minutes',
      0, 'mobile', 'open', 'Group 17 demo · active shift', v_profile_id
    );
  end if;

  insert into public.staff_time_off_requests (
    id, daycare_id, staff_member_id, starts_on, ends_on, kind, status,
    reason, decision_notes, reviewed_by, reviewed_at
  ) values (
    '54200000-0000-4000-a000-000000000001', v_daycare_id, v_member_id,
    date_trunc('year', v_today::timestamp)::date + 14,
    date_trunc('year', v_today::timestamp)::date + 16,
    'vacation', 'approved', 'Winter break', 'Approved for Group 17 demo',
    v_admin_id, now()
  )
  on conflict (id) do update set
    daycare_id = excluded.daycare_id,
    staff_member_id = excluded.staff_member_id,
    starts_on = excluded.starts_on,
    ends_on = excluded.ends_on,
    kind = excluded.kind,
    status = excluded.status,
    reason = excluded.reason,
    decision_notes = excluded.decision_notes,
    reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at;

  insert into public.staff_time_off_requests (
    id, daycare_id, staff_member_id, starts_on, ends_on, kind, status,
    reason, decision_notes, reviewed_by, reviewed_at
  ) values (
    '54200000-0000-4000-a000-000000000002', v_daycare_id, v_member_id,
    v_today + 40, v_today + 41,
    'personal', 'pending', 'Family appointment', null, null, null
  )
  on conflict (id) do update set
    daycare_id = excluded.daycare_id,
    staff_member_id = excluded.staff_member_id,
    starts_on = excluded.starts_on,
    ends_on = excluded.ends_on,
    kind = excluded.kind,
    status = excluded.status,
    reason = excluded.reason,
    decision_notes = excluded.decision_notes,
    reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at;
end;
$$;
