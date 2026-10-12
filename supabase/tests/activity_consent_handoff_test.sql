-- Parent -> classroom activity-consent handoff and photo enforcement.
-- All mutations roll back.
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
  v_daycare constant uuid := '10000000-0000-4000-a000-000000000001';
  v_parent constant uuid := '00000000-0000-4000-a000-000000000023';
  v_educator constant uuid := '00000000-0000-4000-a000-000000000003';
  v_owner constant uuid := '00000000-0000-4000-a000-000000000001';
  v_child constant uuid := '30000000-0000-4000-a000-000000000013';
  v_log uuid;
  v_failed boolean;
begin
  perform pg_temp.impersonate('postgres');
  update public.children set archived_at = null where id = v_child;
  insert into public.daily_logs (daycare_id, child_id, educator_id, log_date)
  values (v_daycare, v_child, v_educator, current_date)
  on conflict (child_id, log_date) do update set educator_id = excluded.educator_id
  returning id into v_log;

  perform pg_temp.impersonate('authenticated', v_parent);
  perform public.set_mobile_parent_consent(v_child, 'Photo & media consent', false);

  perform pg_temp.impersonate('postgres');
  if not exists (
    select 1 from public.audit_log audit
     where audit.actor_id = v_parent and audit.entity_type = 'consents'
       and audit.after->>'child_id' = v_child::text
       and (audit.after->>'granted')::boolean = false
  ) then
    raise exception 'FAIL: activity consent change was not audited';
  end if;
  if not exists (
    select 1 from public.notifications notification
     where notification.profile_id = v_owner
       and notification.payload->>'type' = 'activity_consent'
       and notification.payload->>'screen' = 'ChildConsents'
       and notification.payload->>'childId' = v_child::text
  ) then
    raise exception 'FAIL: center owner did not receive the scoped consent update';
  end if;
  if not exists (
    select 1 from public.notifications notification
     where notification.profile_id = v_educator
       and notification.payload->>'type' = 'activity_consent'
       and notification.payload->>'childId' = v_child::text
  ) then
    raise exception 'FAIL: assigned educator did not receive the consent update';
  end if;

  perform pg_temp.impersonate('authenticated', v_educator);
  v_failed := false;
  begin
    insert into public.photos (daily_log_id, storage_path)
    values (v_log, 'rollback/declined-photo.jpg');
  exception when others then
    v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL: photo was accepted after consent was declined'; end if;

  perform pg_temp.impersonate('authenticated', v_parent);
  perform public.set_mobile_parent_consent(v_child, 'Photo & media consent', true);
  perform pg_temp.impersonate('postgres');
  insert into storage.objects (bucket_id, name, owner, owner_id)
  values (
    'daily-log-photos',
    v_child::text || '/' || v_log::text || '/rollback-allowed-photo.jpg',
    v_educator,
    v_educator::text
  );
  perform pg_temp.impersonate('authenticated', v_educator);
  insert into public.photos (daily_log_id, storage_path)
  values (
    v_log,
    v_child::text || '/' || v_log::text || '/rollback-allowed-photo.jpg'
  );

  raise notice 'PASS: consent is audited, reaches the classroom, and gates photos immediately';
end;
$$;

rollback;
select 'ACTIVITY CONSENT HANDOFF TESTS: ALL PASSED' as result;
