-- Enrollment -> educator operational cycle. A future child is absent from all
-- educator work until the agreed first day, then reaches roster, roll call,
-- attendance, pickup, daily log and messaging without another admin action.
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
  center uuid := '10000000-0000-4000-a000-000000000001';
  owner_id uuid := '00000000-0000-4000-a000-000000000001';
  educator_id uuid := gen_random_uuid();
  room_id uuid;
  v_child_id uuid;
  conversation_id uuid;
  log_id uuid;
  roll_call jsonb;
  visible_count integer;
  failed boolean;
begin
  perform pg_temp.impersonate('postgres', owner_id);
  insert into public.classrooms (
    daycare_id, name, min_age_months, max_age_months, capacity,
    ratio_children_per_educator
  ) values (center, 'Rollback day-one cycle room', 18, 72, 8, 4)
  returning id into room_id;

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    educator_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated', 'day-one-cycle-' || educator_id || '@dailylog.invalid', '', now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Rollback Day One Educator"}', now(), now()
  );
  update public.profiles
     set role = 'educator', daycare_id = center, classroom_id = room_id
   where id = educator_id;
  insert into public.staff_members (
    daycare_id, profile_id, job_title, status, background_check_required
  ) values (center, educator_id, 'Rollback educator', 'active', false);
  insert into public.educator_classrooms(educator_id, classroom_id)
  values (educator_id, room_id);

  insert into public.children (
    daycare_id, classroom_id, first_name, last_name, date_of_birth, enrolled_on
  ) values (
    center, room_id, 'Future', 'Operational', public.center_today() - 1200,
    public.center_today() + 1
  ) returning id into v_child_id;

  perform pg_temp.impersonate('authenticated', educator_id);
  select count(*) into visible_count from public.children where id = v_child_id;
  if visible_count <> 0 then raise exception 'FAIL: future child appeared in educator roster'; end if;
  roll_call := public.get_mobile_roll_call(room_id);
  if exists (
    select 1 from jsonb_array_elements(roll_call->'children') item
     where item->>'id' = v_child_id::text
  ) then raise exception 'FAIL: future child appeared in educator roll call'; end if;

  failed := false;
  begin
    perform public.mobile_roll_call_check_in(v_child_id);
  exception when others then failed := true;
  end;
  if not failed then raise exception 'FAIL: future child was checked in early'; end if;

  failed := false;
  begin
    insert into public.daily_logs(daycare_id, child_id, educator_id, log_date)
    values (center, v_child_id, educator_id, public.center_today());
  exception when others then failed := true;
  end;
  if not failed then raise exception 'FAIL: future child received an educator daily log'; end if;

  failed := false;
  begin
    perform public.get_or_create_child_conversation(v_child_id);
  exception when others then failed := true;
  end;
  if not failed then raise exception 'FAIL: future child opened an educator conversation'; end if;

  -- Advance only the enrollment boundary to today. No additional assignment,
  -- roster or messaging setup should be necessary.
  perform pg_temp.impersonate('postgres', owner_id);
  update public.children set enrolled_on = public.center_today() where id = v_child_id;

  perform pg_temp.impersonate('authenticated', educator_id);
  if not exists (select 1 from public.children where id = v_child_id) then
    raise exception 'FAIL: child did not enter educator roster on the first day';
  end if;
  roll_call := public.get_mobile_roll_call(room_id);
  if not exists (
    select 1 from jsonb_array_elements(roll_call->'children') item
     where item->>'id' = v_child_id::text and item->>'rollStatus' = 'awaited'
  ) then raise exception 'FAIL: child did not enter roll call as awaited'; end if;

  perform public.mobile_roll_call_check_in(v_child_id);
  if not exists (
    select 1 from public.get_mobile_today_pickups(room_id) pickup
     where pickup.child_id = v_child_id and pickup.pickup_status = 'expected'
  ) then raise exception 'FAIL: checked-in child did not enter the pickup queue'; end if;

  insert into public.daily_logs(daycare_id, child_id, educator_id, log_date, notes)
  values (center, v_child_id, educator_id, public.center_today(), 'First-day welcome')
  returning id into log_id;
  if log_id is null then raise exception 'FAIL: first-day daily log was not created'; end if;

  conversation_id := public.get_or_create_child_conversation(v_child_id);
  if conversation_id is null then raise exception 'FAIL: first-day conversation did not open'; end if;
end;
$$;

rollback;
select 'PASS: future enrollment stays out of educator operations, then reaches roster, roll call, attendance, pickup, daily log and messaging on day one without another admin handoff; rolled back' result;
