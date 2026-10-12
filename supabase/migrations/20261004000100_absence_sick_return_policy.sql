-- Make the center's illness return rule available at the absence handoff without
-- exposing center policy data to unrelated families or staff.

create or replace function public.get_child_absence_policy(p_child_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_child public.children%rowtype;
  v_daycare public.daycares%rowtype;
begin
  if auth.uid() is null
     or not public.can_access_child_area(p_child_id, 'attendance', 'view') then
    raise exception 'Attendance access required';
  end if;

  select * into v_child
    from public.children child
   where child.id = p_child_id
     and child.archived_at is null;
  if v_child.id is null then
    raise exception 'This child is unavailable';
  end if;

  select * into v_daycare
    from public.daycares daycare
   where daycare.id = v_child.daycare_id;
  if v_daycare.id is null then
    raise exception 'Center policy is unavailable';
  end if;

  return jsonb_build_object(
    'daycareId', v_daycare.id,
    'daycareName', v_daycare.name,
    'sickReturnHours', v_daycare.sick_return_hours
  );
end;
$$;

revoke all on function public.get_child_absence_policy(uuid) from public, anon;
grant execute on function public.get_child_absence_policy(uuid) to authenticated;

comment on function public.get_child_absence_policy(uuid) is
  'Returns the configured sick-return interval to linked families and effective attendance viewers.';
