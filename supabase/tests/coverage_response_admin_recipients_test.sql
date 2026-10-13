begin;

do $$
declare
  v_center uuid := '10000000-0000-4000-a000-000000000001';
  v_owner uuid := '00000000-0000-4000-a000-000000000001';
  v_educator uuid := '00000000-0000-4000-a000-000000000003';
  v_marker text := gen_random_uuid()::text;
  v_id uuid;
begin
  if not public.profile_has_permission(v_educator, 'rooms', 'edit') then
    raise exception 'FAIL: fixture educator should have delegated room-edit permission';
  end if;

  v_id := gen_random_uuid();
  insert into public.notifications(id, daycare_id, profile_id, kind, title, payload)
  values(v_id, v_center, v_educator, 'coverage_response', 'Rollback coverage response',
    jsonb_build_object('testMarker', v_marker));
  if exists(select 1 from public.notifications where id = v_id) then
    raise exception 'FAIL: educator received admin-only coverage response';
  end if;

  v_id := gen_random_uuid();
  insert into public.notification_outbox(
    id, daycare_id, recipient_id, channel, kind, title, dedupe_key, payload
  ) values (
    v_id, v_center, v_educator, 'push', 'coverage_response',
    'Rollback coverage response', 'rollback-coverage-response:' || v_marker,
    jsonb_build_object('testMarker', v_marker)
  );
  if exists(select 1 from public.notification_outbox where id = v_id) then
    raise exception 'FAIL: educator received admin-only coverage push';
  end if;

  v_id := gen_random_uuid();
  insert into public.notifications(id, daycare_id, profile_id, kind, title, payload)
  values(v_id, v_center, v_owner, 'coverage_response', 'Rollback coverage response',
    jsonb_build_object('testMarker', v_marker));
  if not exists(select 1 from public.notifications where id = v_id) then
    raise exception 'FAIL: owner lost coverage response alert';
  end if;

  v_id := gen_random_uuid();
  insert into public.notification_outbox(
    id, daycare_id, recipient_id, channel, kind, title, dedupe_key, payload
  ) values (
    v_id, v_center, v_owner, 'push', 'coverage_response',
    'Rollback coverage response', 'rollback-owner-coverage-response:' || v_marker,
    jsonb_build_object('testMarker', v_marker)
  );
  if not exists(select 1 from public.notification_outbox where id = v_id) then
    raise exception 'FAIL: owner lost coverage response push';
  end if;

  v_id := gen_random_uuid();
  insert into public.notifications(id, daycare_id, profile_id, kind, title, payload)
  values(v_id, v_center, v_educator, 'coverage_review', 'Rollback educator review',
    jsonb_build_object('testMarker', v_marker));
  if not exists(select 1 from public.notifications where id = v_id) then
    raise exception 'FAIL: educator lost own coverage-review alert';
  end if;
end $$;

rollback;
select 'PASS: coverage responses reach administrators only; educator review remains; rolled back' result;
