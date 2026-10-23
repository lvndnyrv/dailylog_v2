begin;

do $$
declare
  v_owner uuid := '00000000-0000-4000-a000-000000000001';
  v_other uuid := '00000000-0000-4000-a000-000000000003';
  v_current uuid := gen_random_uuid();
  v_target uuid := gen_random_uuid();
  v_foreign uuid := gen_random_uuid();
  v_denied boolean := false;
  v_educator_denied boolean := false;
begin
  if has_function_privilege('anon', 'public.end_my_admin_session(uuid)', 'execute') then
    raise exception 'FAIL: anonymous session revocation allowed';
  end if;

  insert into auth.sessions (id, user_id, created_at, updated_at)
  values (v_current, v_owner, now(), now()),
         (v_target, v_owner, now(), now()),
         (v_foreign, v_other, now(), now());

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_owner, 'role', 'authenticated', 'session_id', v_current
  )::text, true);
  execute 'set local role authenticated';

  begin
    perform public.end_my_admin_session(v_current);
  exception when others then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'FAIL: current session could be ended';
  end if;
  if public.end_my_admin_session(v_foreign) then
    raise exception 'FAIL: foreign session could be ended';
  end if;
  if not public.end_my_admin_session(v_target) then
    raise exception 'FAIL: own other session was not ended';
  end if;
  execute 'reset role';
  if not exists (select 1 from auth.sessions where id = v_current) then
    raise exception 'FAIL: current session was removed';
  end if;
  if not exists (select 1 from auth.sessions where id = v_foreign) then
    raise exception 'FAIL: foreign session was removed';
  end if;
  if exists (select 1 from auth.sessions where id = v_target) then
    raise exception 'FAIL: ended session remains';
  end if;
  if not exists (
    select 1 from public.audit_log
    where actor_id = v_owner and entity_id = v_target and action = 'session_ended'
  ) then
    raise exception 'FAIL: session end was not audited';
  end if;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_other, 'role', 'authenticated', 'session_id', v_foreign
  )::text, true);
  execute 'set local role authenticated';
  begin
    perform public.end_my_admin_session(v_current);
  exception when others then
    v_educator_denied := true;
  end;
  if not v_educator_denied then
    raise exception 'FAIL: educator could revoke admin sessions';
  end if;
  execute 'reset role';

end;
$$;

rollback;
select 'PASS: own other-session revocation and audit' as result;
