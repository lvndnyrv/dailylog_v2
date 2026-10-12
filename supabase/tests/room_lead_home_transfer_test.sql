-- Run with: supabase db query --linked --file supabase/tests/room_lead_home_transfer_test.sql
-- All fixture accounts, rooms, schedules, audits and assignments roll back.
begin;

create or replace function pg_temp.impersonate(p_role text, p_user_id uuid)
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
  v_source uuid := '20000000-0000-4000-a000-000000000001';
  v_educator uuid := gen_random_uuid();
  v_staff uuid;
  v_room uuid;
  v_settings jsonb;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (v_educator, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'lead-transfer-' || v_educator || '@dailylog.invalid', '', now(),
    '{"provider":"email","providers":["email"]}', '{"full_name":"Rollback Lead Educator"}', now(), now());
  update public.profiles set role='educator', daycare_id=v_center, classroom_id=v_source where id=v_educator;
  insert into public.staff_members (daycare_id, profile_id, status)
  values (v_center, v_educator, 'active') returning id into v_staff;
  insert into public.educator_classrooms (educator_id, classroom_id)
  values (v_educator, v_source) on conflict do nothing;

  v_settings := jsonb_build_object(
    'name', 'Rollback lead room ' || left(v_educator::text, 8),
    'age_group', 'Preschool', 'min_age_months', '36', 'max_age_months', '60',
    'capacity', '10', 'ratio', '5', 'lead_educator_id', v_educator
  );

  insert into public.staff_regular_schedules
    (daycare_id, staff_member_id, classroom_id, weekday, starts_local, ends_local)
  values (v_center, v_staff, v_source, 1, '08:00', '16:00');
  perform pg_temp.impersonate('authenticated', v_owner);
  begin
    perform public.save_room_settings_with_lead_transfer(null, v_settings, null);
    raise exception 'FAIL: conflicting regular schedule allowed a room transfer';
  exception when others then
    if sqlerrm like 'FAIL:%' or sqlerrm not like 'The educator has a regular schedule%' then raise; end if;
  end;
  if exists (select 1 from public.classrooms where name=v_settings->>'name') then
    raise exception 'FAIL: rejected transfer left a partially created room';
  end if;

  perform pg_temp.impersonate('postgres', v_owner);
  delete from public.staff_regular_schedules where staff_member_id=v_staff;
  insert into public.staff_shifts
    (daycare_id, staff_member_id, classroom_id, starts_at, ends_at, status)
  values (v_center, v_staff, v_source, now()+interval '1 day', now()+interval '1 day 8 hours', 'published');
  perform pg_temp.impersonate('authenticated', v_owner);
  begin
    perform public.save_room_settings_with_lead_transfer(null, v_settings, null);
    raise exception 'FAIL: conflicting published shift allowed a room transfer';
  exception when others then
    if sqlerrm like 'FAIL:%' or sqlerrm not like 'The educator has a published shift%' then raise; end if;
  end;

  perform pg_temp.impersonate('postgres', v_owner);
  delete from public.staff_shifts where staff_member_id=v_staff;
  perform pg_temp.impersonate('authenticated', v_owner);
  begin
    perform public.save_room_settings_with_lead_transfer(null,
      v_settings || jsonb_build_object('opens_on', public.center_today() + 7), null);
    raise exception 'FAIL: future-opening room moved home access early';
  exception when others then
    if sqlerrm like 'FAIL:%' or sqlerrm not like 'This room opens later%' then raise; end if;
  end;

  v_room := public.save_room_settings_with_lead_transfer(null, v_settings, null);
  if (select classroom_id from public.profiles where id=v_educator) is distinct from v_room
     or not exists (select 1 from public.educator_classrooms
       where educator_id=v_educator and classroom_id=v_room)
     or exists (select 1 from public.educator_classrooms
       where educator_id=v_educator and classroom_id=v_source)
     or (select lead_educator_id from public.classrooms where id=v_room) is distinct from v_educator then
    raise exception 'FAIL: room lead and permanent room assignment did not move together';
  end if;

  perform pg_temp.impersonate('authenticated', v_educator);
  begin
    perform public.save_room_settings_with_lead_transfer(null, v_settings || jsonb_build_object('name', 'Forbidden lead room'), null);
    raise exception 'FAIL: educator created a room with a lead transfer';
  exception when others then
    if sqlerrm like 'FAIL:%' or sqlerrm not like 'Room and staff edit permissions%' then raise; end if;
  end;
  raise notice 'PASS: lead transfer is atomic, schedule-aware, center-permission checked and never starts before opening';
end;
$$;

rollback;
