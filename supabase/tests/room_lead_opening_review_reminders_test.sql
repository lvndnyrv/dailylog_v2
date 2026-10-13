-- Run with: supabase db query --linked --file supabase/tests/room_lead_opening_review_reminders_test.sql
-- Fixture people, room, notifications and push deliveries all roll back.
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
  v_lead uuid := gen_random_uuid();
  v_restricted uuid := gen_random_uuid();
  v_room uuid;
  v_key text;
  v_today date;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    (v_lead, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'opening-lead-' || v_lead || '@dailylog.invalid', '', now(),
     '{"provider":"email","providers":["email"]}', '{"full_name":"Rollback Lead"}', now(), now()),
    (v_restricted, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'opening-admin-' || v_restricted || '@dailylog.invalid', '', now(),
     '{"provider":"email","providers":["email"]}', '{"full_name":"Rollback Restricted Admin"}', now(), now());
  update public.profiles set role = 'educator', daycare_id = v_center, classroom_id = v_source
    where id = v_lead;
  update public.profiles set role = 'admin', daycare_id = v_center
    where id = v_restricted;
  insert into public.staff_members(daycare_id, profile_id, status)
    values(v_center, v_lead, 'active');
  insert into public.staff_permission_overrides(daycare_id, profile_id, permissions)
    values(v_center, v_restricted, '{"staff":{"edit":false}}'::jsonb);

  v_today := (select (now() at time zone timezone)::date from public.daycares where id = v_center);
  perform pg_temp.impersonate('authenticated', v_owner);
  v_room := public.save_room_settings(null, jsonb_build_object(
    'name', 'Rollback opening review ' || left(v_lead::text, 8),
    'age_group', 'Preschool', 'min_age_months', '36', 'max_age_months', '60',
    'capacity', '10', 'ratio', '5', 'lead_educator_id', v_lead,
    'opens_on', v_today + 2
  ), null);

  begin
    perform public.enqueue_room_lead_opening_reviews();
    raise exception 'FAIL: an authenticated user ran the reminder worker';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  perform pg_temp.impersonate('service_role', v_owner);
  perform public.enqueue_room_lead_opening_reviews();
  if exists (select 1 from public.notifications where kind = 'room_lead_handoff'
      and payload ->> 'roomId' = v_room::text) then
    raise exception 'FAIL: a future-opening room received an early reminder';
  end if;

  perform pg_temp.impersonate('postgres', v_owner);
  update public.classrooms set opens_on = v_today where id = v_room;
  perform pg_temp.impersonate('service_role', v_owner);
  perform public.enqueue_room_lead_opening_reviews();
  perform public.enqueue_room_lead_opening_reviews();
  v_key := 'room-lead-opening:' || v_room || ':' || v_lead || ':' || v_today;
  if (select count(*) from public.notifications where profile_id = v_owner
      and kind = 'room_lead_handoff' and payload ->> 'dedupeKey' = v_key) <> 1
     or (select count(*) from public.notification_outbox where recipient_id = v_owner
      and kind = 'room_lead_handoff' and channel = 'push' and dedupe_key = v_key) <> 1 then
    raise exception 'FAIL: opening review was missing or duplicated';
  end if;
  if not exists (
    select 1 from public.notifications where profile_id = v_owner
      and kind = 'room_lead_handoff'
      and payload ->> 'href' = '/rooms/' || v_room || '#lead-handoff'
      and payload ->> 'screen' = 'RoomRatios'
      and payload ->> 'roomId' = v_room::text
  ) then
    raise exception 'FAIL: opening review lacks its web/mobile destination';
  end if;
  if exists (select 1 from public.notifications where profile_id = v_restricted
      and kind = 'room_lead_handoff' and payload ->> 'roomId' = v_room::text)
     or (select classroom_id from public.profiles where id = v_lead) is distinct from v_source then
    raise exception 'FAIL: restricted admin was notified or educator was moved automatically';
  end if;

  perform pg_temp.impersonate('postgres', v_owner);
  update public.profiles set classroom_id = v_room where id = v_lead;
  perform pg_temp.impersonate('service_role', v_owner);
  perform public.enqueue_room_lead_opening_reviews();
  if (select count(*) from public.notifications where profile_id = v_owner
      and kind = 'room_lead_handoff' and payload ->> 'dedupeKey' = v_key) <> 1 then
    raise exception 'FAIL: transferred lead received another reminder';
  end if;

  raise notice 'PASS: due-day reminder is permission-scoped, deduplicated and never transfers staff';
end;
$$;

rollback;
