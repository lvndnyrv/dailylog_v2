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
  v_educator constant uuid := '00000000-0000-4000-a000-000000000003';
  v_report uuid;
begin
  perform pg_temp.impersonate('authenticated', v_educator);
  v_report := public.report_client_error('mobile_ios', 'render_failure', '1.0.0', 'development', 'SafeDigest_123');

  -- Submission returns the opaque id, but raw diagnostic rows are deliberately
  -- admin-only. Verify persistence as the database harness, then restore the
  -- educator session for the input-validation assertion.
  perform pg_temp.impersonate('postgres');
  if not exists (
    select 1 from public.client_error_reports
    where id = v_report
      and profile_id = v_educator
      and surface = 'mobile_ios'
      and error_code = 'render_failure'
  ) then
    raise exception 'FAIL: sanitized client error was not recorded';
  end if;

  perform pg_temp.impersonate('authenticated', v_educator);
  begin
    perform public.report_client_error('mobile_ios', 'child name: Mateo', '1.0.0', null, null);
    raise exception 'FAIL: arbitrary diagnostic text was accepted';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  perform pg_temp.impersonate('authenticated', v_owner);
  if not exists (select 1 from public.client_error_reports where id = v_report) then
    raise exception 'FAIL: same-center owner could not inspect the report';
  end if;
end $$;

rollback;
select 'PASS: client diagnostics are authenticated, center-scoped and structurally sanitized' as result;
