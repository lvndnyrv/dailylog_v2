-- Rollback-safe Group 10 MFA policy, audit and role-boundary checks.
begin;

create or replace function pg_temp.impersonate(
  p_role text,
  p_user uuid default null,
  p_aal text default 'aal1'
)
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', p_user,
      'role', case when p_role = 'postgres' then 'service_role' else p_role end,
      'aal', p_aal
    )::text,
    true
  );
  perform set_config('role', p_role, true);
end $$;

do $$
declare
  v_owner uuid := '00000000-0000-4000-a000-000000000001';
  v_daycare uuid;
  v_parent uuid;
  v_factor uuid := gen_random_uuid();
begin
  select daycare_id into v_daycare from public.profiles where id = v_owner;
  if v_daycare is null then raise exception 'Missing dev owner fixture'; end if;
  select id into v_parent from public.profiles
  where daycare_id = v_daycare and role = 'parent' limit 1;
  if v_parent is null then raise exception 'Missing dev parent fixture'; end if;

  perform pg_temp.impersonate('authenticated', v_owner, 'aal1');
  begin
    perform public.set_admin_mfa_requirement(true);
    raise exception 'FAIL: AAL1 admin enabled mandatory MFA';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  perform pg_temp.impersonate('authenticated', v_owner, 'aal2');
  perform public.set_admin_mfa_requirement(true);
  if not (select require_admin_mfa from public.daycares where id = v_daycare) then
    raise exception 'FAIL: AAL2 admin could not enable mandatory MFA';
  end if;
  if not exists (
    select 1 from public.audit_log
    where daycare_id = v_daycare and entity_type = 'daycares'
      and after ->> 'require_admin_mfa' = 'true'
  ) then raise exception 'FAIL: MFA requirement change was not audited'; end if;

  perform public.record_account_security_event('mfa_factor_enrolled', v_factor);
  if not exists (
    select 1 from public.audit_log
    where daycare_id = v_daycare and actor_id = v_owner
      and action = 'mfa_factor_enrolled' and entity_type = 'account_security'
      and entity_id = v_factor and after ->> 'assurance_level' = 'aal2'
  ) then raise exception 'FAIL: MFA enrollment event was not audited safely'; end if;

  begin
    perform public.record_account_security_event('arbitrary_client_event', v_factor);
    raise exception 'FAIL: arbitrary security event was accepted';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  perform pg_temp.impersonate('authenticated', v_parent, 'aal2');
  begin
    perform public.set_admin_mfa_requirement(false);
    raise exception 'FAIL: parent changed the admin MFA policy';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  begin
    perform public.record_account_security_event('mfa_challenge_completed', v_factor);
    raise exception 'FAIL: parent wrote an admin security event';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
end $$;

rollback;
select 'PASS: Group 10 MFA enforcement requires AAL2, is audited, and rejects parent or arbitrary events' as result;
