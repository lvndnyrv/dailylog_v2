-- Rollback-safe family/staff sick-return policy visibility and isolation test.
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
  v_daycare constant uuid := '10000000-0000-4000-a000-000000000001';
  v_parent constant uuid := '00000000-0000-4000-a000-000000000023';
  v_owner constant uuid := '00000000-0000-4000-a000-000000000001';
  v_restricted constant uuid := '00000000-0000-4000-a000-000000000008';
  v_child constant uuid := '30000000-0000-4000-a000-000000000013';
  v_foreign_child constant uuid := '30000000-0000-4000-a000-000000000002';
  v_role uuid;
  v_policy jsonb;
  v_failed boolean;
begin
  perform pg_temp.impersonate('postgres');
  update public.daycares set sick_return_hours = 36 where id = v_daycare;
  update public.children set archived_at = null where id = v_child;

  insert into public.center_roles (daycare_id, name, base_role, permissions)
  values (
    v_daycare,
    'Rollback-only no attendance policy access',
    'admin',
    '{"attendance":{"view":false,"edit":false,"approve":false}}'
  ) returning id into v_role;

  -- Role assignments are intentionally guarded. Perform this fixture change as
  -- the center owner so the test follows the same approval boundary as the app.
  perform pg_temp.impersonate('authenticated', v_owner);
  update public.profiles
     set role = 'admin', center_role_id = v_role, archived_at = null
   where id = v_restricted;

  perform pg_temp.impersonate('postgres');
  update public.staff_delegations
     set revoked_at = now()
   where delegate_profile_id = v_restricted and revoked_at is null;

  perform pg_temp.impersonate('authenticated', v_parent);
  v_policy := public.get_child_absence_policy(v_child);
  if (v_policy->>'sickReturnHours')::integer <> 36
     or v_policy->>'daycareName' is null then
    raise exception 'FAIL: linked family did not receive the center return rule: %', v_policy;
  end if;

  perform pg_temp.impersonate('authenticated', v_owner);
  v_policy := public.get_child_absence_policy(v_child);
  if (v_policy->>'sickReturnHours')::integer <> 36 then
    raise exception 'FAIL: authorized attendance viewer did not receive the return rule';
  end if;

  perform pg_temp.impersonate('authenticated', v_restricted);
  v_failed := false;
  begin
    perform public.get_child_absence_policy(v_child);
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: restricted administrator read the attendance policy handoff';
  end if;

  perform pg_temp.impersonate('authenticated', v_parent);
  v_failed := false;
  begin
    perform public.get_child_absence_policy(v_foreign_child);
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: family read another child''s absence policy';
  end if;
end;
$$;

rollback;
select 'PASS: sick-return policy reaches linked families and authorized staff only' as result;
