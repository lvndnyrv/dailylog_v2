-- Group 4e invariant: role defaults can be refined for one educator globally
-- or in one permanently assigned room; exact-room changes win and are audited.

begin;

do $$
declare
  v_owner uuid := '00000000-0000-4000-a000-000000000001';
  v_admin uuid := '00000000-0000-4000-a000-000000000002';
  v_educator uuid := '00000000-0000-4000-a000-000000000007';
  v_room uuid := '20000000-0000-4000-a000-000000000003';
  v_child uuid := '30000000-0000-4000-a000-000000000002';
  v_blocked boolean := false;
begin
  insert into public.educator_classrooms (educator_id, classroom_id)
  values (v_educator, v_room)
  on conflict do nothing;

  perform set_config('request.jwt.claim.sub', v_educator::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;

  if public.has_permission('reports', 'view') then
    raise exception 'FAIL: floater unexpectedly inherited report access';
  end if;
  if not public.has_permission_for_classroom('daily_logs', 'edit', v_room) then
    raise exception 'FAIL: floater role default did not allow room log editing';
  end if;
  if not public.can_access_child_area(v_child, 'daily_logs', 'edit') then
    raise exception 'FAIL: permanently assigned educator could not edit room logs';
  end if;

  reset role;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;

  perform public.save_staff_permission_override(
    v_educator, null, '{"reports":{"view":true}}'::jsonb
  );
  perform public.save_staff_permission_override(
    v_educator, v_room, '{"daily_logs":{"edit":false}}'::jsonb
  );

  reset role;
  perform set_config('request.jwt.claim.sub', v_educator::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;

  if not public.has_permission('reports', 'view') then
    raise exception 'FAIL: global personal override was not applied';
  end if;
  if public.has_permission_for_classroom('daily_logs', 'edit', v_room) then
    raise exception 'FAIL: room override did not win over role defaults';
  end if;
  if public.can_access_child_area(v_child, 'daily_logs', 'edit') then
    raise exception 'FAIL: operational child access bypassed the room override';
  end if;

  begin
    perform public.save_staff_permission_override(
      v_educator, null, '{"billing":{"view":true}}'::jsonb
    );
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'FAIL: educator could change their own permissions';
  end if;

  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  v_blocked := false;
  begin
    perform public.save_staff_permission_override(
      v_admin, null, '{"billing":{"view":false}}'::jsonb
    );
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'FAIL: delegated administrator could edit their own access';
  end if;

  reset role;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;

  if not exists (
    select 1 from public.audit_log audit
     where audit.entity_type = 'staff_permission_overrides'
       and audit.actor_id = v_owner
       and audit.after ->> 'profile_id' = v_educator::text
  ) then
    raise exception 'FAIL: override update was not recorded in the audit trail';
  end if;

  perform public.save_staff_permission_override(v_educator, v_room, '{}'::jsonb);
  perform public.save_staff_permission_override(v_educator, null, '{}'::jsonb);

  reset role;
  perform set_config('request.jwt.claim.sub', v_educator::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;

  if not public.has_permission_for_classroom('daily_logs', 'edit', v_room) then
    raise exception 'FAIL: resetting the room did not restore role inheritance';
  end if;
  if public.has_permission('reports', 'view') then
    raise exception 'FAIL: resetting the global scope did not restore role inheritance';
  end if;

  raise notice 'PASS: global and room overrides, enforcement, self-service guard, reset, and audit trail are intact';
end;
$$;

rollback;
