-- No notification, permission or child change survives this transaction.
begin;
do $$
declare
  v_center uuid := '10000000-0000-4000-a000-000000000001';
  v_owner uuid := '00000000-0000-4000-a000-000000000001';
  v_educator uuid := '00000000-0000-4000-a000-000000000003';
  v_marker text := gen_random_uuid()::text;
  v_id uuid;
begin
  -- Model the delegated child-edit capability that originally made this
  -- educator eligible for the review worker's recipient loop.
  insert into public.staff_permission_overrides(daycare_id, profile_id, permissions)
    values(v_center, v_educator, '{"children":{"edit":true}}')
    on conflict (profile_id, (coalesce(classroom_id, '00000000-0000-0000-0000-000000000000'::uuid)))
    do update set permissions = excluded.permissions;
  if not public.profile_has_permission(v_educator, 'children', 'edit') then
    raise exception 'Educator fixture did not receive delegated child-edit permission';
  end if;

  v_id := gen_random_uuid();
  insert into public.notifications(id, daycare_id, profile_id, kind, title, payload)
    values(v_id, v_center, v_educator, 'room_transition_review', 'Rollback move review', jsonb_build_object('testMarker', v_marker));
  if exists(select 1 from public.notifications where id = v_id) then
    raise exception 'Delegated educator received admin-only room-move review';
  end if;
  v_id := gen_random_uuid();
  insert into public.notification_outbox(id, daycare_id, recipient_id, channel, kind, title, dedupe_key, payload)
    values(v_id, v_center, v_educator, 'push', 'room_transition_review', 'Rollback move review',
      'rollback-move-educator:' || v_marker, jsonb_build_object('testMarker', v_marker));
  if exists(select 1 from public.notification_outbox where id = v_id) then
    raise exception 'Delegated educator received admin-only room-move push';
  end if;

  v_id := gen_random_uuid();
  insert into public.notifications(id, daycare_id, profile_id, kind, title, payload)
    values(v_id, v_center, v_owner, 'room_transition_review', 'Rollback move review', jsonb_build_object('testMarker', v_marker));
  if not exists(select 1 from public.notifications where id = v_id) then
    raise exception 'Owner lost room-move review alert';
  end if;
  v_id := gen_random_uuid();
  insert into public.notification_outbox(id, daycare_id, recipient_id, channel, kind, title, dedupe_key, payload)
    values(v_id, v_center, v_owner, 'push', 'room_transition_review', 'Rollback move review',
      'rollback-move-owner:' || v_marker, jsonb_build_object('testMarker', v_marker));
  if not exists(select 1 from public.notification_outbox where id = v_id) then
    raise exception 'Owner lost room-move review push';
  end if;
end $$;
rollback;
select 'PASS: saved room-move review reaches eligible administrators only; rolled back' result;
