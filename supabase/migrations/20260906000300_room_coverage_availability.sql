-- Group 7a/7c: interval-aware availability and explicitly timed planned breaks.
-- A payroll break duration alone does not tell us when an educator is away.
alter table public.staff_shifts
  add column planned_break_starts_at timestamptz,
  add column planned_break_ends_at timestamptz,
  add constraint staff_shift_planned_break_bounds check (
    (planned_break_starts_at is null and planned_break_ends_at is null) or
    (planned_break_starts_at is not null and planned_break_ends_at is not null
      and planned_break_starts_at >= starts_at and planned_break_ends_at <= ends_at
      and planned_break_starts_at < planned_break_ends_at)
  );

create function public._coverage_conflict(p_staff uuid,p_room uuid,p_start timestamptz,p_end timestamptz,p_exclude uuid default null)
returns text language plpgsql stable security definer set search_path=public as $$
declare m public.staff_members; c public.daycares; r public.classrooms; d date;
begin
  select * into m from public.staff_members where id=p_staff;
  select * into r from public.classrooms where id=p_room;
  if m.id is null or r.id is null or m.daycare_id<>r.daycare_id or r.archived_at is not null then return 'Choose an educator and active room in this center'; end if;
  select * into c from public.daycares where id=m.daycare_id;
  d := (p_start at time zone c.timezone)::date;
  if p_start is null or p_end is null or p_end<=p_start or p_end-p_start>interval '24 hours' then return 'Choose a valid coverage interval'; end if;
  if m.status<>'active' or m.archived_at is not null or not exists(select 1 from public.profiles where id=m.profile_id and role='educator' and archived_at is null and daycare_id=m.daycare_id) then return 'Educator is not active'; end if;
  if not public.staff_is_ratio_eligible(m.id) then return 'Required background clearance is pending'; end if;
  if r.opens_on is not null and d<r.opens_on then return 'This room has not opened yet'; end if;
  if exists(select 1 from public.staff_time_off_requests a where a.staff_member_id=m.id and a.status='approved'
    and a.starts_on <= ((p_end-interval '1 microsecond') at time zone c.timezone)::date and a.ends_on>=d) then return 'Approved time off overlaps this interval'; end if;
  if exists(select 1 from public.room_coverage_assignments a where a.staff_member_id=m.id and a.id is distinct from p_exclude
    and a.status in ('assigned','accepted') and a.starts_at<p_end and a.ends_at>p_start) then return 'Already assigned to room coverage during this interval'; end if;
  if exists(select 1 from public.staff_shifts s where s.staff_member_id=m.id and s.status='published'
    and s.planned_break_starts_at<p_end and s.planned_break_ends_at>p_start) then return 'A planned break overlaps this interval'; end if;
  if exists(select 1 from public.staff_shifts s where s.staff_member_id=m.id and s.status='published'
    and s.starts_at<p_end and s.ends_at>p_start and s.classroom_id is not null and s.classroom_id<>p_room) then
    return 'Published shift in another room overlaps; adjust that shift before assigning coverage'; end if;
  return null;
end $$;
revoke all on function public._coverage_conflict(uuid,uuid,timestamptz,timestamptz,uuid) from public,anon,authenticated,service_role;

create function public.get_coverage_candidates(p_room uuid,p_date date,p_start time,p_end time)
returns table(profile_id uuid,full_name text,available boolean,reason text,needs_confirmation boolean)
language plpgsql stable security definer set search_path=public as $$
declare c public.daycares; a timestamptz; b timestamptz;
begin
  if not public.is_admin() or not public.has_permission('rooms','view') then raise exception 'Administrator room access required'; end if;
  select * into c from public.daycares where id=public.get_my_daycare_id();
  if not exists(select 1 from public.classrooms where id=p_room and daycare_id=c.id and archived_at is null) then raise exception 'Room unavailable'; end if;
  if p_date is null or p_start is null or p_end is null or p_end<=p_start then raise exception 'Choose a date and an end time after the start'; end if;
  a := (p_date+p_start) at time zone c.timezone; b := (p_date+p_end) at time zone c.timezone;
  return query select p.id,p.full_name,x.conflict is null,
    coalesce(x.conflict,case when not x.has_shift then 'No published shift covers the whole interval — confirm availability'
      when x.untimed_break then 'Shift has an untimed break — confirm this interval is outside it'
      else 'Available for this interval' end),
    x.conflict is null and (not x.has_shift or x.untimed_break)
  from public.staff_members m join public.profiles p on p.id=m.profile_id
  cross join lateral (select public._coverage_conflict(m.id,p_room,a,b) conflict,
    exists(select 1 from public.staff_shifts s where s.staff_member_id=m.id and s.status='published' and s.starts_at<=a and s.ends_at>=b) has_shift,
    exists(select 1 from public.staff_shifts s where s.staff_member_id=m.id and s.status='published' and s.starts_at<b and s.ends_at>a and s.unpaid_break_minutes>0 and s.planned_break_starts_at is null) untimed_break) x
  where m.daycare_id=c.id and m.archived_at is null and p.archived_at is null and p.role='educator'
  order by (x.conflict is null) desc,p.full_name;
end $$;
revoke all on function public.get_coverage_candidates(uuid,date,time,time) from public,anon;
grant execute on function public.get_coverage_candidates(uuid,date,time,time) to authenticated;

create function public.assign_planned_room_coverage(p_profile uuid,p_room uuid,p_date date,p_start time,p_end time,p_confirm boolean default false,p_notes text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare c public.daycares; m uuid; a timestamptz; b timestamptz; candidate record; result uuid;
begin
  if not public.is_admin() or not public.has_permission('rooms','edit') then raise exception 'Administrator room editing permission required'; end if;
  select * into c from public.daycares where id=public.get_my_daycare_id();
  select id into m from public.staff_members where profile_id=p_profile and daycare_id=c.id and archived_at is null;
  if m is null then raise exception 'Educator unavailable'; end if;
  perform pg_advisory_xact_lock(hashtextextended(m::text,0));
  select * into candidate from public.get_coverage_candidates(p_room,p_date,p_start,p_end) where profile_id=p_profile;
  if not found then raise exception 'Educator unavailable'; end if;
  if not candidate.available then raise exception '%',candidate.reason; end if;
  if candidate.needs_confirmation and not coalesce(p_confirm,false) then raise exception 'Confirm educator availability and break timing before assigning'; end if;
  if p_start<c.opens_at or p_end>c.closes_at then raise exception 'Coverage must fall within center opening hours'; end if;
  if exists(select 1 from public.center_closures where daycare_id=c.id and p_date between starts_on and ends_on) then raise exception 'The center is closed on this date'; end if;
  a := (p_date+p_start) at time zone c.timezone; b := (p_date+p_end) at time zone c.timezone;
  if b<=now() then raise exception 'Coverage must end in the future'; end if;
  insert into public.room_coverage_assignments(daycare_id,classroom_id,staff_member_id,starts_at,ends_at,status,notes)
    values(c.id,p_room,m,a,b,'assigned',concat_ws(E'\n',nullif(trim(p_notes),''),case when candidate.needs_confirmation then 'Admin confirmed availability and break timing.' end)) returning id into result;
  return result;
end $$;
revoke all on function public.assign_planned_room_coverage(uuid,uuid,date,time,time,boolean,text) from public,anon;
grant execute on function public.assign_planned_room_coverage(uuid,uuid,date,time,time,boolean,text) to authenticated;

-- Applies to all clients, including direct inserts; preserve the existing
-- same-center/active-staff/overlapping-coverage integrity trigger as well.
create function public.guard_coverage_availability() returns trigger language plpgsql security definer set search_path=public as $$
declare conflict text;
begin
  if new.status not in ('assigned','accepted') then return new; end if;
  -- Status acknowledgements and note edits do not re-plan an existing interval.
  if tg_op='UPDATE' and old.staff_member_id=new.staff_member_id and old.classroom_id=new.classroom_id
    and old.starts_at=new.starts_at and old.ends_at=new.ends_at and old.status in ('assigned','accepted') then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.staff_member_id::text,0));
  conflict := public._coverage_conflict(new.staff_member_id,new.classroom_id,new.starts_at,new.ends_at,new.id);
  if conflict is not null then raise exception using errcode='23514',message=conflict; end if;
  return new;
end $$;
create trigger guard_coverage_availability before insert or update on public.room_coverage_assignments
  for each row execute function public.guard_coverage_availability();

create function public.guard_planned_shift_break() returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.staff_member_id::text,0));
  if new.status='published' and new.planned_break_starts_at is not null and exists(
    select 1 from public.room_coverage_assignments a where a.staff_member_id=new.staff_member_id
      and a.status in ('assigned','accepted') and a.starts_at<new.planned_break_ends_at and a.ends_at>new.planned_break_starts_at
  ) then raise exception 'Planned break overlaps assigned coverage; resolve coverage first'; end if;
  return new;
end $$;
create trigger guard_planned_shift_break before insert or update on public.staff_shifts
  for each row execute function public.guard_planned_shift_break();

create function public.set_planned_shift_break(p_shift uuid,p_start time default null,p_end time default null)
returns void language plpgsql security definer set search_path=public as $$
declare s public.staff_shifts; z text; d date;
begin
  if not public.is_admin() or not public.has_permission('rooms','edit') then raise exception 'Administrator room editing permission required'; end if;
  select * into s from public.staff_shifts where id=p_shift and daycare_id=public.get_my_daycare_id() for update;
  if not found or s.status<>'published' then raise exception 'Published shift unavailable'; end if;
  select timezone into z from public.daycares where id=s.daycare_id;
  d := (s.starts_at at time zone z)::date;
  update public.staff_shifts set planned_break_starts_at=(d+p_start) at time zone z,
    planned_break_ends_at=(d+p_end) at time zone z where id=s.id;
end $$;
revoke all on function public.set_planned_shift_break(uuid,time,time) from public,anon;
grant execute on function public.set_planned_shift_break(uuid,time,time) to authenticated;
