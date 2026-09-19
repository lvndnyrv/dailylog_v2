create function public._can_lend_existing_coverage(p_staff uuid,p_target uuid,p_start timestamptz,p_end timestamptz,p_assignment uuid)
returns boolean language plpgsql stable security definer set search_path=public set jit=off as $$
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
  if p_start<=now() and p_end>now() and not public._loan_live_source_safe(p_staff,source) then return false; end if;
  -- Pending moves in any shared partner room remain uncertain, too.
  if exists(
    select 1 from public.room_combinations combo join public.room_transition_plans t
      on t.daycare_id=combo.daycare_id and (t.from_classroom_id in(combo.source_classroom_id,combo.host_classroom_id)
        or t.to_classroom_id in(combo.source_classroom_id,combo.host_classroom_id))
    where combo.daycare_id=c.id and source in(combo.source_classroom_id,combo.host_classroom_id)
      and combo.enabled and combo.activated_at is not null and combo.paused_on is distinct from day
      and extract(isodow from day) between 1 and 5
      and (day+combo.starts_at) at time zone c.timezone<p_end
      and (day+combo.ends_at) at time zone c.timezone>p_start
      and t.status='planned' and t.move_on<=day
  ) then return false; end if;
  select classroom_id into home from public.profiles where id=(select profile_id from public.staff_members where id=p_staff);
  if home is not null and home<>source then return false; end if;
  if exists(select 1 from public.educator_classrooms e join public.staff_members m on m.profile_id=e.educator_id where m.id=p_staff and e.classroom_id<>source) then return false; end if;
  if exists(select 1 from public.staff_shifts s where s.staff_member_id=p_staff and s.status='published' and s.starts_at<p_end and s.ends_at>p_start and s.classroom_id is distinct from source) then return false; end if;
  if exists(select 1 from public.room_coverage_assignments a where a.staff_member_id=p_staff and a.id is distinct from p_assignment and a.status in ('assigned','accepted') and a.starts_at<p_end and a.ends_at>p_start) then return false; end if;
  return (select count(*)>0 and coalesce(bool_and(f.unknown_bookings=0 and f.uncertain_staff=0 and f.scheduled_staff>=f.required_staff
    and public._operating_room_id(p_target,greatest(f.starts_at,p_start))<>f.room_id),false)
    from public._room_demand_forecast(c.id,day,p_staff) f
    where f.room_id=public._operating_room_id(source,greatest(f.starts_at,p_start)) and f.starts_at<p_end and f.ends_at>p_start);
end $$;
revoke all on function public._can_lend_existing_coverage(uuid,uuid,timestamptz,timestamptz,uuid) from public,anon,authenticated,service_role;

-- Read-only reconciliation: never silently cancel an educator's commitment.
create function public.get_room_coverage_review(p_date date)
returns table(assignment_id uuid,room_id uuid,profile_id uuid,full_name text,starts_at timestamptz,ends_at timestamptz,status text,reason text)
language plpgsql stable security definer set search_path=public set jit=off as $$
declare c public.daycares; a record; conflict text; committed boolean;
begin
  if not public.is_admin() or not public.has_permission('rooms','view') then raise exception 'Room viewing permission required'; end if;
  select * into c from public.daycares where id=public.get_my_daycare_id();
  if p_date is null or p_date<(now() at time zone c.timezone)::date or p_date>(now() at time zone c.timezone)::date+90 then raise exception 'Choose a planning date in the next 90 days'; end if;
  for a in select x.*,p.id pid,p.full_name name,p.classroom_id home from public.room_coverage_assignments x
    join public.staff_members m on m.id=x.staff_member_id join public.profiles p on p.id=m.profile_id
    where x.daycare_id=c.id and x.status in('assigned','accepted','declined') and x.ends_at>now()
      and x.starts_at<(p_date+1)::timestamp at time zone c.timezone and x.ends_at>p_date::timestamp at time zone c.timezone
    order by x.starts_at,p.full_name loop
    conflict:=public._coverage_conflict_without_forecast(a.staff_member_id,a.classroom_id,a.starts_at,a.ends_at,a.id);
    committed:=(a.home is not null and a.home<>a.classroom_id) or exists(select 1 from public.educator_classrooms e where e.educator_id=a.pid and e.classroom_id<>a.classroom_id)
      or exists(select 1 from public.staff_shifts s where s.staff_member_id=a.staff_member_id and s.status='published' and s.classroom_id<>a.classroom_id and s.starts_at<a.ends_at and s.ends_at>a.starts_at);
    if a.status='declined' then conflict:='Educator declined — arrange replacement coverage';
    elsif exists(select 1 from public.center_closures cl where cl.daycare_id=c.id and p_date between cl.starts_on and cl.ends_on) then conflict:='Center closure now overlaps this plan';
    elsif (a.starts_at at time zone c.timezone)::time<c.opens_at or (a.ends_at at time zone c.timezone)::time>c.closes_at then conflict:='Coverage is outside current opening hours';
    elsif not public._forecast_staff_eligible(a.staff_member_id,p_date) then conflict:='Educator eligibility or approved leave changed — review coverage';
    elsif conflict is null or conflict like 'Published shift in another room%' then
      if committed then
        if public._can_lend_existing_coverage(a.staff_member_id,a.classroom_id,a.starts_at,a.ends_at,a.id) then conflict:=null;
        else conflict:='Source room can no longer safely lend this educator for the whole interval'; end if;
      elsif not exists(select 1 from public.staff_shifts s where s.staff_member_id=a.staff_member_id and s.status='published' and s.starts_at<=a.starts_at and s.ends_at>=a.ends_at) then
        conflict:='No published shift covers this interval — reconfirm availability';
      elsif exists(select 1 from public.staff_shifts s where s.staff_member_id=a.staff_member_id and s.status='published' and s.starts_at<a.ends_at and s.ends_at>a.starts_at and s.unpaid_break_minutes>0
        and (s.planned_break_starts_at is null or extract(epoch from(s.planned_break_ends_at-s.planned_break_starts_at))/60<s.unpaid_break_minutes)) then
        conflict:='Untimed break — reconfirm availability for this interval';
      end if;
    end if;
    assignment_id:=a.id; room_id:=a.classroom_id; profile_id:=a.pid; full_name:=a.name; starts_at:=a.starts_at; ends_at:=a.ends_at; status:=a.status; reason:=conflict;
    return next;
  end loop;
end $$;
revoke all on function public.get_room_coverage_review(date) from public,anon;
grant execute on function public.get_room_coverage_review(date) to authenticated;
