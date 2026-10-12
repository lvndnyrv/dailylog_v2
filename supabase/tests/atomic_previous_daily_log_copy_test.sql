-- Previous-day copy is authorized, atomic and retry-safe. All fixtures roll back.
begin;
set local statement_timeout = '30s';

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
  v_center constant uuid := '10000000-0000-4000-a000-000000000001';
  v_owner constant uuid := '00000000-0000-4000-a000-000000000001';
  v_educator constant uuid := '00000000-0000-4000-a000-000000000003';
  v_parent constant uuid := '00000000-0000-4000-a000-000000000023';
  v_room uuid;
  v_child uuid;
  v_source uuid;
  v_target uuid;
  v_result jsonb;
  v_failed boolean;
begin
  perform pg_temp.impersonate('postgres', v_owner);
  select classroom_id into v_room from public.profiles where id = v_educator;
  if v_room is null then raise exception 'FAIL: educator classroom fixture is missing'; end if;

  insert into public.children (
    daycare_id, classroom_id, first_name, last_name, date_of_birth, enrolled_on
  ) values (
    v_center, v_room, 'Copy', 'Routine', public.center_today() - 1200,
    public.center_today() - 1
  ) returning id into v_child;
  insert into public.daily_logs (daycare_id, child_id, educator_id, log_date, notes)
  values (v_center, v_child, v_educator, public.center_today() - 1, 'Previous routine')
  returning id into v_source;
  insert into public.daily_logs (daycare_id, child_id, educator_id, log_date)
  values (v_center, v_child, v_educator, public.center_today())
  returning id into v_target;
  insert into public.meal_entries (daily_log_id, time, food_type, amount)
  values (v_source, '08:30', 'Morning snack', 'all');
  insert into public.activity_entries (daily_log_id, activity_name)
  values (v_source, 'Outdoor play');

  perform pg_temp.impersonate('authenticated', v_educator);
  v_result := public.copy_previous_daily_log_entries(v_target);
  if (v_result->>'mealCount')::integer <> 1
     or (v_result->>'activityCount')::integer <> 1 then
    raise exception 'FAIL: previous routine did not copy completely: %', v_result;
  end if;
  v_result := public.copy_previous_daily_log_entries(v_target);
  if (v_result->>'mealCount')::integer <> 0
     or (v_result->>'activityCount')::integer <> 0
     or (select count(*) from public.meal_entries where daily_log_id = v_target) <> 1
     or (select count(*) from public.activity_entries where daily_log_id = v_target) <> 1 then
    raise exception 'FAIL: retry duplicated previous-day entries: %', v_result;
  end if;
  raise notice 'PASS: previous-day copy is atomic and retry-safe';

  perform public.publish_daily_log(v_target);
  v_failed := false;
  begin
    perform public.copy_previous_daily_log_entries(v_target);
  exception when others then
    v_failed := position('final daily report' in sqlerrm) > 0;
  end;
  if not v_failed then raise exception 'FAIL: final report accepted a copy'; end if;
  raise notice 'PASS: final daily reports cannot receive copied entries';

  insert into public.parent_children(parent_id, child_id, relationship, is_primary)
  values (v_parent, v_child, 'Parent', true);
  perform pg_temp.impersonate('authenticated', v_parent);
  v_failed := false;
  begin
    perform public.copy_previous_daily_log_entries(v_target);
  exception when others then
    v_failed := position('staff account' in sqlerrm) > 0;
  end;
  if not v_failed then raise exception 'FAIL: parent copied educator log entries'; end if;
  raise notice 'PASS: family accounts cannot invoke the educator copy operation';
end;
$$;

rollback;
select 'ATOMIC PREVIOUS DAILY LOG COPY TESTS: ALL PASSED' as result;
