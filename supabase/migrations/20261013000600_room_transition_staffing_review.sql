-- A saved move changes forecast demand, but does not reserve an educator.
-- Keep this advisory separate from plan-invalidity alerts and only calculate it
-- when an administrator opens the plan. Avoid a costly per-plan cron forecast.
create function public.get_room_transition_staffing_review(p_plan_id uuid)
returns table(status text, message text, segments integer, maximum_shortfall integer)
language plpgsql stable security definer set search_path = public set jit = off as $$
declare
  v_plan public.room_transition_plans;
  v_center public.daycares;
  v_today date;
  v_segments integer;
  v_undercovered integer;
  v_hard_gaps integer;
  v_unknown integer;
  v_max_shortfall integer;
begin
  if not public.is_admin() or not public.has_permission('children', 'view')
    or not public.has_permission('rooms', 'view') then
    raise exception 'Administrator room and child viewing permission required';
  end if;
  select * into v_plan from public.room_transition_plans
    where id = p_plan_id and daycare_id = public.get_my_daycare_id() and status = 'planned';
  if not found then raise exception 'Planned move unavailable'; end if;
  select * into v_center from public.daycares where id = v_plan.daycare_id;
  v_today := (now() at time zone v_center.timezone)::date;

  if v_plan.review_issue is not null then
    return query select 'unknown'::text, 'Resolve the saved move warning before relying on its staffing forecast.'::text, 0, 0;
    return;
  end if;
  if v_plan.move_on < v_today or v_plan.move_on > v_today + 90 then
    return query select 'unknown'::text, 'Published staffing can be checked within 90 days of the move day.'::text, 0, 0;
    return;
  end if;
  if not exists (
    select 1 from public.staff_shifts shift
    where shift.daycare_id = v_plan.daycare_id and shift.status = 'published'
      and shift.starts_at < (v_plan.move_on + v_center.closes_at) at time zone v_center.timezone
      and shift.ends_at > (v_plan.move_on + v_center.opens_at) at time zone v_center.timezone
  ) then
    return query select 'unknown'::text, 'No published staffing plan exists for the move day yet.'::text, 0, 0;
    return;
  end if;

  with forecast as materialized (
    select f.* from public._room_demand_forecast(v_plan.daycare_id, v_plan.move_on) f
    where f.room_id = public._operating_room_id(v_plan.to_classroom_id, f.starts_at)
      and f.expected_children > 0
  )
  select count(*)::integer,
         count(*) filter (where scheduled_staff < required_staff)::integer,
         count(*) filter (where scheduled_staff + pending_staff + uncertain_staff < required_staff)::integer,
         coalesce(max(unknown_bookings), 0)::integer,
         coalesce(max(greatest(0, required_staff - scheduled_staff)), 0)::integer
    into v_segments, v_undercovered, v_hard_gaps, v_unknown, v_max_shortfall
    from forecast;

  if v_segments = 0 then
    return query select 'unknown'::text, 'No booked destination-room demand can be assessed for that day yet.'::text, 0, 0;
  elsif v_hard_gaps > 0 then
    return query select 'gap'::text,
      format('%s move-day coverage segment(s) need up to %s more educator(s) under the current bookings and published shifts.%s',
        v_hard_gaps, v_max_shortfall,
        case when v_unknown > 0 then ' Some child bookings are still unknown.' else '' end),
      v_segments, v_max_shortfall;
  elsif v_undercovered > 0 or v_unknown > 0 then
    return query select 'conditional'::text,
      'Move-day coverage depends on pending staff, unresolved break timing, or unknown child bookings.'::text,
      v_segments, v_max_shortfall;
  else
    return query select 'covered'::text,
      'Published shifts cover the currently booked destination-room demand on move day.'::text,
      v_segments, 0;
  end if;
end;
$$;
revoke all on function public.get_room_transition_staffing_review(uuid) from public, anon;
grant execute on function public.get_room_transition_staffing_review(uuid) to authenticated;
