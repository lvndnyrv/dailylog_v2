-- Dated attendance bookings are planning inputs, never attendance events.
create table public.child_attendance_bookings (
  child_id uuid not null references public.children(id) on delete cascade,
  daycare_id uuid not null references public.daycares(id) on delete cascade,
  booked_on date not null,
  expected boolean not null,
  arrives_at time,
  leaves_at time,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) default auth.uid(),
  primary key(child_id,booked_on),
  check ((expected and arrives_at is not null and leaves_at is not null and arrives_at<leaves_at)
    or (not expected and arrives_at is null and leaves_at is null))
);
alter table public.child_attendance_bookings enable row level security;
create policy "admins read attendance planning" on public.child_attendance_bookings for select to authenticated
  using(daycare_id=public.get_my_daycare_id() and public.is_admin() and public.has_permission('rooms','view'));
create trigger audit_child_attendance_bookings after insert or update or delete on public.child_attendance_bookings
  for each row execute function public.audit_write();

create function public.save_attendance_bookings(p_date date,p_bookings jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare c public.daycares; item jsonb; child uuid; arrives time; leaves time; expected boolean;
begin
  if not public.is_admin() or not public.has_permission('rooms','edit') then raise exception 'Room editing permission required'; end if;
  select * into c from public.daycares where id=public.get_my_daycare_id();
  if p_date is null or p_date<(now() at time zone c.timezone)::date or p_date>(now() at time zone c.timezone)::date+90 then raise exception 'Choose a planning date in the next 90 days'; end if;
  if jsonb_typeof(p_bookings) is distinct from 'array' or jsonb_array_length(p_bookings)>500 then raise exception 'Invalid bookings'; end if;
  perform pg_advisory_xact_lock(hashtextextended('coverage-plan:'||c.id::text,0));
  for item in select value from jsonb_array_elements(p_bookings) loop
    child := (item->>'child_id')::uuid;
    if not exists(select 1 from public.children where id=child and daycare_id=c.id and archived_at is null) then raise exception 'Child unavailable'; end if;
    if item->>'state'='unknown' then
      delete from public.child_attendance_bookings where child_id=child and booked_on=p_date;
      continue;
    end if;
    if item->>'state' not in ('expected','not_scheduled') or item->>'state' is null then raise exception 'Choose expected, not scheduled or unknown'; end if;
    expected := item->>'state'='expected';
    arrives := case when expected then (item->>'arrives_at')::time end;
    leaves := case when expected then (item->>'leaves_at')::time end;
    if expected and (arrives is null or leaves is null or arrives>=leaves or arrives<c.opens_at or leaves>c.closes_at) then raise exception 'Booking times must be within center hours, with pickup after arrival'; end if;
    insert into public.child_attendance_bookings(child_id,daycare_id,booked_on,expected,arrives_at,leaves_at)
      values(child,c.id,p_date,expected,arrives,leaves)
      on conflict(child_id,booked_on) do update set expected=excluded.expected,arrives_at=excluded.arrives_at,leaves_at=excluded.leaves_at,updated_at=now(),updated_by=auth.uid();
  end loop;
end $$;
revoke all on function public.save_attendance_bookings(date,jsonb) from public,anon;
grant execute on function public.save_attendance_bookings(date,jsonb) to authenticated;

create function public._forecast_children(p_center uuid,p_date date)
returns table(child_id uuid,room_id uuid,arrives_at timestamptz,leaves_at timestamptz,uncertain boolean)
language sql stable security definer set search_path=public as $$
  select ch.id,coalesce(move.to_classroom_id,ch.classroom_id),
    (p_date+coalesce(b.arrives_at,c.opens_at)) at time zone c.timezone,
    (p_date+coalesce(b.leaves_at,c.closes_at)) at time zone c.timezone,
    b.child_id is null
  from public.children ch join public.daycares c on c.id=ch.daycare_id
  left join public.child_attendance_bookings b on b.child_id=ch.id and b.booked_on=p_date
  left join lateral(select t.to_classroom_id from public.room_transition_plans t where t.child_id=ch.id and t.status='planned' and t.move_on<=p_date order by t.move_on desc limit 1) move on true
  where ch.daycare_id=p_center and ch.archived_at is null and coalesce(ch.enrolled_on,'-infinity'::date)<=p_date
    and coalesce(b.expected,true)
    and not exists(select 1 from public.child_departures d where d.child_id=ch.id and d.status in ('scheduled','completed') and d.last_day<p_date)
    and not exists(select 1 from public.parent_absence_reports a where a.child_id=ch.id and a.status='reported' and p_date between a.starts_on and a.ends_on)
    and not exists(select 1 from public.attendance_records a where a.child_id=ch.id and a.date=p_date and a.status='absent');
$$;

create function public._forecast_staff_eligible(p_staff uuid,p_date date)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.staff_members m join public.profiles p on p.id=m.profile_id
    where m.id=p_staff and m.status='active' and m.archived_at is null and p.role='educator' and p.archived_at is null
    and (not m.background_check_required or exists(select 1 from public.staff_credentials cr where cr.staff_member_id=m.id and cr.archived_at is null and cr.required
      and lower(cr.name)~'(background|criminal record|vulnerable sector)' and cr.completed_on<=p_date and cr.document_id is not null and (cr.expires_on is null or cr.expires_on>=p_date)))
    and not exists(select 1 from public.staff_time_off_requests a where a.staff_member_id=m.id and a.status='approved' and p_date between a.starts_on and a.ends_on));
$$;

create function public._room_demand_forecast(p_center uuid,p_date date,p_exclude_staff uuid default null)
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
  slots as (select r.id,i.t,i.until,
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
    where i.until>i.t and m.id is distinct from p_exclude_staff and public._forecast_staff_eligible(m.id,p_date)
      and not (coalesce(s.planned_break_starts_at<=i.t and s.planned_break_ends_at>i.t,false))),
  counts as (select slot.*,
    (select count(*)::int from children ch where public._operating_room_id(ch.room_id,slot.t)=slot.id and ch.arrives_at<=slot.t and ch.leaves_at>slot.t) kids,
    (select count(*)::int from children ch where public._operating_room_id(ch.room_id,slot.t)=slot.id and ch.arrives_at<=slot.t and ch.leaves_at>slot.t and ch.uncertain) unknown,
    (select count(distinct staff_id)::int from staff_at s where s.t=slot.t and s.operating_room=slot.id and not s.pending and not s.uncertain) staff,
    (select count(distinct staff_id)::int from staff_at s where s.t=slot.t and s.operating_room=slot.id and s.pending) pending,
    (select count(distinct staff_id)::int from staff_at s where s.t=slot.t and s.operating_room=slot.id and s.uncertain) uncertain
    from slots slot)
  select id,t,until,kids,unknown,staff,pending,ceil(kids::numeric/greatest(ratio,1))::int,ratio,uncertain from counts;
$$;
revoke all on function public._forecast_children(uuid,date),public._forecast_staff_eligible(uuid,date),public._room_demand_forecast(uuid,date,uuid) from public,anon,authenticated,service_role;

create function public.get_room_demand_forecast(p_date date)
returns table(room_id uuid,starts_at timestamptz,ends_at timestamptz,expected_children integer,unknown_bookings integer,scheduled_staff integer,pending_staff integer,required_staff integer,ratio integer,uncertain_staff integer)
language plpgsql stable security definer set search_path=public as $$
declare today date;
begin
  if not public.is_admin() or not public.has_permission('rooms','view') then raise exception 'Room viewing permission required'; end if;
  select (now() at time zone timezone)::date into today from public.daycares where id=public.get_my_daycare_id();
  if p_date is null or p_date<today or p_date>today+90 then raise exception 'Choose a planning date in the next 90 days'; end if;
  return query select * from public._room_demand_forecast(public.get_my_daycare_id(),p_date);
end $$;
revoke all on function public.get_room_demand_forecast(date) from public,anon;
grant execute on function public.get_room_demand_forecast(date) to authenticated;

-- Returning just a boolean deliberately fails closed when any source interval
-- is unknown. Staff loans cannot be approved from the live count alone.
create function public._can_lend_educator(p_staff uuid,p_target uuid,p_start timestamptz,p_end timestamptz)
returns boolean language plpgsql stable security definer set search_path=public as $$
declare c public.daycares; source uuid; day date; home uuid;
begin
  select d.* into c from public.staff_members m join public.daycares d on d.id=m.daycare_id where m.id=p_staff;
  day:=(p_start at time zone c.timezone)::date;
  if (p_end at time zone c.timezone)::date<>day or not public._forecast_staff_eligible(p_staff,day) then return false; end if;
  select s.classroom_id into source from public.staff_shifts s where s.staff_member_id=p_staff and s.status='published' and s.starts_at<=p_start and s.ends_at>=p_end
    and s.classroom_id is not null and (s.unpaid_break_minutes=0 or s.planned_break_starts_at is not null)
    and not coalesce(s.planned_break_starts_at<p_end and s.planned_break_ends_at>p_start,false)
    order by s.starts_at limit 1;
  if source is null or source=p_target then return false; end if;
  select classroom_id into home from public.profiles where id=(select profile_id from public.staff_members where id=p_staff);
  if home is not null and home<>source then return false; end if;
  if exists(select 1 from public.educator_classrooms e join public.staff_members m on m.profile_id=e.educator_id where m.id=p_staff and e.classroom_id<>source) then return false; end if;
  if exists(select 1 from public.staff_shifts s where s.staff_member_id=p_staff and s.status='published' and s.starts_at<p_end and s.ends_at>p_start and s.classroom_id is distinct from source) then return false; end if;
  if exists(select 1 from public.room_coverage_assignments a where a.staff_member_id=p_staff and a.status in ('assigned','accepted') and a.starts_at<p_end and a.ends_at>p_start) then return false; end if;
  if not exists(select 1 from public._room_demand_forecast(c.id,day,p_staff) f where f.room_id=public._operating_room_id(source,greatest(f.starts_at,p_start)) and f.starts_at<p_end and f.ends_at>p_start) then return false; end if;
  return not exists(select 1 from public._room_demand_forecast(c.id,day,p_staff) f
    where f.room_id=public._operating_room_id(source,greatest(f.starts_at,p_start)) and f.starts_at<p_end and f.ends_at>p_start
      and (f.unknown_bookings>0 or f.uncertain_staff>0 or f.scheduled_staff<f.required_staff
        or public._operating_room_id(p_target,greatest(f.starts_at,p_start))=f.room_id));
end $$;
revoke all on function public._can_lend_educator(uuid,uuid,timestamptz,timestamptz) from public,anon,authenticated,service_role;

alter function public._coverage_conflict(uuid,uuid,timestamptz,timestamptz,uuid) rename to _coverage_conflict_without_forecast;
create function public._coverage_conflict(p_staff uuid,p_room uuid,p_start timestamptz,p_end timestamptz,p_exclude uuid default null)
returns text language plpgsql stable security definer set search_path=public as $$
declare reason text;
begin
  reason:=public._coverage_conflict_without_forecast(p_staff,p_room,p_start,p_end,p_exclude);
  if reason like 'Published shift in another room%' and public._can_lend_educator(p_staff,p_room,p_start,p_end) then return null; end if;
  return reason;
end $$;
revoke all on function public._coverage_conflict(uuid,uuid,timestamptz,timestamptz,uuid) from public,anon,authenticated,service_role;

create or replace function public.get_coverage_candidates(p_room uuid,p_date date,p_start time,p_end time)
returns table(profile_id uuid,full_name text,available boolean,reason text,needs_confirmation boolean)
language sql stable security definer set search_path=public as $$
  select c.profile_id,c.full_name,c.available and (not h.committed or h.safe),
    case when h.committed and not h.safe then 'Source-room forecast cannot safely lend this educator for the whole interval'
      when c.available and h.safe then 'Source room remains covered for the whole interval — forecast checked'
      else c.reason end,
    c.needs_confirmation and not h.committed
  from public._get_coverage_candidates_base(p_room,p_date,p_start,p_end) c
  join public.staff_members m on m.profile_id=c.profile_id and m.daycare_id=public.get_my_daycare_id()
  join public.daycares d on d.id=m.daycare_id
  cross join lateral(select
    exists(select 1 from public.profiles p where p.id=c.profile_id and p.classroom_id is not null and p.classroom_id<>p_room)
      or exists(select 1 from public.educator_classrooms e where e.educator_id=c.profile_id and e.classroom_id<>p_room)
      or exists(select 1 from public.staff_shifts s where s.staff_member_id=m.id and s.status='published' and s.classroom_id<>p_room and s.starts_at<(p_date+p_end) at time zone d.timezone and s.ends_at>(p_date+p_start) at time zone d.timezone) committed,
    public._can_lend_educator(m.id,p_room,(p_date+p_start) at time zone d.timezone,(p_date+p_end) at time zone d.timezone) safe) h;
$$;

-- Serialize competing planned loans before either computes spare staffing.
alter function public.assign_planned_room_coverage(uuid,uuid,date,time,time,boolean,text) rename to _assign_planned_room_coverage_checked;
revoke all on function public._assign_planned_room_coverage_checked(uuid,uuid,date,time,time,boolean,text) from public,anon,authenticated,service_role;
create function public.assign_planned_room_coverage(p_profile uuid,p_room uuid,p_date date,p_start time,p_end time,p_confirm boolean default false,p_notes text default null)
returns uuid language plpgsql security definer set search_path=public as $$
begin
  if not public.is_admin() or not public.has_permission('rooms','edit') then raise exception 'Room editing permission required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('coverage-plan:'||public.get_my_daycare_id()::text,0));
  return public._assign_planned_room_coverage_checked(p_profile,p_room,p_date,p_start,p_end,p_confirm,p_notes);
end $$;
revoke all on function public.assign_planned_room_coverage(uuid,uuid,date,time,time,boolean,text) from public,anon;
grant execute on function public.assign_planned_room_coverage(uuid,uuid,date,time,time,boolean,text) to authenticated;
