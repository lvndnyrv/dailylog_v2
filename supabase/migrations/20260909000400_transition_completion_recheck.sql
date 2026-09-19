-- Recheck configured age bands and known offer holds at actual completion time.
create or replace function public.complete_reviewed_room_transition(p_plan_id uuid,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
declare plan public.room_transition_plans; today date:=public.center_today(); host uuid; source uuid;
  snapshot record; host_capacity integer; child_room uuid; projection record;
begin
  if auth.uid() is null or not public.is_admin() or not public.has_permission('children','edit') then raise exception 'Administrator children-edit permission required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(public.get_my_daycare_id()::text,0));
  select * into plan from public.room_transition_plans where id=p_plan_id and daycare_id=public.get_my_daycare_id() for update;
  if plan.id is null then raise exception 'Plan not found'; end if;
  if plan.status='completed' then return public.complete_room_transition_plan(plan.id); end if;
  if p_expected_updated_at is null or plan.updated_at is distinct from p_expected_updated_at then raise exception 'This plan changed. Close and reopen it before completing'; end if;
  if extract(isodow from today)>5 or exists(select 1 from public.center_closures where daycare_id=plan.daycare_id and today between starts_on and ends_on) then raise exception 'Complete this move on an open center day'; end if;
  select classroom_id into child_room from public.children where id=plan.child_id for update;
  select * into projection from public.preview_room_transition(plan.child_id,plan.to_classroom_id,today) limit 1;
  if projection.available is not true then raise exception '% — review this plan before completing',coalesce(projection.reason,'Capacity could not be checked'); end if;
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
