-- Staff-role permission hierarchy, locked-role protection, and audit history.
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
  v_center constant uuid := '10000000-0000-4000-a000-000000000001';
  v_owner constant uuid := '00000000-0000-4000-a000-000000000001';
  v_educator constant uuid := '00000000-0000-4000-a000-000000000003';
  v_role uuid;
  v_locked uuid;
  v_failed boolean;
  v_count integer;
begin
  perform pg_temp.impersonate('authenticated', v_owner);
  insert into public.center_roles (
    daycare_id, name, description, base_role, permissions, sort
  ) values (
    v_center,
    ' Rollback role integrity ',
    ' Role used only by the rollback suite ',
    'educator',
    '{"attendance":{"view":false,"edit":true,"approve":false},"unknown":{"view":true}}'::jsonb,
    999
  ) returning id into v_role;

  if not exists (
    select 1 from public.center_roles role
     where role.id = v_role
       and role.name = 'Rollback role integrity'
       and role.permissions->'attendance'->>'view' = 'true'
       and role.permissions->'attendance'->>'edit' = 'true'
       and not role.permissions ? 'unknown'
  ) then raise exception 'FAIL: role permissions were not normalized into a usable matrix'; end if;
  if not exists (
    select 1 from public.audit_log audit
     where audit.entity_type = 'center_roles'
       and audit.entity_id = v_role
       and audit.actor_id = v_owner
       and audit.action = 'insert'
  ) then raise exception 'FAIL: role creation was not recorded in the security audit'; end if;

  select id into v_locked from public.center_roles
   where daycare_id = v_center and is_locked order by sort limit 1;
  update public.center_roles set name = 'Changed locked role' where id = v_locked;
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'FAIL: owner changed a locked system role'; end if;

  perform pg_temp.impersonate('authenticated', v_educator);
  v_failed := false;
  begin
    insert into public.center_roles (
      daycare_id, name, base_role, permissions
    ) values (v_center, 'Unauthorized role', 'educator', '{}'::jsonb);
  exception when insufficient_privilege then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL: educator created a center role'; end if;

  raise notice 'PASS: permission hierarchy, unknown-key removal, locked roles, access control, and audit are intact';
end;
$$;

rollback;
select 'ADMIN STAFF ROLE INTEGRITY TESTS: ALL PASSED' as result;
