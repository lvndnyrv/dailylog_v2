-- Rollback-safe public release configuration and write-boundary checks.
begin;

do $$
declare
  v_config jsonb;
  v_count integer;
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);

  v_config := public.get_mobile_release_config();
  if v_config->>'minimumVersion' <> '1.0.0'
     or v_config->>'recommendedVersion' <> '1.0.0' then
    raise exception 'FAIL: anonymous release configuration is incomplete: %', v_config;
  end if;

  select count(*) into v_count
    from public.app_config where key = 'min_app_version';
  if v_count <> 0 then
    raise exception 'FAIL: anonymous users can read the underlying app_config table';
  end if;

  update public.app_config set value = to_jsonb('99.0.0'::text)
   where key = 'min_app_version';
  get diagnostics v_count = row_count;
  if v_count <> 0 then
    raise exception 'FAIL: anonymous users can change mobile compatibility';
  end if;
end $$;

rollback;
select 'PASS: mobile release compatibility is public, narrow and read-only' as result;
