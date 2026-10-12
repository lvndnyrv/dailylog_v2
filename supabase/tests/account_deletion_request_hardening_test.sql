-- Rollback-safe coverage for parent routing, staff request review and self-review guard.
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
  v_admin constant uuid := '00000000-0000-4000-a000-000000000002';
  v_educator constant uuid := '00000000-0000-4000-a000-000000000003';
  v_parent constant uuid := '00000000-0000-4000-a000-000000000021';
  v_result jsonb;
  v_request_id uuid;
begin
  perform pg_temp.impersonate('authenticated', v_parent);
  v_result := public.request_my_account_deletion();
  if v_result->>'source' <> 'parent'
     or not exists (
       select 1 from public.parent_data_requests
       where id = (v_result->>'id')::uuid and profile_id = v_parent and request_type = 'deletion'
     ) then
    raise exception 'FAIL: parent deletion did not use the regulated parent request flow: %', v_result;
  end if;

  perform pg_temp.impersonate('authenticated', v_educator);
  begin
    perform public.delete_my_account();
    raise exception 'FAIL: legacy immediate deletion RPC remained executable';
  exception when insufficient_privilege then
    null;
  end;
  v_result := public.request_my_account_deletion();
  v_request_id := (v_result->>'id')::uuid;
  if v_result->>'source' <> 'account' or v_result->>'role' <> 'educator' then
    raise exception 'FAIL: educator request was not recorded: %', v_result;
  end if;

  perform pg_temp.impersonate('authenticated', v_owner);
  v_result := public.transition_account_deletion_request(
    v_request_id, 'requested', 'processing', 'Identity verified.'
  );
  if v_result->>'status' <> 'processing'
     or (v_result->>'handled_by')::uuid <> v_owner then
    raise exception 'FAIL: center owner could not start review: %', v_result;
  end if;

  perform pg_temp.impersonate('authenticated', v_admin);
  v_result := public.transition_account_deletion_request(
    v_request_id, 'processing', 'completed', null
  );
  if v_result->>'status' <> 'completed' or v_result->>'completed_at' is null then
    raise exception 'FAIL: second admin could not complete review: %', v_result;
  end if;

  perform pg_temp.impersonate('authenticated', v_owner);
  v_result := public.request_my_account_deletion();
  begin
    perform public.transition_account_deletion_request(
      (v_result->>'id')::uuid, 'requested', 'processing', null
    );
    raise exception 'FAIL: owner reviewed their own closure request';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  perform pg_temp.impersonate('postgres');
  if (select count(*) from public.audit_log
      where entity_type = 'account_deletion_requests'
        and entity_id = v_request_id) < 3 then
    raise exception 'FAIL: request lifecycle was not retained in the audit log';
  end if;
end $$;

rollback;
select 'PASS: account deletion requests are role-aware, reviewable and protected from self-approval' as result;
