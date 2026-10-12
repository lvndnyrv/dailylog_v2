-- Quick Log applies each group action atomically and safely. All fixtures roll back.
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
  v_child_one uuid;
  v_child_two uuid;
  v_log_one uuid;
  v_log_two uuid;
  v_result jsonb;
  v_first_check_in timestamptz;
  v_failed boolean;
begin
  perform pg_temp.impersonate('postgres', v_owner);
  select classroom_id into v_room from public.profiles where id = v_educator;
  if v_room is null then raise exception 'FAIL: educator classroom fixture is missing'; end if;
  insert into public.children (
    daycare_id, classroom_id, first_name, last_name, date_of_birth, enrolled_on
  ) values (
    v_center, v_room, 'Bulk', 'One', public.center_today() - 1200, public.center_today()
  )
  returning id into v_child_one;
  insert into public.children (
    daycare_id, classroom_id, first_name, last_name, date_of_birth, enrolled_on
  ) values (
    v_center, v_room, 'Bulk', 'Two', public.center_today() - 1300, public.center_today()
  )
  returning id into v_child_two;

  perform pg_temp.impersonate('authenticated', v_educator);
  v_result := public.bulk_log_daily_updates(
    array[v_child_one, v_child_two],
    'meal',
    jsonb_build_object(
      'foodType', 'Rollback oatmeal and fruit',
      'time', '08:30:00',
      'amounts', jsonb_build_object(v_child_one::text, 'all', v_child_two::text, 'some')
    )
  );
  if (v_result->>'affectedCount')::integer <> 2 then
    raise exception 'FAIL: group meal did not reach both children: %', v_result;
  end if;
  select id into v_log_one from public.daily_logs
   where child_id = v_child_one and log_date = public.center_today();
  select id into v_log_two from public.daily_logs
   where child_id = v_child_two and log_date = public.center_today();
  if v_log_one is null or v_log_two is null or (
    select count(*) from public.meal_entries meal
     where meal.daily_log_id in (v_log_one, v_log_two)
       and meal.food_type = 'Rollback oatmeal and fruit'
  ) <> 2 then raise exception 'FAIL: group meal left a partial result'; end if;
  raise notice 'PASS: group meal and draft creation commit together';

  perform public.bulk_log_daily_updates(
    array[v_child_one, v_child_two], 'activity',
    '{"activities":["Outdoor play","Story time"]}'::jsonb
  );
  v_result := public.bulk_log_daily_updates(
    array[v_child_one, v_child_two], 'activity',
    '{"activities":["Outdoor play","Story time"]}'::jsonb
  );
  if (v_result->>'affectedCount')::integer <> 0 or (
    select count(*) from public.activity_entries activity
     where activity.daily_log_id in (v_log_one, v_log_two)
  ) <> 4 then raise exception 'FAIL: activity retry created duplicates'; end if;

  perform public.bulk_log_daily_updates(
    array[v_child_one, v_child_two], 'note', '{"note":"Enjoyed the garden."}'::jsonb
  );
  v_result := public.bulk_log_daily_updates(
    array[v_child_one, v_child_two], 'note', '{"note":"Enjoyed the garden."}'::jsonb
  );
  if (v_result->>'affectedCount')::integer <> 0 or exists (
    select 1 from public.daily_logs daily_log
     where daily_log.id in (v_log_one, v_log_two)
       and daily_log.notes <> 'Enjoyed the garden.'
  ) then raise exception 'FAIL: note retry duplicated family text'; end if;

  v_result := public.bulk_log_daily_updates(
    array[v_child_one, v_child_two], 'nap_start', '{"time":"12:15:00"}'::jsonb
  );
  v_result := public.bulk_log_daily_updates(
    array[v_child_one, v_child_two], 'nap_start', '{"time":"12:16:00"}'::jsonb
  );
  if (v_result->>'affectedCount')::integer <> 0 or (
    select count(*) from public.sleep_entries sleep
     where sleep.daily_log_id in (v_log_one, v_log_two) and sleep.end_time is null
  ) <> 2 then raise exception 'FAIL: nap retry created duplicate open naps'; end if;
  v_result := public.bulk_log_daily_updates(
    array[v_child_one, v_child_two], 'nap_end', '{"time":"13:30:00"}'::jsonb
  );
  if (v_result->>'affectedCount')::integer <> 2 then
    raise exception 'FAIL: group nap end was partial';
  end if;
  raise notice 'PASS: activities, notes, and naps are retry-safe';

  v_result := public.bulk_set_mobile_attendance(
    array[v_child_one, v_child_two], 'check-in'
  );
  select checked_in_at into v_first_check_in from public.attendance_records
   where child_id = v_child_one and date = public.center_today();
  v_result := public.bulk_set_mobile_attendance(
    array[v_child_one, v_child_two], 'check-in'
  );
  if (v_result->>'affectedCount')::integer <> 0 or v_first_check_in is distinct from (
    select checked_in_at from public.attendance_records
     where child_id = v_child_one and date = public.center_today()
  ) then raise exception 'FAIL: repeated check-in changed the original arrival'; end if;
  v_result := public.bulk_set_mobile_attendance(
    array[v_child_one, v_child_two], 'check-out'
  );
  if (v_result->>'affectedCount')::integer <> 2 then
    raise exception 'FAIL: group checkout was partial';
  end if;
  raise notice 'PASS: group attendance preserves original arrivals and closes atomically';

  perform pg_temp.impersonate('postgres', v_owner);
  insert into public.consents (daycare_id, child_id, kind, version, granted, granted_at)
  values
    (v_center, v_child_one, 'Photo & media consent', '1', true, now()),
    (v_center, v_child_two, 'Photo & media consent', '1', true, now());
  insert into storage.objects (bucket_id, name, owner, owner_id)
  values
    (
      'daily-log-photos',
      v_child_one::text || '/' || v_log_one::text || '/rollback-one.jpg',
      v_educator,
      v_educator::text
    ),
    (
      'daily-log-photos',
      v_child_two::text || '/' || v_log_two::text || '/rollback-two.jpg',
      v_educator,
      v_educator::text
    );
  perform pg_temp.impersonate('authenticated', v_educator);
  v_result := public.bulk_log_daily_updates(
    array[v_child_one, v_child_two], 'photo_prepare', '{}'::jsonb
  );
  if jsonb_array_length(v_result->'logs') <> 2 then
    raise exception 'FAIL: photo preparation did not return both editable logs';
  end if;
  v_result := public.attach_bulk_daily_log_photos(
    jsonb_build_array(
      jsonb_build_object(
        'child_id', v_child_one, 'log_id', v_log_one,
        'storage_path', v_child_one::text || '/' || v_log_one::text || '/rollback-one.jpg'
      ),
      jsonb_build_object(
        'child_id', v_child_two, 'log_id', v_log_two,
        'storage_path', v_child_two::text || '/' || v_log_two::text || '/rollback-two.jpg'
      )
    ),
    'Garden time'
  );
  if (v_result->>'affectedCount')::integer <> 2 then
    raise exception 'FAIL: group photo metadata was partial';
  end if;
  raise notice 'PASS: consented group photo metadata commits together';

  perform public.publish_daily_log(v_log_one);
  v_failed := false;
  begin
    perform public.bulk_log_daily_updates(
      array[v_child_one, v_child_two], 'mood', '{"mood":"Happy"}'::jsonb
    );
  exception when others then
    v_failed := position('final daily report' in sqlerrm) > 0;
  end;
  if not v_failed or exists (
    select 1 from public.daily_logs where id = v_log_two and 'Happy' = any(moods)
  ) then raise exception 'FAIL: final report caused a partial group mood update'; end if;
  raise notice 'PASS: one final report rejects the whole group action before writes';

  perform pg_temp.impersonate('postgres', v_owner);
  insert into public.parent_children(parent_id, child_id, relationship, is_primary)
  values (v_parent, v_child_two, 'Parent', true);
  perform pg_temp.impersonate('authenticated', v_parent);
  v_failed := false;
  begin
    perform public.bulk_log_daily_updates(
      array[v_child_two], 'note', '{"note":"Unauthorized"}'::jsonb
    );
  exception when others then
    v_failed := position('permission' in lower(sqlerrm)) > 0;
  end;
  if not v_failed then raise exception 'FAIL: parent invoked educator bulk logging'; end if;
  raise notice 'PASS: family accounts cannot invoke classroom logging';
end;
$$;

rollback;
select 'ATOMIC BULK CLASSROOM LOGGING TESTS: ALL PASSED' as result;
