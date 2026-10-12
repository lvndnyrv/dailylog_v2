-- Meal planning must preserve valid menus, respect room assignments and force
-- allergy-safe alternatives before a scheduled meal can be logged.
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
  v_room uuid;
  v_other_room uuid;
  v_allergic_child uuid;
  v_other_child uuid;
  v_menu uuid;
  v_result jsonb;
  v_failed boolean;
begin
  perform pg_temp.impersonate('postgres', v_owner);
  select classroom_id into v_room from public.profiles where id = v_educator;
  if v_room is null then raise exception 'FAIL: educator room fixture missing'; end if;
  insert into public.classrooms (daycare_id, name, age_group)
  values (v_center, 'Rollback unassigned menu room', 'Test')
  returning id into v_other_room;

  perform pg_temp.impersonate('authenticated', v_owner);
  perform public.save_meal_menu_day(
    public.center_today(), null,
    jsonb_build_array(jsonb_build_object(
      'meal_type', 'lunch', 'meal_label', 'Lunch', 'meal_time', '11:45:00',
      'food_description', 'Pasta with cheese', 'allergens', jsonb_build_array('dairy')
    ))
  );
  select id into v_menu from public.meal_menu_items
   where daycare_id = v_center and menu_date = public.center_today()
     and classroom_id is null and meal_type = 'lunch';

  v_failed := false;
  begin
    perform public.save_meal_menu_day(
      public.center_today(), null,
      jsonb_build_array(
        jsonb_build_object('meal_type','lunch','meal_label','Lunch','meal_time','11:45','food_description','One'),
        jsonb_build_object('meal_type','lunch','meal_label','Lunch','meal_time','12:00','food_description','Two')
      )
    );
  exception when others then v_failed := position('only once' in sqlerrm) > 0;
  end;
  if not v_failed or not exists (
    select 1 from public.meal_menu_items where id = v_menu and food_description = 'Pasta with cheese'
  ) then raise exception 'FAIL: invalid replacement erased or changed the valid menu'; end if;
  raise notice 'PASS: menu replacement validates before preserving the prior day';

  perform pg_temp.impersonate('authenticated', v_educator);
  v_failed := false;
  begin
    perform public.save_meal_menu_day(public.center_today(), null, '[]'::jsonb);
  exception when others then v_failed := position('administrators' in sqlerrm) > 0;
  end;
  if not v_failed then raise exception 'FAIL: educator changed the all-rooms menu'; end if;
  v_failed := false;
  begin
    perform public.save_meal_menu_day(public.center_today(), v_other_room, '[]'::jsonb);
  exception when others then v_failed := position('accessible classroom' in sqlerrm) > 0;
  end;
  if not v_failed then raise exception 'FAIL: educator changed an unassigned room menu'; end if;
  perform public.save_meal_menu_day(
    public.center_today(), v_room,
    jsonb_build_array(jsonb_build_object(
      'meal_type','morning_snack','meal_label','Morning snack','meal_time','09:30',
      'food_description','Fruit cup','allergens','[]'::jsonb
    ))
  );
  raise notice 'PASS: educators can plan only their accessible classrooms';

  perform pg_temp.impersonate('postgres', v_owner);
  insert into public.children (
    daycare_id, classroom_id, first_name, last_name, date_of_birth,
    enrolled_on, allergies
  ) values (
    v_center, v_room, 'Allergy', 'Test', public.center_today() - 1200,
    public.center_today(), array['Dairy allergy']
  ) returning id into v_allergic_child;
  insert into public.children (
    daycare_id, classroom_id, first_name, last_name, date_of_birth,
    enrolled_on, allergies
  ) values (
    v_center, v_room, 'Noallergy', 'Test', public.center_today() - 1200,
    public.center_today(), array[]::text[]
  ) returning id into v_other_child;

  perform pg_temp.impersonate('authenticated', v_educator);
  v_failed := false;
  begin
    perform public.bulk_log_scheduled_meal(
      array[v_allergic_child, v_other_child], v_menu,
      jsonb_build_object(v_allergic_child::text,'some',v_other_child::text,'all'),
      '{}'::jsonb,
      'Pasta with cheese'
    );
  exception when others then v_failed := position('safe alternative' in sqlerrm) > 0;
  end;
  if not v_failed or exists (
    select 1 from public.daily_logs where child_id in (v_allergic_child, v_other_child)
      and log_date = public.center_today()
  ) then raise exception 'FAIL: missing alternative left a partial meal log'; end if;

  v_result := public.bulk_log_scheduled_meal(
    array[v_allergic_child, v_other_child], v_menu,
    jsonb_build_object(v_allergic_child::text,'some',v_other_child::text,'all'),
    jsonb_build_object(v_allergic_child::text,'Tomato pasta with oat milk'),
    'Pasta with vegetables and cheese'
  );
  if (v_result->>'affectedCount')::integer <> 2 then
    raise exception 'FAIL: scheduled meal did not reach both children';
  end if;
  if not exists (
    select 1 from public.meal_entries meal
    join public.daily_logs daily_log on daily_log.id = meal.daily_log_id
    where daily_log.child_id = v_allergic_child
      and meal.food_type = 'Tomato pasta with oat milk'
      and meal.meal_menu_item_id = v_menu
  ) or not exists (
    select 1 from public.meal_entries meal
    join public.daily_logs daily_log on daily_log.id = meal.daily_log_id
    where daily_log.child_id = v_other_child
      and meal.food_type = 'Pasta with vegetables and cheese'
      and meal.meal_menu_item_id = v_menu
  ) then raise exception 'FAIL: safe alternative was not applied per child'; end if;
  raise notice 'PASS: scheduled meals require and retain per-child safe alternatives';
end;
$$;

rollback;
select 'MEAL MENU HANDOFF INTEGRITY TESTS: ALL PASSED' as result;
