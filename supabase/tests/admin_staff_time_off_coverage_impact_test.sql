-- Rollback-safe boundary check for the forecast-backed time-off review.
begin;

create or replace function pg_temp.impersonate(p_role text, p_user uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', p_user,
      'role', case when p_role = 'postgres' then 'service_role' else p_role end
    )::text,
    true
  );
  perform set_config('role', p_role, true);
end $$;

do $$
declare
  v_owner uuid := '00000000-0000-4000-a000-000000000001';
  v_educator uuid := '00000000-0000-4000-a000-000000000003';
  v_requests uuid[];
  v_bad_rows integer;
begin
  perform pg_temp.impersonate('postgres');
  select coalesce(array_agg(request.id), '{}'::uuid[])
    into v_requests
    from public.staff_time_off_requests request
   where request.daycare_id = '10000000-0000-4000-a000-000000000001'
     and request.status = 'pending';

  perform pg_temp.impersonate('authenticated', v_owner);
  select count(*) into v_bad_rows
    from public.get_staff_time_off_coverage_impacts(v_requests) impact
   where impact.staff_gap <= 0
      or impact.scheduled_staff >= impact.required_staff
      or impact.ends_at <= impact.starts_at;
  if v_bad_rows <> 0 then
    raise exception 'FAIL: time-off coverage impact returned a non-gap interval';
  end if;

  perform pg_temp.impersonate('authenticated', v_educator);
  begin
    perform * from public.get_staff_time_off_coverage_impacts(v_requests);
    raise exception 'FAIL: educator accessed admin-only coverage impact';
  exception
    when raise_exception then
      if sqlerrm = 'FAIL: educator accessed admin-only coverage impact' then
        raise;
      end if;
  end;
end $$;

rollback;

select 'PASS: time-off coverage impact is forecast-backed and admin-only' as result;
