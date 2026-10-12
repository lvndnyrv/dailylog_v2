-- Evaluate costly forecast checks once per candidate and once per source loan.
create or replace function public._room_demand_forecast(p_center uuid,p_date date,p_exclude_staff uuid default null)
returns table(room_id uuid,starts_at timestamptz,ends_at timestamptz,expected_children integer,unknown_bookings integer,scheduled_staff integer,pending_staff integer,required_staff integer,ratio integer,uncertain_staff integer)
language sql stable security definer set search_path=public as $$
  with center as (select *, (p_date+opens_at) at time zone timezone opening, (p_date+closes_at) at time zone timezone closing from public.daycares where id=p_center),
  children as materialized(select * from public._forecast_children(p_center,p_date)),
  shifts as materialized(select s.* from public.staff_shifts s,center c where s.daycare_id=p_center and s.status='published' and s.starts_at<c.closing and s.ends_at>c.opening),
  covers as materialized(select a.* from public.room_coverage_assignments a,center c where a.daycare_id=p_center and a.status in ('assigned','accepted') and a.starts_at<c.closing and a.ends_at>c.opening),
  points as (select opening t from center union select closing from center
    union select arrives_at from children union select leaves_at from children
    union select starts_at from shifts union select ends_at from shifts
    union select planned_break_starts_at from shifts union select planned_break_ends_at from shifts
    union select starts_at from covers union select ends_at from covers
    union select (p_date+r.starts_at) at time zone c.timezone from public.room_combinations r,center c where r.daycare_id=p_center
    union select (p_date+r.ends_at) at time zone c.timezone from public.room_combinations r,center c where r.daycare_id=p_center),
  intervals as (select t,lead(t) over(order by t) until from points,center c where t>=c.opening and t<=c.closing),
  rooms as (select r.* from public.classrooms r where r.daycare_id=p_center and r.archived_at is null and coalesce(r.opens_on,'-infinity'::date)<=p_date),
  slots as materialized (select r.id,i.t,i.until,
    coalesce((select min(rr.ratio_children_per_educator) from public._active_room_combination(r.id,i.t) combo join rooms rr on rr.id in (combo.source_classroom_id,combo.host_classroom_id)),r.ratio_children_per_educator,1) ratio
    from rooms r cross join intervals i where i.until>i.t and public._operating_room_id(r.id,i.t)=r.id
      and not exists(select 1 from public.center_closures cl where cl.daycare_id=p_center and p_date between cl.starts_on and cl.ends_on)),
  staff_at as materialized(select distinct i.t,m.id staff_id,
    public._operating_room_id(coalesce(cover.classroom_id,s.classroom_id,p.classroom_id),i.t) operating_room,
    case when cover.id is not null then cover.status='assigned' else false end pending,
    s.unpaid_break_minutes>0 and (s.planned_break_starts_at is null or extract(epoch from(s.planned_break_ends_at-s.planned_break_starts_at))/60<s.unpaid_break_minutes) uncertain
    from intervals i join shifts s on s.starts_at<=i.t and s.ends_at>i.t
    join public.staff_members m on m.id=s.staff_member_id join public.profiles p on p.id=m.profile_id
    left join lateral(select a.* from covers a where a.staff_member_id=m.id and a.starts_at<=i.t and a.ends_at>i.t order by a.starts_at desc limit 1) cover on true
    where not exists(select 1 from shifts other where other.staff_member_id=m.id and other.id<>s.id and other.starts_at<=i.t and other.ends_at>i.t and other.classroom_id is distinct from s.classroom_id)
      and i.until>i.t and m.id is distinct from p_exclude_staff and public._forecast_staff_eligible(m.id,p_date)
      and not (coalesce(s.planned_break_starts_at<=i.t and s.planned_break_ends_at>i.t,false))),
  counts as materialized (select slot.*,
    (select count(*)::int from children ch where public._operating_room_id(ch.room_id,slot.t)=slot.id and ch.arrives_at<=slot.t and ch.leaves_at>slot.t) kids,
    (select count(*)::int from children ch where public._operating_room_id(ch.room_id,slot.t)=slot.id and ch.arrives_at<=slot.t and ch.leaves_at>slot.t and ch.uncertain) unknown,
    (select count(distinct staff_id)::int from staff_at s where s.t=slot.t and s.operating_room=slot.id and not s.pending and not s.uncertain) staff,
    (select count(distinct staff_id)::int from staff_at s where s.t=slot.t and s.operating_room=slot.id and s.pending) pending,
    (select count(distinct staff_id)::int from staff_at s where s.t=slot.t and s.operating_room=slot.id and s.uncertain) uncertain
    from slots slot)
  select id,t,until,kids,unknown,staff,pending,ceil(kids::numeric/greatest(ratio,1))::int,ratio,uncertain from counts;
$$;
create or replace function public._can_lend_educator(p_staff uuid,p_target uuid,p_start timestamptz,p_end timestamptz)
returns boolean language plpgsql stable security definer set search_path=public as $$
declare c public.daycares; source uuid; day date; home uuid;
begin
  select d.* into c from public.staff_members m join public.daycares d on d.id=m.daycare_id where m.id=p_staff;
  day:=(p_start at time zone c.timezone)::date;
  if (p_end at time zone c.timezone)::date<>day or not public._forecast_staff_eligible(p_staff,day) then return false; end if;
  select s.classroom_id into source from public.staff_shifts s where s.staff_member_id=p_staff and s.status='published' and s.starts_at<=p_start and s.ends_at>=p_end
    and s.classroom_id is not null and (s.unpaid_break_minutes=0 or (s.planned_break_starts_at is not null and extract(epoch from(s.planned_break_ends_at-s.planned_break_starts_at))/60>=s.unpaid_break_minutes))
    and not coalesce(s.planned_break_starts_at<p_end and s.planned_break_ends_at>p_start,false)
    order by s.starts_at limit 1;
  if source is null or source=p_target then return false; end if;
  if exists(select 1 from public.room_transition_plans t where t.daycare_id=c.id and t.status='planned' and t.move_on<=day and source in(t.from_classroom_id,t.to_classroom_id)) then return false; end if;
  select classroom_id into home from public.profiles where id=(select profile_id from public.staff_members where id=p_staff);
  if home is not null and home<>source then return false; end if;
  if exists(select 1 from public.educator_classrooms e join public.staff_members m on m.profile_id=e.educator_id where m.id=p_staff and e.classroom_id<>source) then return false; end if;
  if exists(select 1 from public.staff_shifts s where s.staff_member_id=p_staff and s.status='published' and s.starts_at<p_end and s.ends_at>p_start and s.classroom_id is distinct from source) then return false; end if;
  if exists(select 1 from public.room_coverage_assignments a where a.staff_member_id=p_staff and a.status in ('assigned','accepted') and a.starts_at<p_end and a.ends_at>p_start) then return false; end if;
  return (select count(*)>0 and coalesce(bool_and(f.unknown_bookings=0 and f.uncertain_staff=0 and f.scheduled_staff>=f.required_staff
    and public._operating_room_id(p_target,greatest(f.starts_at,p_start))<>f.room_id),false)
    from public._room_demand_forecast(c.id,day,p_staff) f
    where f.room_id=public._operating_room_id(source,greatest(f.starts_at,p_start)) and f.starts_at<p_end and f.ends_at>p_start);
end $$;
create or replace function public.get_coverage_candidates(p_room uuid,p_date date,p_start time,p_end time)
returns table(profile_id uuid,full_name text,available boolean,reason text,needs_confirmation boolean)
language plpgsql stable security definer set search_path=public set jit=off as $$
declare c public.daycares; a timestamptz; b timestamptz;
begin
  if not public.is_admin() or not public.has_permission('rooms','view') then raise exception 'Room viewing permission required'; end if;
  select * into c from public.daycares where id=public.get_my_daycare_id();
  if not exists(select 1 from public.classrooms where id=p_room and daycare_id=c.id and archived_at is null) then raise exception 'Room unavailable'; end if;
  if p_date is null or p_start is null or p_end is null or p_end<=p_start then raise exception 'Choose a valid date and interval'; end if;
  a:=(p_date+p_start) at time zone c.timezone; b:=(p_date+p_end) at time zone c.timezone;
  return query with base as materialized(
    select p.id pid,p.full_name name,m.id mid,
      public._coverage_conflict_without_forecast(m.id,p_room,a,b,null) conflict,
      exists(select 1 from public.staff_shifts s where s.staff_member_id=m.id and s.status='published' and s.starts_at<=a and s.ends_at>=b) has_shift,
      exists(select 1 from public.staff_shifts s where s.staff_member_id=m.id and s.status='published' and s.starts_at<b and s.ends_at>a and s.unpaid_break_minutes>0
        and (s.planned_break_starts_at is null or extract(epoch from(s.planned_break_ends_at-s.planned_break_starts_at))/60<s.unpaid_break_minutes)) untimed,
      (p.classroom_id is not null and p.classroom_id<>p_room)
        or exists(select 1 from public.educator_classrooms e where e.educator_id=p.id and e.classroom_id<>p_room)
        or exists(select 1 from public.staff_shifts s where s.staff_member_id=m.id and s.status='published' and s.classroom_id<>p_room and s.starts_at<b and s.ends_at>a) committed
    from public.staff_members m join public.profiles p on p.id=m.profile_id
    where m.daycare_id=c.id and p.daycare_id=c.id and m.archived_at is null and p.archived_at is null and p.role='educator'
  ), checked as materialized(
    select base.*,case when committed and (conflict is null or conflict like 'Published shift in another room%')
      then public._can_lend_educator(mid,p_room,a,b) else false end safe from base
  ), final as materialized(
    select checked.*,case when conflict is not null and conflict not like 'Published shift in another room%' then conflict
      when committed and not safe then 'Source-room forecast cannot safely lend this educator for the whole interval'
      when safe then null else conflict end blocker from checked
  )
  select pid,name,blocker is null,coalesce(blocker,case when safe then 'Source room remains covered for the whole interval — forecast checked'
    when not has_shift then 'No published shift covers the whole interval — confirm availability'
    when untimed then 'Shift has an untimed break — confirm this interval is outside it' else 'Available for this interval' end),
    blocker is null and not committed and (not has_shift or untimed)
  from final order by (blocker is null) desc,name;
end $$;
