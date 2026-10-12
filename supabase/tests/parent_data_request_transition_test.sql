-- Rollback-safe privacy-request transition, notification and role-boundary checks.
begin;

create or replace function pg_temp.impersonate(p_role text, p_user uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user, 'role', case when p_role = 'postgres' then 'service_role' else p_role end)::text,
    true
  );
  perform set_config('role', p_role, true);
end $$;

do $$
declare
  v_owner constant uuid := '00000000-0000-4000-a000-000000000001';
  v_parent constant uuid := '00000000-0000-4000-a000-000000000021';
  v_request jsonb;
  v_request_id uuid;
  v_result jsonb;
begin
  perform pg_temp.impersonate('authenticated', v_parent);
  v_request := public.request_parent_data_action('export');
  v_request_id := (v_request->>'id')::uuid;

  perform pg_temp.impersonate('authenticated', v_owner);
  v_result := public.transition_parent_data_request(
    v_request_id, 'requested', 'processing', 'Identity checked for rollback test.'
  );
  if v_result->>'status' <> 'processing'
     or (v_result->>'handled_by')::uuid <> v_owner
     or v_result->>'notes' <> 'Identity checked for rollback test.' then
    raise exception 'FAIL: review start was not recorded atomically: %', v_result;
  end if;

  v_result := public.transition_parent_data_request(
    v_request_id, 'processing', 'completed', null
  );
  if v_result->>'status' <> 'completed'
     or v_result->>'completed_at' is null
     or v_result->>'notes' <> 'Identity checked for rollback test.' then
    raise exception 'FAIL: completion did not preserve handling details: %', v_result;
  end if;

  perform pg_temp.impersonate('postgres');
  if (select count(*) from public.notifications
      where profile_id = v_parent
        and kind = 'parent_data_request'
        and payload->>'requestId' = v_request_id::text
        and payload->>'status' in ('processing', 'completed')) <> 2 then
    raise exception 'FAIL: parent did not receive both privacy status updates';
  end if;

  if (select count(*) from public.audit_log
      where actor_id = v_owner
        and entity_type = 'parent_data_requests'
        and entity_id = v_request_id
        and action = 'update') <> 2 then
    raise exception 'FAIL: admin privacy transitions were not attributed in the audit log';
  end if;

  perform pg_temp.impersonate('authenticated', v_owner);
  begin
    perform public.transition_parent_data_request(v_request_id, 'processing', 'completed', null);
    raise exception 'FAIL: stale transition succeeded';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  perform pg_temp.impersonate('authenticated', v_parent);
  begin
    perform public.transition_parent_data_request(v_request_id, 'completed', 'processing', null);
    raise exception 'FAIL: parent advanced a privacy request';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
end $$;

rollback;
select 'PASS: privacy requests transition atomically, notify parents, retain notes and enforce admin boundaries' as result;
