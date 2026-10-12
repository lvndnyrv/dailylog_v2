-- Resettable Parent Mobile Group 19 absence history for Lucia and Mateo.
-- Login: lucia.castillo@parent.test / password123

do $$
declare
  v_daycare constant uuid := '10000000-0000-4000-a000-000000000001';
  v_parent constant uuid := '00000000-0000-4000-a000-000000000023';
  v_child constant uuid := '30000000-0000-4000-a000-000000000013';
  v_today date;
begin
  if not exists (
    select 1 from public.parent_children
     where parent_id = v_parent and child_id = v_child
  ) then
    raise notice 'Skipping Group 19 absence demo: Lucia and Mateo are not seeded';
    return;
  end if;
  select (now() at time zone coalesce(daycare.timezone, 'America/Toronto'))::date
    into v_today from public.daycares daycare where daycare.id = v_daycare;

  insert into public.parent_absence_reports (
    id, daycare_id, child_id, reported_by, starts_on, ends_on,
    reason, note, status, created_at, updated_at
  ) values
    (
      '41900000-0000-4000-a000-000000000001', v_daycare, v_child, v_parent,
      v_today + 5, v_today + 6, 'appointment',
      'Mateo has a specialist appointment and will rest at home the following day.',
      'active', now() - interval '3 hours', now() - interval '3 hours'
    ),
    (
      '41900000-0000-4000-a000-000000000002', v_daycare, v_child, v_parent,
      v_today - 8, v_today - 8, 'sick',
      'Fever overnight — keeping him home to rest.',
      'active', now() - interval '9 days', now() - interval '9 days'
    )
  on conflict (id) do update set
    starts_on = excluded.starts_on,
    ends_on = excluded.ends_on,
    reason = excluded.reason,
    note = excluded.note,
    status = excluded.status,
    cancelled_at = null,
    cancelled_by = null,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at;

  delete from public.attendance_records
   where absence_report_id in (
     '41900000-0000-4000-a000-000000000001',
     '41900000-0000-4000-a000-000000000002'
   );

  insert into public.attendance_records (
    daycare_id, child_id, date, method, status, absence_reason, notes,
    absence_report_id, absence_reported_by, absence_reported_at
  )
  select v_daycare, v_child, day::date, 'parent', 'absent', 'appointment',
         'Mateo has a specialist appointment and will rest at home the following day.',
         '41900000-0000-4000-a000-000000000001'::uuid, v_parent, now() - interval '3 hours'
    from generate_series(v_today + 5, v_today + 6, interval '1 day') day
  union all
  select v_daycare, v_child, v_today - 8, 'parent', 'absent', 'sick',
         'Fever overnight — keeping him home to rest.',
         '41900000-0000-4000-a000-000000000002'::uuid, v_parent, now() - interval '9 days'
  on conflict (child_id, date) do update set
    checked_in_at = null,
    checked_in_by = null,
    checked_out_at = null,
    checked_out_by = null,
    method = excluded.method,
    status = excluded.status,
    absence_reason = excluded.absence_reason,
    notes = excluded.notes,
    absence_report_id = excluded.absence_report_id,
    absence_reported_by = excluded.absence_reported_by,
    absence_reported_at = excluded.absence_reported_at,
    updated_at = now();
end;
$$;
