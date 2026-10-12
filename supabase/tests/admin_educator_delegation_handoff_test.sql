-- Owner delegation -> educator effective permissions -> revocation lifecycle.
-- All changes roll back.
begin;
set local statement_timeout = '30s';

create function pg_temp.impersonate(p_role text, p_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('role', p_role, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', p_role)::text, true);
end;
$$;

do $$
declare
  v_owner constant uuid := '00000000-0000-4000-a000-000000000001';
  v_educator constant uuid := '00000000-0000-4000-a000-000000000003';
  v_delegation uuid;
  v_full_admin uuid;
  v_failed boolean;
begin
  perform pg_temp.impersonate('postgres', v_owner);
  update public.staff_delegations
     set revoked_at = coalesce(revoked_at, now()), revoked_by = coalesce(revoked_by, v_owner)
   where delegate_profile_id = v_educator and revoked_at is null and ends_at > now();

  perform pg_temp.impersonate('authenticated', v_educator);
  if public.has_permission('billing', 'approve') then
    raise exception 'FAIL: educator fixture unexpectedly starts with billing approval';
  end if;

  perform pg_temp.impersonate('authenticated', v_owner);
  v_delegation := public.grant_staff_delegation(
    v_educator, 'specific_areas', array['billing'], now() + interval '14 days'
  );
  if not exists (
    select 1 from public.get_staff_delegations() item where item.id = v_delegation
  ) then raise exception 'FAIL: owner register omitted the active delegation'; end if;

  perform pg_temp.impersonate('authenticated', v_educator);
  if not public.has_permission('billing', 'approve') then
    raise exception 'FAIL: explicit billing delegation did not reach the educator';
  end if;
  v_failed := false;
  begin
    perform public.grant_staff_delegation(
      v_owner, 'specific_areas', array['attendance'], now() + interval '1 day'
    );
  exception when others then v_failed := position('owner admin' in lower(sqlerrm)) > 0;
  end;
  if not v_failed then raise exception 'FAIL: educator could grant delegated access'; end if;

  perform pg_temp.impersonate('authenticated', v_owner);
  perform public.revoke_staff_delegation(v_delegation);
  perform pg_temp.impersonate('authenticated', v_educator);
  if public.has_permission('billing', 'approve') then
    raise exception 'FAIL: revoked billing access remained effective';
  end if;

  perform pg_temp.impersonate('authenticated', v_owner);
  v_full_admin := public.grant_staff_delegation(
    v_educator, 'full_admin', '{}', now() + interval '7 days'
  );
  perform pg_temp.impersonate('authenticated', v_educator);
  if not public.has_permission('staff', 'approve') then
    raise exception 'FAIL: full-admin delegation did not grant admin operations';
  end if;
  if public.has_permission('billing', 'view') then
    raise exception 'FAIL: full-admin delegation silently included billing';
  end if;

  perform pg_temp.impersonate('authenticated', v_owner);
  if not exists (
    select 1 from public.audit_log audit
     where audit.entity_type = 'staff_delegations'
       and audit.actor_id = v_owner
       and audit.entity_id in (v_delegation, v_full_admin)
  ) then raise exception 'FAIL: delegation lifecycle was not audited'; end if;

  v_failed := false;
  begin
    perform public.grant_staff_delegation(
      '00000000-0000-4000-a000-000000000007',
      'specific_areas', array['attendance'], now() + interval '1 year 1 day'
    );
  exception when others then v_failed := position('one year' in lower(sqlerrm)) > 0;
  end;
  if not v_failed then raise exception 'FAIL: delegation longer than one year was accepted'; end if;

  raise notice 'PASS: owner grants, educator scope, billing exclusion, expiry, audit, and revocation are intact';
end;
$$;

rollback;
select 'ADMIN/EDUCATOR DELEGATION HANDOFF TESTS: ALL PASSED' as result;
