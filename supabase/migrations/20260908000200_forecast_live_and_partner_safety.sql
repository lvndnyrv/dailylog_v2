-- Planning must not override higher actual attendance when lending immediately.
create function public._loan_live_source_safe(p_staff uuid,p_source uuid)
returns boolean language sql stable security definer set search_path=public set jit=off as $$
  select coalesce((
    select snapshot.staff_count - case when exists(
      select 1 from public._room_staff_presence(m.daycare_id) presence
      where presence.staff_member_id=p_staff
        and public._operating_room_id(presence.effective_classroom_id)=public._operating_room_id(p_source)
    ) then 1 else 0 end >= snapshot.required_staff
    from public.staff_members m join public.classrooms r on r.id=p_source and r.daycare_id=m.daycare_id
    cross join lateral public._room_ratio_snapshot(public._operating_room_id(p_source)) snapshot
    where m.id=p_staff
  ),false);
$$;
revoke all on function public._loan_live_source_safe(uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public._forecast_staff_eligible(p_staff uuid,p_date date)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.staff_members m join public.profiles p on p.id=m.profile_id
    where m.id=p_staff and p.daycare_id=m.daycare_id and m.status='active' and m.archived_at is null and p.role='educator' and p.archived_at is null
    and (not m.background_check_required or exists(select 1 from public.staff_credentials cr where cr.staff_member_id=m.id and cr.archived_at is null and cr.required
      and lower(cr.name)~'(background|criminal record|vulnerable sector)' and cr.completed_on<=p_date and cr.document_id is not null and (cr.expires_on is null or cr.expires_on>=p_date)))
    and not exists(select 1 from public.staff_time_off_requests a where a.staff_member_id=m.id and a.status='approved' and p_date between a.starts_on and a.ends_on));
$$;

create or replace function public._can_lend_educator(p_staff uuid,p_target uuid,p_start timestamptz,p_end timestamptz)
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
  if exists(select 1 from public.room_coverage_assignments a where a.staff_member_id=p_staff and a.status in ('assigned','accepted') and a.starts_at<p_end and a.ends_at>p_start) then return false; end if;
  return (select count(*)>0 and coalesce(bool_and(f.unknown_bookings=0 and f.uncertain_staff=0 and f.scheduled_staff>=f.required_staff
    and public._operating_room_id(p_target,greatest(f.starts_at,p_start))<>f.room_id),false)
    from public._room_demand_forecast(c.id,day,p_staff) f
    where f.room_id=public._operating_room_id(source,greatest(f.starts_at,p_start)) and f.starts_at<p_end and f.ends_at>p_start);
end $$;
