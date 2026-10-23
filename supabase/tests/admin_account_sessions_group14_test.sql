-- Rollback-only checks for Group 14 session visibility and completion audit.
begin;

do $$
declare
  v_owner uuid := '00000000-0000-4000-a000-000000000001';
  v_educator uuid := '00000000-0000-4000-a000-000000000003';
  v_owner_session uuid := gen_random_uuid();
  v_educator_session uuid := gen_random_uuid();
  v_educator_denied boolean := false;
begin
  if has_function_privilege('anon', 'public.list_my_admin_sessions()', 'execute') then
    raise exception 'FAIL: anonymous callers can list account sessions';
  end if;

  insert into auth.sessions (id, user_id, created_at, updated_at, user_agent, ip)
  values (v_owner_session, v_owner, now(), now(), 'Group 14 test browser', '192.0.2.1'::inet),
         (v_educator_session, v_educator, now(), now(), 'Group 14 test phone', '192.0.2.2'::inet);

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_owner, 'role', 'authenticated', 'session_id', v_owner_session
  )::text, true);
  execute 'set local role authenticated';

  if not exists (
    select 1 from public.list_my_admin_sessions() s
    where s.session_id = v_owner_session and s.is_current
      and split_part(s.ip_address, '/', 1) = '192.0.2.1'
  ) then
    raise exception 'FAIL: own current session is missing';
  end if;
  if exists (
    select 1 from public.list_my_admin_sessions() s where s.session_id = v_educator_session
  ) then
    raise exception 'FAIL: another user session leaked';
  end if;

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_educator, 'role', 'authenticated', 'session_id', v_educator_session
  )::text, true);
  begin
    perform 1 from public.list_my_admin_sessions();
  exception when others then
    v_educator_denied := true;
  end;
  if not v_educator_denied then
    raise exception 'FAIL: an educator could list admin sessions';
  end if;

  execute 'reset role';
  delete from auth.sessions where id in (v_owner_session, v_educator_session);
  if not exists (
    select 1 from public.audit_log a
    where a.entity_id = v_owner_session and a.action = 'session_ended'
      and a.entity_type = 'account_security' and a.actor_id = v_owner
      and split_part(a.after ->> 'ip_address', '/', 1) = '192.0.2.1'
  ) then
    raise exception 'FAIL: ended admin session was not audited';
  end if;
  if exists (
    select 1 from public.audit_log a
    where a.entity_id = v_educator_session and a.action = 'session_ended'
  ) then
    raise exception 'FAIL: educator session entered the admin audit log';
  end if;
end;
$$;

rollback;
select 'PASS: own-session boundary and admin session-end audit' as result;
