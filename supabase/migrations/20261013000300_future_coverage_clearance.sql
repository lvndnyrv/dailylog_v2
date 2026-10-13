-- A future coverage invitation must not rely only on today's live clearance.
-- The demand forecast already checks the target date; apply that same gate to
-- coverage candidates and direct coverage writes, including borrowed staff.
create or replace function public._coverage_conflict(
  p_staff uuid, p_room uuid, p_start timestamptz, p_end timestamptz,
  p_exclude uuid default null
)
returns text language plpgsql stable security definer set search_path=public as $$
declare
  reason text;
  center_zone text;
  first_day date;
  last_day date;
begin
  reason := public._coverage_conflict_without_forecast(
    p_staff, p_room, p_start, p_end, p_exclude);
  if reason is not null and reason not like 'Published shift in another room%' then
    return reason;
  end if;

  select center.timezone into center_zone
    from public.staff_members member
    join public.daycares center on center.id = member.daycare_id
   where member.id = p_staff;
  first_day := (p_start at time zone center_zone)::date;
  last_day := ((p_end - interval '1 microsecond') at time zone center_zone)::date;
  if not public._forecast_staff_eligible(p_staff, first_day)
     or not public._forecast_staff_eligible(p_staff, last_day) then
    return 'Required background clearance will not be valid throughout this coverage interval';
  end if;

  if reason like 'Published shift in another room%'
     and public._can_lend_educator(p_staff, p_room, p_start, p_end) then
    return null;
  end if;
  return reason;
end $$;
