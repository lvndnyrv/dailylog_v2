-- 7e: durable plan visibility and conservative dated enrollment projections.
create or replace function public.get_room_transitions(p_horizon_months int default 2)
returns table(child_id uuid,first_name text,last_name text,date_of_birth date,age_months int,
  room_id uuid,room_name text,max_age_months int,next_room_id uuid,next_room_name text)
language sql security definer stable set search_path=public as $$
  select c.id,c.first_name,c.last_name,c.date_of_birth,
    (extract(year from age(public.center_today(),c.date_of_birth))*12+extract(month from age(public.center_today(),c.date_of_birth)))::int,
    coalesce(plan.from_classroom_id,cl.id),coalesce(source.name,cl.name),cl.max_age_months,
    coalesce(plan.to_classroom_id,nxt.id),coalesce(destination.name,nxt.name)
  from public.children c join public.classrooms cl on cl.id=c.classroom_id
  left join public.room_transition_plans plan on plan.child_id=c.id and plan.status='planned'
  left join public.classrooms source on source.id=plan.from_classroom_id
  left join public.classrooms destination on destination.id=plan.to_classroom_id
  left join lateral(select n.id,n.name from public.classrooms n where n.daycare_id=c.daycare_id
    and n.archived_at is null and n.id<>cl.id and n.min_age_months>=cl.max_age_months
    order by n.min_age_months,n.name,n.id limit 1) nxt on true
  where c.daycare_id=public.get_my_daycare_id() and public.is_staff() and c.archived_at is null
    and (plan.id is not null or (cl.max_age_months is not null and c.date_of_birth is not null
      and c.date_of_birth + make_interval(months=>cl.max_age_months)
        <= public.center_today()+make_interval(months=>greatest(0,least(coalesce(p_horizon_months,2),12)))))
  order by plan.move_on nulls last,c.date_of_birth,c.id;
$$;

create function public._room_transition_capacity(p_room uuid,p_child uuid,p_date date)
returns table(projected_children integer,offer_holds integer,dependent_moves integer)
language sql stable security definer set search_path=public as $$
  with occupants as (
    select c.id,c.classroom_id,coalesce(t.to_classroom_id,c.classroom_id) effective_room,t.id move_id
    from public.children c
    left join public.room_transition_plans t on t.child_id=c.id and t.status='planned'
      and t.from_classroom_id=c.classroom_id and t.move_on<=p_date
    where c.daycare_id=(select daycare_id from public.classrooms where id=p_room)
      and c.archived_at is null and c.id<>p_child and coalesce(c.enrolled_on,'-infinity'::date)<=p_date
      and not exists(select 1 from public.child_departures d where d.child_id=c.id
        and d.status in ('scheduled','completed') and d.last_day<p_date)
  ), holds as (
    select count(*)::integer n from public.enrollments e where e.classroom_id=p_room
      and e.child_id is null and coalesce(e.desired_start_date,'-infinity'::date)<=p_date
      and (e.stage='enrolled' or (e.stage='offer' and (e.offer_status='accepted' or
        (e.offer_status in ('sent','viewed') and (e.offer_expires_at is null or e.offer_expires_at>now())))))
  )
  select (count(*) filter(where effective_room=p_room))::integer+holds.n, holds.n,
    (count(*) filter(where move_id is not null and p_room in(classroom_id,effective_room)))::integer
  from holds left join occupants on true group by holds.n;
$$;
revoke all on function public._room_transition_capacity(uuid,uuid,date) from public,anon,authenticated;

create function public.preview_room_transition(p_child_id uuid,p_room_id uuid,p_from date)
returns table(day date,projected_children integer,capacity integer,offer_holds integer,dependent_moves integer,available boolean,reason text)
language plpgsql stable security definer set search_path=public as $$
declare child public.children; room public.classrooms;
begin
  if auth.uid() is null or not public.is_admin() or not public.has_permission('children','view') then raise exception 'Administrator children-view permission required'; end if;
  select * into child from public.children where id=p_child_id and daycare_id=public.get_my_daycare_id() and archived_at is null;
  select * into room from public.classrooms where id=p_room_id and daycare_id=public.get_my_daycare_id() and archived_at is null;
  if child.id is null or room.id is null or room.id=child.classroom_id then raise exception 'Choose an active child and a different destination in your center'; end if;
  if p_from is null or p_from<public.center_today() or p_from>public.center_today()+365 then raise exception 'Choose a date within the next year'; end if;
  return query
  select d.day,c.projected_children,room.capacity,c.offer_holds,c.dependent_moves,r.reason is null,r.reason
  from (select p_from+i as day from generate_series(0,least(90,public.center_today()+365-p_from)) i) d
  cross join lateral public._room_transition_capacity(room.id,child.id,d.day) c
  cross join lateral (select case
    when room.opens_on>d.day then 'Room has not opened yet'
    when extract(isodow from d.day)>5 or exists(select 1 from public.center_closures cl where cl.daycare_id=room.daycare_id and d.day between cl.starts_on and cl.ends_on) then 'Center closed'
    when room.capacity is null or room.capacity<1 then 'Set a room capacity first'
    when child.date_of_birth is null or room.min_age_months is null or room.max_age_months is null then 'Age-band details need review'
    when d.day < (child.date_of_birth+make_interval(months=>room.min_age_months))::date
      or d.day >= (child.date_of_birth+make_interval(months=>room.max_age_months))::date then 'Outside destination age band'
    when c.projected_children>=room.capacity then 'No projected space'
    else null end reason) r;
end; $$;
revoke all on function public.preview_room_transition(uuid,uuid,date) from public,anon;
grant execute on function public.preview_room_transition(uuid,uuid,date) to authenticated;

create function public.save_room_transition_plan(p_settings jsonb,p_plan_id uuid default null,p_expected_updated_at timestamptz default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare
  child public.children; room public.classrooms; plan public.room_transition_plans;
  center uuid:=public.get_my_daycare_id(); result uuid; move_day date; visits boolean;
  visit_start date; visit_end date; projection record;
begin
  if auth.uid() is null or not public.is_admin() or not public.has_permission('children','edit') then raise exception 'Administrator children-edit permission required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(center::text,0));
  select * into child from public.children where id=(p_settings->>'child_id')::uuid and daycare_id=center and archived_at is null for update;
  if child.id is null or child.classroom_id is distinct from (p_settings->>'from_room_id')::uuid then raise exception 'The child is no longer in the starting room'; end if;
  if p_plan_id is not null then
    select * into plan from public.room_transition_plans where id=p_plan_id and child_id=child.id and daycare_id=center for update;
    if plan.id is null or plan.status<>'planned' then raise exception 'This plan is no longer available'; end if;
    if p_expected_updated_at is null or plan.updated_at is distinct from p_expected_updated_at then raise exception 'This plan changed. Close and reopen it before saving'; end if;
  elsif exists(select 1 from public.room_transition_plans where child_id=child.id and status='planned') then
    raise exception 'This child already has a plan. Close and reopen it before editing';
  end if;
  move_day:=(p_settings->>'move_on')::date;
  select * into room from public.classrooms where id=(p_settings->>'to_room_id')::uuid and daycare_id=center and archived_at is null for update;
  if room.id is null then raise exception 'Destination room is unavailable'; end if;
  select * into projection from public.preview_room_transition(child.id,room.id,move_day) limit 1;
  if projection.available is not true then raise exception '% — choose another move day or destination',coalesce(projection.reason,'Capacity could not be checked'); end if;
  visits:=coalesce((p_settings->>'transition_week')::boolean,false);
  if visits then
    visit_start:=(p_settings->>'transition_starts_on')::date;
    visit_end:=(p_settings->>'transition_ends_on')::date;
    if visit_start is null or visit_end is null or visit_start>visit_end or visit_end>=move_day then raise exception 'Transition visits must end before move day'; end if;
    if visit_start<public.center_today() or visit_start<room.opens_on then raise exception 'Transition visits cannot begin in the past or before the room opens'; end if;
    if exists(select 1 from public.center_closures c where c.daycare_id=center and c.starts_on<=visit_end and c.ends_on>=visit_start) then raise exception 'Transition visits overlap a center closure'; end if;
  end if;
  if length(coalesce(p_settings->>'family_message',''))>2000 or length(coalesce(p_settings->>'notes',''))>2000 then raise exception 'Messages and notes must be at most 2000 characters'; end if;
  if p_plan_id is null then
    insert into public.room_transition_plans(daycare_id,child_id,from_classroom_id,to_classroom_id,move_on,transition_week,
      transition_starts_on,transition_ends_on,current_tuition_cents,new_tuition_cents,currency,family_message,notes,family_visible,published_at)
    values(center,child.id,child.classroom_id,room.id,move_day,visits,visit_start,visit_end,
      (p_settings->>'current_tuition_cents')::integer,(p_settings->>'new_tuition_cents')::integer,'CAD',
      nullif(btrim(p_settings->>'family_message'),''),nullif(btrim(p_settings->>'notes'),''),true,now()) returning id into result;
  else
    update public.room_transition_plans set to_classroom_id=room.id,move_on=move_day,transition_week=visits,
      transition_starts_on=visit_start,transition_ends_on=visit_end,
      current_tuition_cents=(p_settings->>'current_tuition_cents')::integer,new_tuition_cents=(p_settings->>'new_tuition_cents')::integer,
      family_message=nullif(btrim(p_settings->>'family_message'),''),notes=nullif(btrim(p_settings->>'notes'),'')
      where id=p_plan_id returning id into result;
  end if;
  return result;
end; $$;
revoke all on function public.save_room_transition_plan(jsonb,uuid,timestamptz) from public,anon;
grant execute on function public.save_room_transition_plan(jsonb,uuid,timestamptz) to authenticated;

create function public.cancel_room_transition_plan(p_plan_id uuid,p_expected_updated_at timestamptz)
returns void language plpgsql security definer set search_path=public as $$
declare plan public.room_transition_plans;
begin
  if auth.uid() is null or not public.is_admin() or not public.has_permission('children','edit') then raise exception 'Administrator children-edit permission required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(public.get_my_daycare_id()::text,0));
  select * into plan from public.room_transition_plans where id=p_plan_id and daycare_id=public.get_my_daycare_id() for update;
  if plan.id is null then raise exception 'Plan not found'; end if;
  if plan.status='cancelled' then return; end if;
  if plan.status<>'planned' then raise exception 'Only a planned move can be cancelled'; end if;
  if p_expected_updated_at is null or plan.updated_at is distinct from p_expected_updated_at then raise exception 'This plan changed. Close and reopen it before cancelling'; end if;
  update public.room_transition_plans set status='cancelled' where id=plan.id;
end; $$;
revoke all on function public.cancel_room_transition_plan(uuid,timestamptz) from public,anon;
grant execute on function public.cancel_room_transition_plan(uuid,timestamptz) to authenticated;

-- Preserve established move/access/family-notice behavior and add reviewed-save safety.
create function public.complete_reviewed_room_transition(p_plan_id uuid,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
declare plan public.room_transition_plans; today date:=public.center_today(); host uuid; source uuid;
  snapshot record; host_capacity integer; child_room uuid;
begin
  if auth.uid() is null or not public.is_admin() or not public.has_permission('children','edit') then raise exception 'Administrator children-edit permission required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(public.get_my_daycare_id()::text,0));
  select * into plan from public.room_transition_plans where id=p_plan_id and daycare_id=public.get_my_daycare_id() for update;
  if plan.id is null then raise exception 'Plan not found'; end if;
  if plan.status='completed' then return public.complete_room_transition_plan(plan.id); end if;
  if p_expected_updated_at is null or plan.updated_at is distinct from p_expected_updated_at then raise exception 'This plan changed. Close and reopen it before completing'; end if;
  if extract(isodow from today)>5 or exists(select 1 from public.center_closures where daycare_id=plan.daycare_id and today between starts_on and ends_on) then raise exception 'Complete this move on an open center day'; end if;
  select classroom_id into child_room from public.children where id=plan.child_id for update;
  host:=public._operating_room_id(plan.to_classroom_id); source:=public._operating_room_id(child_room);
  select capacity into host_capacity from public.classrooms where id=host for update;
  if host_capacity is null or host_capacity<1 then raise exception 'Set the destination capacity before completing'; end if;
  if exists(select 1 from public.attendance_records where child_id=plan.child_id and date=today
    and checked_in_at is not null and checked_out_at is null and status in ('present','late')) then
    select * into snapshot from public._room_ratio_snapshot(host);
    if snapshot.max_children_per_staff is null or snapshot.max_children_per_staff<1 then raise exception 'Set the destination ratio before completing'; end if;
    if snapshot.present_count+(case when source=host then 0 else 1 end)>host_capacity then raise exception 'The operating destination room is at capacity'; end if;
  end if;
  return public.complete_room_transition_plan(plan.id);
end; $$;
revoke all on function public.complete_reviewed_room_transition(uuid,timestamptz) from public,anon;
grant execute on function public.complete_reviewed_room_transition(uuid,timestamptz) to authenticated;
