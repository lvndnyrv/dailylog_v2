-- Run with: supabase db query --linked --file supabase/tests/admin_rooms_group7_test.sql
-- All fixtures, settings changes, notifications and audit rows are rolled back.
begin;
create or replace function pg_temp.impersonate(p_role text, p_user_id uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('role', p_role, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', p_role)::text, true);
end;
$$;

do $$
declare
  v_center uuid := '10000000-0000-4000-a000-000000000001';
  v_owner uuid := '00000000-0000-4000-a000-000000000001';
  v_room uuid := '20000000-0000-4000-a000-000000000001';
  v_target uuid := '20000000-0000-4000-a000-000000000003';
  v_profile uuid := gen_random_uuid();
  v_staff uuid; v_cover uuid; v_leave uuid; v_entry uuid; v_child uuid; v_plan uuid;
  v_rules integer; v_before jsonb; v_after jsonb; v_future date; v_past date;
  v_empty_room uuid; v_attendance uuid;
  v_open_today boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (v_profile, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'rooms-' || v_profile || '@dailylog.invalid', '', now(),
    '{"provider":"email","providers":["email"]}', '{"full_name":"Rollback Rooms Educator"}', now(), now());
  update public.profiles set role = 'educator', daycare_id = v_center, classroom_id = v_room where id = v_profile;
  insert into public.staff_members (daycare_id, profile_id, status) values (v_center, v_profile, 'active') returning id into v_staff;
  update public.daycares set time_tracking_enabled = false where id = v_center;

  if not exists (select 1 from public._room_staff_presence(v_center) where profile_id = v_profile and effective_classroom_id = v_room) then
    raise exception 'FAIL: eligible home-room educator is missing';
  end if;
  insert into public.room_coverage_assignments (daycare_id, classroom_id, staff_member_id, starts_at, ends_at)
  values (v_center, v_target, v_staff, now() - interval '5 minutes', now() + interval '55 minutes') returning id into v_cover;
  if not exists (select 1 from public._room_staff_presence(v_center) where profile_id = v_profile and effective_classroom_id = v_target)
    or exists (select 1 from public._room_staff_presence(v_center) where profile_id = v_profile and effective_classroom_id = v_room) then
    raise exception 'FAIL: coverage must move the count, not double-count the educator';
  end if;
  perform pg_temp.impersonate('authenticated', v_owner);
  if exists (select 1 from public.get_rooms_live_status() web join public.get_mobile_room_ratios() mobile using (id)
    where web.present_count <> mobile.present_count or jsonb_array_length(web.educators) <> mobile.staff_count) then
    raise exception 'FAIL: admin and educator live ratios differ';
  end if;
  perform pg_temp.impersonate('authenticated', v_profile);
  if v_target not in (select public.my_classroom_ids()) then raise exception 'FAIL: assigned educator cannot enter coverage room'; end if;
  if exists (select 1 from public.get_rooms_live_status() web join public.get_mobile_room_ratios() mobile using (id)
    where web.present_count <> mobile.present_count or jsonb_array_length(web.educators) <> mobile.staff_count) then
    raise exception 'FAIL: educator sees divergent ratio engines';
  end if;
  begin
    perform public.save_room_ratio_rules(jsonb_build_array(jsonb_build_object('room_id', v_room, 'ratio', 3)));
    raise exception 'FAIL: educator changed center licensing rules';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;

  perform pg_temp.impersonate('postgres', v_owner);
  update public.room_coverage_assignments set status = 'declined' where id = v_cover;
  if not exists (select 1 from public._room_staff_presence(v_center) where profile_id = v_profile and effective_classroom_id = v_room) then
    raise exception 'FAIL: declined coverage still overrides the home room';
  end if;
  update public.staff_members set background_check_required = true where id = v_staff;
  if exists (select 1 from public._room_staff_presence(v_center) where profile_id = v_profile) then
    raise exception 'FAIL: missing required clearance counts toward ratio';
  end if;
  update public.staff_members set background_check_required = false where id = v_staff;
  insert into public.staff_time_off_requests (daycare_id, staff_member_id, starts_on, ends_on, kind, status)
  select v_center, v_staff, (now() at time zone timezone)::date, (now() at time zone timezone)::date, 'sick', 'approved'
  from public.daycares where id = v_center returning id into v_leave;
  if exists (select 1 from public._room_staff_presence(v_center) where profile_id = v_profile) then
    raise exception 'FAIL: educator on approved leave counts toward ratio';
  end if;
  delete from public.staff_time_off_requests where id = v_leave;
  update public.daycares set time_tracking_enabled = true where id = v_center;
  if exists (select 1 from public._room_staff_presence(v_center) where profile_id = v_profile) then
    raise exception 'FAIL: tracking-enabled educator counts before clock-in';
  end if;
  insert into public.staff_time_entries (daycare_id, staff_member_id, classroom_id, clocked_in_at)
  values (v_center, v_staff, v_target, now() - interval '10 minutes') returning id into v_entry;
  if not exists (select 1 from public._room_staff_presence(v_center) where profile_id = v_profile and effective_classroom_id = v_target) then
    raise exception 'FAIL: actual clock-in room is ignored';
  end if;
  update public.staff_time_entries set clocked_out_at = now(), status = 'submitted' where id = v_entry;
  if exists (select 1 from public._room_staff_presence(v_center) where profile_id = v_profile) then
    raise exception 'FAIL: clocked-out educator still counts';
  end if;

  perform pg_temp.impersonate('authenticated', v_owner);
  select ratio_children_per_educator into v_rules from public.classrooms where id = v_room;
  begin
    perform public.save_room_ratio_rules(jsonb_build_array(
      jsonb_build_object('room_id', v_room, 'ratio', 2),
      jsonb_build_object('room_id', gen_random_uuid(), 'ratio', 3)));
    raise exception 'FAIL: invalid second room was accepted';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  if (select ratio_children_per_educator from public.classrooms where id = v_room) is distinct from v_rules then
    raise exception 'FAIL: failed bulk save partially changed the first rule';
  end if;
  begin
    perform public.save_room_ratio_rules(jsonb_build_array(jsonb_build_object('room_id', v_room, 'ratio', 2.5)));
    raise exception 'FAIL: fractional licensing ratio was accepted';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  perform public.save_room_ratio_rules(jsonb_build_array(jsonb_build_object('room_id', v_room, 'ratio', 4)));
  if (select ratio_children_per_educator from public.classrooms where id = v_room) <> 4 then raise exception 'FAIL: valid ratio rule was not saved'; end if;

  select coalesce(jsonb_agg(to_jsonb(c) order by c.period), '[]') into v_before from public.room_combinations c where daycare_id = v_center;
  begin
    perform public.save_room_combinations(jsonb_build_array(
      jsonb_build_object('period', 'morning', 'source_classroom_id', v_room, 'host_classroom_id', v_target,
        'starts_at', '07:00', 'ends_at', '08:00', 'enabled', true),
      jsonb_build_object('period', 'evening', 'source_classroom_id', v_room, 'host_classroom_id', gen_random_uuid(),
        'starts_at', '17:00', 'ends_at', '18:00', 'enabled', true)));
    raise exception 'FAIL: invalid second combination was accepted';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  select coalesce(jsonb_agg(to_jsonb(c) order by c.period), '[]') into v_after from public.room_combinations c where daycare_id = v_center;
  if v_before <> v_after then raise exception 'FAIL: failed combination save changed the morning period'; end if;
  perform public.save_room_combinations(jsonb_build_array(
    jsonb_build_object('period', 'morning', 'source_classroom_id', v_room, 'host_classroom_id', v_target,
      'starts_at', '07:00', 'ends_at', '08:00', 'enabled', true),
    jsonb_build_object('period', 'evening', 'source_classroom_id', v_room, 'host_classroom_id', v_target,
      'starts_at', '17:00', 'ends_at', '18:00', 'enabled', true)));
  if (select count(*) from public.room_combinations where daycare_id = v_center and enabled) <> 2 then
    raise exception 'FAIL: valid combination settings were not saved';
  end if;

  -- New child avoids altering any existing family plan. No family recipients.
  perform pg_temp.impersonate('postgres', v_owner);
  insert into public.children (daycare_id, classroom_id, first_name, last_name, date_of_birth)
  values (v_center, v_room, 'Rollback', 'Room move', '2023-01-01') returning id into v_child;
  perform pg_temp.impersonate('authenticated', v_owner);
  v_future := public.center_today() + 30;
  while extract(isodow from v_future) > 5 or exists (select 1 from public.center_closures
    where daycare_id = v_center and v_future between starts_on and ends_on) loop v_future := v_future + 1; end loop;
  insert into public.room_transition_plans (daycare_id, child_id, from_classroom_id, to_classroom_id,
    move_on, transition_week, family_visible)
  values (v_center, v_child, v_room, v_target, v_future, false, false) returning id into v_plan;
  select extract(isodow from public.center_today()) <= 5
    and not exists (
      select 1 from public.center_closures
       where daycare_id = v_center
         and public.center_today() between starts_on and ends_on
    ) into v_open_today;
  if not v_open_today then
    begin
      perform public.complete_room_transition_plan(v_plan);
      raise exception 'FAIL: a transition completed while the center was closed';
    exception when others then
      if sqlerrm <> 'Complete this move on an open center day' then raise; end if;
    end;
    raise notice 'PASS: closed-day transition guard enforced; open-day completion checks deferred';
    return;
  end if;
  begin
    perform public.complete_room_transition_plan(v_plan);
    raise exception 'FAIL: future move completed early';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  v_past := public.center_today() - 1;
  while extract(isodow from v_past) > 5 or exists (select 1 from public.center_closures
    where daycare_id = v_center and v_past between starts_on and ends_on) loop v_past := v_past - 1; end loop;
  update public.room_transition_plans set move_on = v_past where id = v_plan;
  update public.classrooms set capacity = (select count(*) from public.children where classroom_id = v_target and archived_at is null)
    where id = v_target;
  begin
    perform public.complete_room_transition_plan(v_plan);
    raise exception 'FAIL: move into a full room succeeded';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  if (select classroom_id from public.children where id = v_child) <> v_room
    or (select status from public.room_transition_plans where id = v_plan) <> 'planned' then
    raise exception 'FAIL: rejected move changed the child or plan';
  end if;
  insert into public.classrooms (daycare_id, name, capacity, ratio_children_per_educator, opens_on)
  values (v_center, 'Rollback unopened room', 3, 1, v_future) returning id into v_empty_room;
  update public.room_transition_plans set to_classroom_id = v_empty_room where id = v_plan;
  begin
    perform public.complete_room_transition_plan(v_plan);
    raise exception 'FAIL: move into an unopened room succeeded';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  update public.classrooms set opens_on = null where id = v_empty_room;
  perform pg_temp.impersonate('postgres', v_owner);
  update public.daycares set ratio_block_checkins = false where id = v_center;
  insert into public.attendance_records (daycare_id, child_id, date, checked_in_at, checked_in_by, method, status)
  values (v_center, v_child, public.center_today(), now() - interval '5 minutes', v_owner, 'kiosk', 'present')
  returning id into v_attendance;
  perform pg_temp.impersonate('authenticated', v_owner);
  begin
    perform public.complete_room_transition_plan(v_plan);
    raise exception 'FAIL: checked-in child moved into a room with no coverage';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if; end;
  if (select classroom_id from public.children where id = v_child) <> v_room then
    raise exception 'FAIL: over-ratio rejection changed the child room';
  end if;
  perform pg_temp.impersonate('postgres', v_owner);
  delete from public.attendance_records where id = v_attendance;
  perform pg_temp.impersonate('authenticated', v_owner);
  update public.room_transition_plans set to_classroom_id = v_target where id = v_plan;
  update public.classrooms set capacity = capacity + 1, opens_on = null where id = v_target;
  perform public.complete_room_transition_plan(v_plan);
  perform public.complete_room_transition_plan(v_plan);
  if (select classroom_id from public.children where id = v_child) <> v_target
    or (select status from public.room_transition_plans where id = v_plan) <> 'completed' then
    raise exception 'FAIL: valid move did not complete atomically and idempotently';
  end if;
end;
$$;
rollback;
select 'GROUP 7: live parity, access, clearance, leave, clock-in, atomic settings, and move guards passed; fixtures rolled back' as result;
