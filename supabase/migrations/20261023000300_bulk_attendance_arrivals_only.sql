-- Bulk attendance is for classroom arrivals, not child release. Departure
-- requires an identified presenter through the verified pickup, kiosk, or
-- family QR flow; historical mistakes use audited attendance corrections.
create or replace function public.bulk_set_mobile_attendance(
  p_child_ids uuid[], p_action text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_daycare uuid := public.get_my_daycare_id();
  v_today date := public.center_today();
  v_child_ids uuid[];
  v_selected integer;
  v_accessible integer;
  v_affected integer := 0;
begin
  if auth.uid() is null or not public.is_staff()
     or not public.has_permission('attendance', 'edit') then
    raise exception 'Attendance edit permission is required';
  end if;
  if lower(btrim(coalesce(p_action, ''))) <> 'check-in' then
    raise exception 'Bulk check-out is unavailable. Verify each pickup person before releasing a child';
  end if;
  select array_agg(distinct requested.child_id) into v_child_ids
    from unnest(coalesce(p_child_ids, array[]::uuid[])) requested(child_id)
   where requested.child_id is not null;
  v_selected := coalesce(cardinality(v_child_ids), 0);
  if v_selected = 0 then raise exception 'Choose at least one child'; end if;
  if v_selected > 50 then raise exception 'Choose no more than 50 children at once'; end if;
  select count(*)::integer into v_accessible
    from public.children child
   where child.id = any(v_child_ids)
     and child.daycare_id = v_daycare
     and child.archived_at is null
     and coalesce(child.enrolled_on, '-infinity'::date) <= v_today
     and public.can_access_child_area(child.id, 'attendance', 'edit');
  if v_accessible <> v_selected then
    raise exception 'One or more children are unavailable or outside your assignment';
  end if;

  insert into public.attendance_records (
    daycare_id, child_id, date, checked_in_at, checked_in_by,
    method, status, absence_reason, notes
  )
  select v_daycare, child.id, v_today, now(), auth.uid(),
    'educator', 'present', null, null
    from public.children child
   where child.id = any(v_child_ids)
  on conflict (child_id, date) do update set
    checked_in_at = excluded.checked_in_at,
    checked_in_by = excluded.checked_in_by,
    method = 'educator',
    status = 'present',
    absence_reason = null,
    notes = null
  where public.attendance_records.checked_in_at is null
    and public.attendance_records.checked_out_at is null;
  get diagnostics v_affected = row_count;

  return jsonb_build_object(
    'selectedCount', v_selected,
    'affectedCount', v_affected,
    'skippedCount', greatest(v_selected - v_affected, 0)
  );
end;
$$;

notify pgrst, 'reload schema';
