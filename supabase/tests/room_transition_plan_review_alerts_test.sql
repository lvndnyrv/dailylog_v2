-- All fixtures and alerts roll back on the shared project.
begin;
do $$
declare
  v_center uuid := '10000000-0000-4000-a000-000000000001';
  v_source uuid;
  v_target uuid;
  v_child uuid;
  v_occupant uuid;
  v_plan uuid;
  v_day date;
  v_first_count integer;
begin
  v_day := public.next_center_open_date(v_center, (now() at time zone 'America/Toronto')::date + 7);
  insert into public.classrooms(daycare_id, name, min_age_months, max_age_months, capacity, ratio_children_per_educator)
    values(v_center, 'Rollback alert source', 0, 120, 10, 4) returning id into v_source;
  insert into public.classrooms(daycare_id, name, min_age_months, max_age_months, capacity, ratio_children_per_educator)
    values(v_center, 'Rollback alert destination', 36, 72, 1, 4) returning id into v_target;
  insert into public.children(daycare_id, classroom_id, first_name, last_name, date_of_birth)
    values(v_center, v_source, 'Review', 'Candidate', (v_day - interval '4 years')::date) returning id into v_child;
  insert into public.room_transition_plans(daycare_id, child_id, from_classroom_id, to_classroom_id, move_on, transition_week)
    values(v_center, v_child, v_source, v_target, v_day, false) returning id into v_plan;

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform public.enqueue_room_transition_plan_review_alerts();
  if (select review_issue from public.room_transition_plans where id = v_plan) is not null then
    raise exception 'Valid plan raised review alert';
  end if;
  insert into public.children(daycare_id, classroom_id, first_name, last_name, date_of_birth)
    values(v_center, v_target, 'Review', 'Occupant', (v_day - interval '4 years')::date) returning id into v_occupant;
  perform public.enqueue_room_transition_plan_review_alerts();
  if (select review_issue from public.room_transition_plans where id = v_plan) <> 'No projected space on move day' then
    raise exception 'Incorrect review reason';
  end if;
  select count(*) into v_first_count from public.notifications where payload->>'planId' = v_plan::text;
  if v_first_count < 1 then raise exception 'Review notification missing'; end if;
  perform public.enqueue_room_transition_plan_review_alerts();
  if (select count(*) from public.notifications where payload->>'planId' = v_plan::text) <> v_first_count then
    raise exception 'Unchanged issue created a duplicate alert';
  end if;
  delete from public.children where id = v_occupant;
  perform public.enqueue_room_transition_plan_review_alerts();
  if (select review_issue from public.room_transition_plans where id = v_plan) is not null then
    raise exception 'Resolved issue was not cleared';
  end if;
  raise notice 'PASS: changed capacity alerts once, remains deduplicated, and clears after correction';
end;
$$;
rollback;
