-- Parent Group 27 completion flow: completing a published room move must update
-- the real child assignment and the family-visible plan in one transaction.

create or replace function public.complete_room_transition_plan(p_plan_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan public.room_transition_plans%rowtype;
  v_child public.children%rowtype;
  v_to_room text;
begin
  if auth.uid() is null or not public.has_permission('children', 'edit') then
    raise exception 'Children edit permission required';
  end if;

  select * into v_plan
  from public.room_transition_plans
  where id = p_plan_id
  for update;

  if v_plan.id is null
     or v_plan.daycare_id <> public.get_my_daycare_id() then
    raise exception 'Room transition plan not found';
  end if;

  select * into v_child
  from public.children
  where id = v_plan.child_id
  for update;

  if v_plan.status = 'completed' then
    return jsonb_build_object(
      'plan_id', v_plan.id,
      'child_id', v_plan.child_id,
      'classroom_id', v_child.classroom_id,
      'status', v_plan.status
    );
  end if;
  if v_plan.status <> 'planned' then
    raise exception 'Only a planned room transition can be completed';
  end if;
  if v_child.archived_at is not null then
    raise exception 'An archived child cannot be moved';
  end if;
  if v_child.classroom_id is distinct from v_plan.from_classroom_id then
    raise exception 'The child is no longer assigned to the plan''s starting room';
  end if;

  update public.children
  set classroom_id = v_plan.to_classroom_id
  where id = v_plan.child_id;

  update public.room_transition_plans
  set status = 'completed'
  where id = v_plan.id;

  select name into v_to_room
  from public.classrooms
  where id = v_plan.to_classroom_id;

  perform public.queue_parent_schedule_notice(
    v_plan.daycare_id,
    v_plan.child_id,
    v_child.first_name || '''s room move is complete',
    v_child.first_name || ' is now assigned to ' || coalesce(v_to_room, 'the new room') || '.',
    jsonb_build_object(
      'type', 'room_move',
      'screen', 'ParentRoomMove',
      'childId', v_plan.child_id,
      'transitionId', v_plan.id
    ),
    'room-move:' || v_plan.id || ':completed',
    now(),
    true
  );

  return jsonb_build_object(
    'plan_id', v_plan.id,
    'child_id', v_plan.child_id,
    'classroom_id', v_plan.to_classroom_id,
    'status', 'completed'
  );
end;
$$;

revoke all on function public.complete_room_transition_plan(uuid)
  from public, anon;
grant execute on function public.complete_room_transition_plan(uuid)
  to authenticated;
