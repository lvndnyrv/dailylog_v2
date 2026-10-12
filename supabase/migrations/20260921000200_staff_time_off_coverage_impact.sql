-- Give staff approvers a concrete, forecast-backed view of the room coverage
-- impact before they approve time off. The forecast is evaluated as if the
-- requesting educator were absent, but no schedule or request state is changed.

create or replace function public.get_staff_time_off_coverage_impacts(
  p_request_ids uuid[]
)
returns table(
  request_id uuid,
  work_date date,
  room_id uuid,
  room_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  expected_children integer,
  scheduled_staff integer,
  required_staff integer,
  staff_gap integer,
  unknown_bookings integer,
  uncertain_staff integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.has_permission('staff', 'approve') then
    raise exception 'Staff approval permission required';
  end if;

  if coalesce(array_length(p_request_ids, 1), 0) > 100 then
    raise exception 'At most 100 time-off requests can be checked at once';
  end if;

  return query
  with selected_requests as materialized (
    select
      request.id,
      request.daycare_id,
      request.staff_member_id,
      request.starts_on,
      request.ends_on,
      daycare.timezone,
      profile.classroom_id as home_classroom_id
    from public.staff_time_off_requests request
    join public.daycares daycare on daycare.id = request.daycare_id
    join public.staff_members member on member.id = request.staff_member_id
    join public.profiles profile on profile.id = member.profile_id
    where request.id = any(coalesce(p_request_ids, '{}'::uuid[]))
      and request.daycare_id = public.get_my_daycare_id()
      and request.status = 'pending'
  ), request_days as materialized (
    select request.*, day::date as work_date
    from selected_requests request
    cross join lateral generate_series(
      request.starts_on,
      request.ends_on,
      interval '1 day'
    ) day
  ), scheduled_rooms as materialized (
    select
      request.id as request_id,
      request.daycare_id,
      request.staff_member_id,
      request.work_date,
      request.timezone,
      shift.starts_at,
      shift.ends_at,
      coalesce(shift.classroom_id, request.home_classroom_id) as classroom_id
    from request_days request
    join public.staff_shifts shift
      on shift.staff_member_id = request.staff_member_id
     and shift.status = 'published'
     and shift.starts_at < (request.work_date + interval '1 day') at time zone request.timezone
     and shift.ends_at > request.work_date::timestamp at time zone request.timezone
    where coalesce(shift.classroom_id, request.home_classroom_id) is not null
  ), impacted as (
    select distinct
      scheduled.request_id,
      scheduled.work_date,
      forecast.room_id,
      classroom.name as room_name,
      greatest(forecast.starts_at, scheduled.starts_at) as starts_at,
      least(forecast.ends_at, scheduled.ends_at) as ends_at,
      forecast.expected_children,
      forecast.scheduled_staff,
      forecast.required_staff,
      greatest(forecast.required_staff - forecast.scheduled_staff, 0)::integer as staff_gap,
      forecast.unknown_bookings,
      forecast.uncertain_staff
    from scheduled_rooms scheduled
    cross join lateral public._room_demand_forecast(
      scheduled.daycare_id,
      scheduled.work_date,
      scheduled.staff_member_id
    ) forecast
    join public.classrooms classroom on classroom.id = forecast.room_id
    where forecast.starts_at < scheduled.ends_at
      and forecast.ends_at > scheduled.starts_at
      and forecast.room_id = public._operating_room_id(
        scheduled.classroom_id,
        greatest(forecast.starts_at, scheduled.starts_at)
      )
      and forecast.scheduled_staff < forecast.required_staff
  )
  select
    impacted.request_id,
    impacted.work_date,
    impacted.room_id,
    impacted.room_name,
    impacted.starts_at,
    impacted.ends_at,
    impacted.expected_children,
    impacted.scheduled_staff,
    impacted.required_staff,
    impacted.staff_gap,
    impacted.unknown_bookings,
    impacted.uncertain_staff
  from impacted
  where impacted.ends_at > impacted.starts_at
  order by impacted.request_id, impacted.work_date, impacted.starts_at;
end;
$$;

revoke all on function public.get_staff_time_off_coverage_impacts(uuid[])
  from public, anon, authenticated;
grant execute on function public.get_staff_time_off_coverage_impacts(uuid[])
  to authenticated;

comment on function public.get_staff_time_off_coverage_impacts(uuid[]) is
  'Forecasts room coverage gaps caused by approving pending staff time-off requests without mutating schedules.';

notify pgrst, 'reload schema';
