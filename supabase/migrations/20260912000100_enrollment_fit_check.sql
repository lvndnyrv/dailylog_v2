-- Enrollment application fit checks must use the same dated occupancy model
-- as final offer submission. Staffing is advisory: it evaluates the published
-- room forecast after adding this child and any other active offer holds.
create or replace function public.get_enrollment_fit_check(p_enrollment_id uuid)
returns table (
  enrollment_id uuid,
  classroom_id uuid,
  room_name text,
  start_on date,
  age_months integer,
  min_age_months integer,
  max_age_months integer,
  age_status text,
  age_message text,
  projected_children_before integer,
  projected_children_after integer,
  capacity integer,
  capacity_status text,
  capacity_message text,
  staffing_status text,
  staffing_message text,
  coverage_segments integer,
  undercovered_segments integer,
  maximum_educator_gap integer
)
language plpgsql
stable
security definer
set search_path = public
set jit = off
as $$
declare
  v_center_id uuid := public.get_my_daycare_id();
  v_enrollment public.enrollments%rowtype;
  v_room public.classrooms%rowtype;
  v_today date;
  v_age integer;
  v_occupancy integer;
  v_current_hold boolean := false;
  v_before integer;
  v_after integer;
  v_age_status text := 'unknown';
  v_age_message text := 'Add the child birth date and choose a room to confirm age fit.';
  v_capacity_status text := 'unknown';
  v_capacity_message text := 'Choose a room and first day to check projected capacity.';
  v_staffing_status text := 'unknown';
  v_staffing_message text := 'Choose a room and first day to check published coverage.';
  v_segments integer := 0;
  v_undercovered integer := 0;
  v_hard_gaps integer := 0;
  v_maximum_gap integer := 0;
begin
  if auth.uid() is null
     or not public.is_admin()
     or not public.has_permission('enrollment', 'view') then
    raise exception 'Administrator enrollment-view permission required';
  end if;
  if v_center_id is null then raise exception 'No center on your profile'; end if;

  select * into v_enrollment
    from public.enrollments enrollment
   where enrollment.id = p_enrollment_id
     and enrollment.daycare_id = v_center_id;
  if v_enrollment.id is null then raise exception 'Enrollment record not found'; end if;

  select (now() at time zone coalesce(center.timezone, 'UTC'))::date
    into v_today
    from public.daycares center
   where center.id = v_center_id;

  if v_enrollment.classroom_id is not null then
    select * into v_room
      from public.classrooms room
     where room.id = v_enrollment.classroom_id
       and room.daycare_id = v_center_id
       and room.archived_at is null;
  end if;

  if v_room.id is null then
    return query select
      v_enrollment.id, null::uuid, null::text, v_enrollment.desired_start_date,
      null::integer, null::integer, null::integer,
      v_age_status, v_age_message,
      null::integer, null::integer, null::integer,
      v_capacity_status, v_capacity_message,
      v_staffing_status, v_staffing_message,
      0, 0, 0;
    return;
  end if;

  if v_enrollment.desired_start_date is not null
     and v_enrollment.child_date_of_birth is not null then
    v_age := (
      extract(year from age(v_enrollment.desired_start_date, v_enrollment.child_date_of_birth)) * 12
      + extract(month from age(v_enrollment.desired_start_date, v_enrollment.child_date_of_birth))
    )::integer;
  end if;

  if v_enrollment.child_date_of_birth is null then
    v_age_message := 'Add the child birth date to confirm age fit.';
  elsif v_enrollment.desired_start_date is null then
    v_age_message := 'Choose a first day to calculate the child age on arrival.';
  elsif v_room.min_age_months is null or v_room.max_age_months is null then
    v_age_message := 'Set the ' || v_room.name || ' age band before making an offer.';
  elsif v_age < v_room.min_age_months or v_age >= v_room.max_age_months then
    v_age_status := 'fail';
    v_age_message := coalesce(v_enrollment.child_first_name, 'This child') || ' will be '
      || v_age || ' months old; ' || v_room.name || ' accepts '
      || v_room.min_age_months || '–' || (v_room.max_age_months - 1) || ' months.';
  else
    v_age_status := 'pass';
    v_age_message := coalesce(v_enrollment.child_first_name, 'This child') || ' will be '
      || v_age || ' months old and fits ' || v_room.name || '.';
  end if;

  if v_enrollment.desired_start_date is not null then
    v_occupancy := coalesce(public._enrollment_room_projected_occupancy(
      v_room.id,
      v_enrollment.desired_start_date
    ), 0);

    if v_enrollment.child_id is null then
      select exists (
        select 1
          from public.enrollments current_offer
         where current_offer.id = v_enrollment.id
           and current_offer.classroom_id = v_room.id
           and coalesce(current_offer.desired_start_date, '-infinity'::date)
               <= v_enrollment.desired_start_date
           and (
             current_offer.stage = 'enrolled'
             or (
               current_offer.stage = 'offer'
               and (
                 current_offer.offer_status = 'accepted'
                 or (
                   current_offer.offer_status in ('sent', 'viewed')
                   and (
                     current_offer.offer_expires_at is null
                     or current_offer.offer_expires_at > now()
                   )
                 )
               )
             )
           )
      ) into v_current_hold;
      v_before := greatest(0, v_occupancy - case when v_current_hold then 1 else 0 end);
      v_after := v_before + 1;
    else
      v_before := v_occupancy;
      v_after := v_occupancy;
    end if;
  end if;

  if v_enrollment.desired_start_date is null then
    v_capacity_message := 'Choose a first day to check projected capacity.';
  elsif v_enrollment.desired_start_date < v_today
     or v_enrollment.desired_start_date > v_today + 730 then
    v_capacity_status := 'fail';
    v_capacity_message := 'Choose a first day within the next two years.';
  elsif extract(isodow from v_enrollment.desired_start_date) not between 1 and 5
     or exists (
       select 1 from public.center_closures closure
        where closure.daycare_id = v_center_id
          and v_enrollment.desired_start_date between closure.starts_on and closure.ends_on
     ) then
    v_capacity_status := 'fail';
    v_capacity_message := 'The center is closed on the selected first day.';
  elsif v_room.opens_on is not null and v_room.opens_on > v_enrollment.desired_start_date then
    v_capacity_status := 'fail';
    v_capacity_message := v_room.name || ' does not open until '
      || to_char(v_room.opens_on, 'Mon FMDD, YYYY') || '.';
  elsif v_room.capacity is null or v_room.capacity < 1 then
    v_capacity_message := 'Set a positive capacity for ' || v_room.name || ' before making an offer.';
  elsif v_after > v_room.capacity then
    v_capacity_status := 'fail';
    v_capacity_message := v_room.name || ' would have ' || v_after || ' children for '
      || v_room.capacity || ' places on ' || to_char(v_enrollment.desired_start_date, 'Mon FMDD') || '.';
  else
    v_capacity_status := 'pass';
    v_capacity_message := (v_room.capacity - v_before) || ' '
      || case when v_room.capacity - v_before = 1 then 'spot is' else 'spots are' end
      || ' projected open in ' || v_room.name || '; this child would use one.';
  end if;

  if v_enrollment.desired_start_date is null then
    v_staffing_message := 'Choose a first day to check published coverage.';
  elsif v_capacity_status = 'fail'
     and (
       extract(isodow from v_enrollment.desired_start_date) not between 1 and 5
       or exists (
         select 1 from public.center_closures closure
          where closure.daycare_id = v_center_id
            and v_enrollment.desired_start_date between closure.starts_on and closure.ends_on
       )
       or (v_room.opens_on is not null and v_room.opens_on > v_enrollment.desired_start_date)
     ) then
    v_staffing_message := 'Choose an open first day before checking room coverage.';
  elsif v_room.ratio_children_per_educator is null
     or v_room.ratio_children_per_educator < 1 then
    v_staffing_message := 'Set the ' || v_room.name || ' ratio rule before checking coverage.';
  else
    with forecast as materialized (
      select f.*,
             coalesce((
               select count(*)::integer
                 from public.enrollments held
                where held.daycare_id = v_center_id
                  and held.id is distinct from v_enrollment.id
                  and held.child_id is null
                  and coalesce(held.desired_start_date, '-infinity'::date)
                      <= v_enrollment.desired_start_date
                  and public._operating_room_id(held.classroom_id, f.starts_at) = f.room_id
                  and (
                    held.stage = 'enrolled'
                    or (
                      held.stage = 'offer'
                      and (
                        held.offer_status = 'accepted'
                        or (
                          held.offer_status in ('sent', 'viewed')
                          and (held.offer_expires_at is null or held.offer_expires_at > now())
                        )
                      )
                    )
                  )
             ), 0) as other_offer_holds
        from public._room_demand_forecast(
          v_center_id,
          v_enrollment.desired_start_date,
          null
        ) f
       where f.room_id = public._operating_room_id(v_room.id, f.starts_at)
    ), evaluated as materialized (
      select forecast.*,
             ceil((forecast.expected_children + forecast.other_offer_holds
               + case when v_enrollment.child_id is null then 1 else 0 end)::numeric
               / greatest(forecast.ratio, 1))::integer as required_after
        from forecast
    )
    select count(*)::integer,
           count(*) filter (where scheduled_staff < required_after)::integer,
           count(*) filter (
             where scheduled_staff + pending_staff + uncertain_staff < required_after
           )::integer,
           coalesce(max(greatest(0, required_after - scheduled_staff)), 0)::integer
      into v_segments, v_undercovered, v_hard_gaps, v_maximum_gap
      from evaluated;

    if v_segments = 0 then
      v_staffing_message := 'No published coverage plan is available for that first day.';
    elsif v_hard_gaps > 0 then
      v_staffing_status := 'fail';
      v_staffing_message := v_hard_gaps || ' coverage '
        || case when v_hard_gaps = 1 then 'segment still needs' else 'segments still need' end
        || ' up to ' || v_maximum_gap || ' more '
        || case when v_maximum_gap = 1 then 'educator.' else 'educators.' end;
    elsif v_undercovered > 0 then
      v_staffing_status := 'warning';
      v_staffing_message := v_undercovered || ' coverage '
        || case when v_undercovered = 1 then 'segment relies' else 'segments rely' end
        || ' on pending coverage or unresolved break timing.';
    else
      v_staffing_status := 'pass';
      v_staffing_message := 'Published coverage keeps every room segment in ratio after this child is added.';
    end if;
  end if;

  return query select
    v_enrollment.id, v_room.id, v_room.name, v_enrollment.desired_start_date,
    v_age, v_room.min_age_months, v_room.max_age_months,
    v_age_status, v_age_message,
    v_before, v_after, v_room.capacity,
    v_capacity_status, v_capacity_message,
    v_staffing_status, v_staffing_message,
    v_segments, v_undercovered, v_maximum_gap;
end;
$$;

revoke all on function public.get_enrollment_fit_check(uuid)
  from public, anon;
grant execute on function public.get_enrollment_fit_check(uuid)
  to authenticated;

notify pgrst, 'reload schema';
