-- Persistent room-transition waiting requests; all fixtures roll back.
begin;

create function pg_temp.impersonate(p_role text, p_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('role', p_role, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_id, 'role', p_role)::text,
    true
  );
end;
$$;

do $$
declare
  center uuid := '10000000-0000-4000-a000-000000000001';
  owner_id uuid := '00000000-0000-4000-a000-000000000001';
  parent_id uuid := gen_random_uuid();
  source uuid;
  target uuid;
  candidate_child uuid;
  other_child uuid;
  occupant uuid;
  wait_id uuid;
  other_wait_id uuid;
  wait_version timestamptz;
  other_version timestamptz;
  first_day date;
  plan_id uuid;
  notice_count integer;
begin
  perform pg_temp.impersonate('postgres', owner_id);
  insert into public.classrooms(
    daycare_id, name, min_age_months, max_age_months, capacity,
    ratio_children_per_educator
  ) values (
    center, 'Rollback wait source', 0, 120, 10, 4
  ) returning id into source;
  insert into public.classrooms(
    daycare_id, name, min_age_months, max_age_months, capacity,
    ratio_children_per_educator
  ) values (
    center, 'Rollback wait destination', 36, 72, 1, 4
  ) returning id into target;
  insert into public.children(
    daycare_id, classroom_id, first_name, last_name, date_of_birth
  ) values (
    center, source, 'Waiting', 'Candidate', public.center_today() - interval '4 years'
  ) returning id into candidate_child;
  insert into public.children(
    daycare_id, classroom_id, first_name, last_name, date_of_birth
  ) values (
    center, source, 'Waiting', 'Other', public.center_today() - interval '4 years'
  ) returning id into other_child;
  insert into public.children(
    daycare_id, classroom_id, first_name, last_name, date_of_birth
  ) values (
    center, target, 'Waiting', 'Occupant', public.center_today() - interval '4 years'
  ) returning id into occupant;
  insert into auth.users(
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    parent_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated', 'wait-' || parent_id || '@dailylog.invalid', '', now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Rollback Waiting Parent"}', now(), now()
  );
  update public.profiles set role = 'parent', daycare_id = center where id = parent_id;
  insert into public.parent_children(parent_id, child_id, relationship, is_primary)
    values(parent_id, candidate_child, 'Parent', true);

  perform pg_temp.impersonate('authenticated', owner_id);
  wait_id := public.save_room_transition_wait_request(jsonb_build_object(
    'child_id', candidate_child,
    'from_room_id', source,
    'to_room_id', target,
    'not_before', public.center_today(),
    'notes', 'Wait until the destination has a safe opening'
  ));
  select updated_at into wait_version
  from public.room_transition_wait_requests where id = wait_id;

  if not exists (
    select 1 from public.get_room_transition_wait_requests()
    where id = wait_id and first_available_day is null
      and status_detail = 'No safe opening is projected in the next year'
  ) then
    raise exception 'FAIL: full-room request was not persisted as waiting';
  end if;
  if exists (
    select 1 from public.get_room_transitions(3) transition
    where transition.child_id = candidate_child
  ) then
    raise exception 'FAIL: rollback fixture unexpectedly became a birthday candidate';
  end if;
  if exists (
    select 1 from public.notifications
    where profile_id = parent_id and payload->>'type' = 'room_move'
  ) then
    raise exception 'FAIL: staff-only waiting request notified family';
  end if;
  begin
    perform public.save_room_transition_wait_request(
      jsonb_build_object(
        'child_id', candidate_child, 'from_room_id', source, 'to_room_id', target,
        'not_before', public.center_today(), 'notes', 'stale edit'
      ),
      wait_id,
      wait_version - interval '1 second'
    );
    raise exception 'FAIL: stale waiting request edit accepted';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  perform pg_temp.impersonate('authenticated', parent_id);
  if exists(select 1 from public.get_room_transition_wait_requests()) then
    raise exception 'FAIL: parent can see staff waiting queue';
  end if;
  begin
    perform public.cancel_room_transition_wait_request(wait_id, wait_version);
    raise exception 'FAIL: parent cancelled staff waiting request';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  perform pg_temp.impersonate('postgres', owner_id);
  update public.children set archived_at = now() where id = occupant;
  perform pg_temp.impersonate('authenticated', owner_id);
  select first_available_day into first_day
  from public.get_room_transition_wait_requests() where id = wait_id;
  if first_day is null then
    raise exception 'FAIL: opening was not recomputed after capacity changed';
  end if;

  plan_id := public.convert_room_transition_wait_to_plan(
    wait_id,
    wait_version,
    jsonb_build_object(
      'child_id', candidate_child,
      'from_room_id', source,
      'to_room_id', target,
      'move_on', first_day,
      'transition_week', false,
      'new_tuition_cents', 105000,
      'family_message', 'A safe move date is now available.'
    )
  );
  if not exists (
    select 1 from public.room_transition_wait_requests
    where id = wait_id and status = 'planned' and converted_plan_id = plan_id
  ) then
    raise exception 'FAIL: reviewed request was not linked to its plan';
  end if;
  if exists(select 1 from public.get_room_transition_wait_requests() where id = wait_id) then
    raise exception 'FAIL: converted request remained in active queue';
  end if;
  perform pg_temp.impersonate('authenticated', parent_id);
  select count(*) into notice_count from public.notifications
  where profile_id = parent_id and payload->>'type' = 'room_move';
  if notice_count <> 1 then
    raise exception 'FAIL: conversion did not publish exactly one family plan notice';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(public.get_parent_schedule_hub()->'room_moves') move
    where move->>'id' = plan_id::text
  ) then
    raise exception 'FAIL: parent cannot see converted room move';
  end if;

  perform pg_temp.impersonate('postgres', owner_id);
  update public.classrooms set capacity = 2 where id = target;
  perform pg_temp.impersonate('authenticated', owner_id);
  other_wait_id := public.save_room_transition_wait_request(jsonb_build_object(
    'child_id', other_child,
    'from_room_id', source,
    'to_room_id', target,
    'not_before', public.center_today()
  ));
  select updated_at into other_version
  from public.room_transition_wait_requests where id = other_wait_id;
  perform public.cancel_room_transition_wait_request(other_wait_id, other_version);
  perform public.cancel_room_transition_wait_request(other_wait_id, other_version);
  if exists(select 1 from public.get_room_transition_wait_requests() where id = other_wait_id) then
    raise exception 'FAIL: cancelled request remained in active queue';
  end if;
end;
$$;

rollback;
select 'PASS: persistent room waiting queue, projected openings, permissions, stale edits, conversion, family handoff, and cancellation; rolled back' as result;
