-- Resolve shared-room mapping once per room/time boundary, not once per child/count.
create or replace function public._room_demand_forecast(p_center uuid,p_date date,p_exclude_staff uuid default null)
returns table(room_id uuid,starts_at timestamptz,ends_at timestamptz,expected_children integer,unknown_bookings integer,scheduled_staff integer,pending_staff integer,required_staff integer,ratio integer,uncertain_staff integer)
language sql stable security definer set search_path=public set jit=off as $$
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
  room_at as materialized (select r.id home_id,i.t,public._operating_room_id(r.id,i.t) host_id from rooms r cross join intervals i where i.until>i.t),
  slots as materialized (select r.id,i.t,i.until,
    coalesce((select min(rr.ratio_children_per_educator) from public._active_room_combination(r.id,i.t) combo join rooms rr on rr.id in (combo.source_classroom_id,combo.host_classroom_id)),r.ratio_children_per_educator,1) ratio
    from rooms r cross join intervals i join room_at mapping on mapping.t=i.t where i.until>i.t and mapping.home_id=r.id and mapping.host_id=r.id
      and not exists(select 1 from public.center_closures cl where cl.daycare_id=p_center and p_date between cl.starts_on and cl.ends_on)),
  staff_at as materialized(select distinct i.t,m.id staff_id,
    (select mapping.host_id from room_at mapping where mapping.home_id=coalesce(cover.classroom_id,s.classroom_id,p.classroom_id) and mapping.t=i.t) operating_room,
    case when cover.id is not null then cover.status='assigned' else false end pending,
    s.unpaid_break_minutes>0 and (s.planned_break_starts_at is null or extract(epoch from(s.planned_break_ends_at-s.planned_break_starts_at))/60<s.unpaid_break_minutes) uncertain
    from intervals i join shifts s on s.starts_at<=i.t and s.ends_at>i.t
    join public.staff_members m on m.id=s.staff_member_id join public.profiles p on p.id=m.profile_id
    left join lateral(select a.* from covers a where a.staff_member_id=m.id and a.starts_at<=i.t and a.ends_at>i.t order by a.starts_at desc limit 1) cover on true
    where not exists(select 1 from shifts other where other.staff_member_id=m.id and other.id<>s.id and other.starts_at<=i.t and other.ends_at>i.t and other.classroom_id is distinct from s.classroom_id)
      and i.until>i.t and m.id is distinct from p_exclude_staff and public._forecast_staff_eligible(m.id,p_date)
      and not (coalesce(s.planned_break_starts_at<=i.t and s.planned_break_ends_at>i.t,false))),
  counts as materialized (select slot.*,
    (select count(*)::int from children ch where exists(select 1 from room_at mapping where mapping.home_id=ch.room_id and mapping.t=slot.t and mapping.host_id=slot.id) and ch.arrives_at<=slot.t and ch.leaves_at>slot.t) kids,
    (select count(*)::int from children ch where exists(select 1 from room_at mapping where mapping.home_id=ch.room_id and mapping.t=slot.t and mapping.host_id=slot.id) and ch.arrives_at<=slot.t and ch.leaves_at>slot.t and ch.uncertain) unknown,
    (select count(distinct staff_id)::int from staff_at s where s.t=slot.t and s.operating_room=slot.id and not s.pending and not s.uncertain) staff,
    (select count(distinct staff_id)::int from staff_at s where s.t=slot.t and s.operating_room=slot.id and s.pending) pending,
    (select count(distinct staff_id)::int from staff_at s where s.t=slot.t and s.operating_room=slot.id and s.uncertain) uncertain
    from slots slot)
  select id,t,until,kids,unknown,staff,pending,ceil(kids::numeric/greatest(ratio,1))::int,ratio,uncertain from counts;
$$;

-- CREATE OR REPLACE resets function settings omitted by the replacement.
alter function public._can_lend_educator(uuid,uuid,timestamptz,timestamptz) set jit=off;
-- Include direct inserts in the same serialization as planned RPC assignments.
create function public.lock_room_coverage_plan() returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('coverage-plan:'||new.daycare_id::text,0));
  return new;
end $$;
create trigger aa_lock_room_coverage_plan before insert or update on public.room_coverage_assignments
  for each row execute function public.lock_room_coverage_plan();
