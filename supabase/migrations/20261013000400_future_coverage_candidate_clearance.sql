-- Keep the optimized coverage picker aligned with the direct-write guard:
-- both must evaluate required clearance on the requested coverage date.
create or replace function public.get_coverage_candidates(
  p_room uuid,p_date date,p_start time,p_end time
)
returns table(profile_id uuid,full_name text,available boolean,reason text,needs_confirmation boolean)
language plpgsql stable security definer set search_path=public set jit=off as $$
declare c public.daycares; a timestamptz; b timestamptz;
begin
  if not public.is_admin() or not public.has_permission('rooms','view') then
    raise exception 'Room viewing permission required';
  end if;
  select * into c from public.daycares where id=public.get_my_daycare_id();
  if not exists(select 1 from public.classrooms
    where id=p_room and daycare_id=c.id and archived_at is null) then
    raise exception 'Room unavailable';
  end if;
  if p_date is null or p_start is null or p_end is null or p_end<=p_start then
    raise exception 'Choose a valid date and interval';
  end if;
  a:=(p_date+p_start) at time zone c.timezone;
  b:=(p_date+p_end) at time zone c.timezone;
  return query with base as materialized(
    select p.id pid,p.full_name name,m.id mid,
      public._coverage_conflict_without_forecast(m.id,p_room,a,b,null) conflict,
      exists(select 1 from public.staff_shifts s where s.staff_member_id=m.id
        and s.status='published' and s.starts_at<=a and s.ends_at>=b) has_shift,
      exists(select 1 from public.staff_shifts s where s.staff_member_id=m.id
        and s.status='published' and s.starts_at<b and s.ends_at>a
        and s.unpaid_break_minutes>0
        and (s.planned_break_starts_at is null or
          extract(epoch from(s.planned_break_ends_at-s.planned_break_starts_at))/60<s.unpaid_break_minutes)) untimed,
      (p.classroom_id is not null and p.classroom_id<>p_room)
        or exists(select 1 from public.educator_classrooms e
          where e.educator_id=p.id and e.classroom_id<>p_room)
        or exists(select 1 from public.staff_shifts s
          where s.staff_member_id=m.id and s.status='published'
            and s.classroom_id<>p_room and s.starts_at<b and s.ends_at>a) committed
    from public.staff_members m join public.profiles p on p.id=m.profile_id
    where m.daycare_id=c.id and p.daycare_id=c.id and m.archived_at is null
      and p.archived_at is null and p.role='educator'
  ), checked as materialized(
    select base.*, public._forecast_staff_eligible(mid,p_date) future_eligible,
      case when committed and (conflict is null or conflict like 'Published shift in another room%')
        then public._can_lend_educator(mid,p_room,a,b) else false end safe
    from base
  ), final as materialized(
    select checked.*,
      case when conflict is not null and conflict not like 'Published shift in another room%' then conflict
        when not future_eligible then 'Required background clearance will not be valid throughout this coverage interval'
        when committed and not safe then 'Source-room forecast cannot safely lend this educator for the whole interval'
        when safe then null else conflict end blocker
    from checked
  )
  select pid,name,blocker is null,
    coalesce(blocker,case when safe then 'Source room remains covered for the whole interval — forecast checked'
      when not has_shift then 'No published shift covers the whole interval — confirm availability'
      when untimed then 'Shift has an untimed break — confirm this interval is outside it'
      else 'Available for this interval' end),
    blocker is null and not committed and (not has_shift or untimed)
  from final order by (blocker is null) desc,name;
end $$;
