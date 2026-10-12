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
end;
$$;

do $$
declare
  v_owner uuid := '00000000-0000-4000-a000-000000000001';
  v_restricted uuid := '00000000-0000-4000-a000-000000000008';
  v_daycare uuid;
  v_role uuid;
  v_health jsonb;
begin
  select daycare_id into v_daycare from public.profiles where id = v_owner;
  if v_daycare is null then raise exception 'Missing dev owner fixture'; end if;

  perform pg_temp.impersonate('postgres');
  insert into public.push_tokens(
    user_id, token, platform, last_seen_at, device_model, app_version, is_physical
  ) values (
    v_owner, 'ExponentPushToken[rollback-reachability]', 'ios', now(),
    'Rollback iPhone', '1.0.0', true
  );

  perform pg_temp.impersonate('authenticated', v_owner);
  v_health := public.get_push_delivery_reachability();
  if (v_health #>> '{counts,pushReady}')::integer < 1 then
    raise exception 'FAIL: registered device is not counted';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_health -> 'gaps') row
    where row ->> 'profileId' = v_owner::text
  ) then raise exception 'FAIL: push-ready profile appears as a gap'; end if;

  perform pg_temp.impersonate('postgres');
  insert into public.center_roles(daycare_id, name, base_role, permissions)
  values(
    v_daycare, 'Rollback-only reach restriction', 'admin',
    '{"reports":{"view":true},"children":{"view":false},"staff":{"view":false}}'
  ) returning id into v_role;
  update public.profiles set role = 'admin', center_role_id = v_role where id = v_restricted;

  perform pg_temp.impersonate('authenticated', v_restricted);
  v_health := public.get_push_delivery_reachability();
  if (v_health #>> '{counts,total}')::integer <> 0 then
    raise exception 'FAIL: restricted admin sees account reachability';
  end if;
end;
$$;

rollback;
select 'PASS: push reachability is current, actionable and permission-scoped' as result;
