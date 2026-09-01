-- Admin/educator authority handoff tests.
-- Rollback-safe and uses the canonical Sunny Grove fixture identities.
begin;

create or replace function pg_temp.impersonate(p_role text, p_user_id uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('role', p_role, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id, 'role', p_role)::text,
    true
  );
end;
$$;

do $$
declare
  v_owner uuid := '00000000-0000-4000-a000-000000000001';
  v_educator uuid := '00000000-0000-4000-a000-000000000003';
  v_other_educator uuid := '00000000-0000-4000-a000-000000000004';
  v_delegation uuid;
  v_full_delegation uuid;
  v_failed boolean := false;
  v_count integer;
begin
  -- Start with a deterministic register without changing persistent data.
  perform pg_temp.impersonate('postgres');
  update public.staff_delegations
     set revoked_at = coalesce(revoked_at, now()),
         revoked_by = coalesce(revoked_by, v_owner)
   where delegate_profile_id in (v_educator, v_other_educator)
     and revoked_at is null
     and ends_at > now();

  perform pg_temp.impersonate('authenticated', v_educator);
  if public.has_permission('billing', 'view') then
    raise exception 'FAIL: educator unexpectedly starts with billing access';
  end if;

  begin
    perform public.grant_staff_delegation(
      v_other_educator,
      'specific_areas',
      array['attendance'],
      now() + interval '1 day'
    );
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: educator granted delegated authority';
  end if;
  raise notice 'PASS: only the owner can grant delegated authority';

  perform pg_temp.impersonate('authenticated', v_owner);
  v_delegation := public.grant_staff_delegation(
    v_educator,
    'specific_areas',
    array['billing', 'billing', 'not-a-real-area'],
    now() + interval '1 day'
  );

  select count(*) into v_count
    from public.get_staff_delegations() register
   where register.id = v_delegation
     and register.delegate_profile_id = v_educator
     and register.access_level = 'specific_areas'
     and register.areas = array['billing']::text[];
  if v_count <> 1 then
    raise exception 'FAIL: owner delegation register did not expose the normalized grant';
  end if;
  raise notice 'PASS: owner can grant and inspect a normalized scoped delegation';

  perform pg_temp.impersonate('authenticated', v_educator);
  if not public.has_permission('billing', 'view')
     or not public.has_permission('billing', 'approve')
     or public.has_permission('staff', 'approve') then
    raise exception 'FAIL: scoped delegation escaped its billing boundary';
  end if;
  raise notice 'PASS: scoped delegation augments only the selected area';

  perform pg_temp.impersonate('authenticated', v_owner);
  perform public.revoke_staff_delegation(v_delegation);

  perform pg_temp.impersonate('authenticated', v_educator);
  if public.has_permission('billing', 'view') then
    raise exception 'FAIL: revoked delegation still grants billing access';
  end if;
  raise notice 'PASS: revoked delegated authority is removed immediately';

  perform pg_temp.impersonate('authenticated', v_owner);
  v_full_delegation := public.grant_staff_delegation(
    v_other_educator,
    'full_admin',
    '{}'::text[],
    now() + interval '1 day'
  );

  perform pg_temp.impersonate('authenticated', v_other_educator);
  if not public.has_permission('staff', 'approve')
     or public.has_permission('billing', 'view') then
    raise exception 'FAIL: full delegation did not preserve the billing exclusion';
  end if;
  raise notice 'PASS: full delegated admin access intentionally excludes billing';

  perform pg_temp.impersonate('authenticated', v_owner);
  perform public.revoke_staff_delegation(v_full_delegation);

  perform pg_temp.impersonate('authenticated', v_educator);
  begin
    perform * from public.get_staff_delegations();
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: educator viewed the owner delegation register';
  end if;
  raise notice 'PASS: delegation history remains owner-only';
end;
$$;

rollback;
select 'ADMIN/EDUCATOR AUTHORITY TESTS: ALL PASSED' as result;
