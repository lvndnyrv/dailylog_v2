-- The dashboard already reads the administrator's visible child roster.
-- Its expected-day filter must not fail solely because attendance/view was
-- removed; attendance records themselves remain protected by their own RLS.
create or replace function public.get_attendance_expected_children(p_date date)
returns table(child_id uuid, chase_after time)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_admin()
     or not public.has_permission('children', 'view') then
    raise exception 'Child roster viewing permission required';
  end if;
  if p_date is null then raise exception 'Attendance date required'; end if;
  return query
    select expected.child_id, expected.chase_after
      from public._attendance_expected_children(public.get_my_daycare_id(), p_date) expected;
end;
$$;

revoke all on function public.get_attendance_expected_children(date)
  from public, anon;
grant execute on function public.get_attendance_expected_children(date)
  to authenticated;

notify pgrst, 'reload schema';
