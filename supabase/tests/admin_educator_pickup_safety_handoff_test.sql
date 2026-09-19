-- Cross-app invariant: an educator can report a blocked pickup for a child in
-- their room, only effective attendance approvers are notified and can close
-- it, and the reporting educator receives the resolution acknowledgement.

begin;

create or replace function pg_temp.impersonate(p_role text, p_user_id uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('role', p_role, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', p_user_id,
      'role', case when p_role = 'postgres' then 'service_role' else p_role end
    )::text,
    true
  );
end;
$$;

do $$
declare
  v_owner uuid := '00000000-0000-4000-a000-000000000001';
  v_educator uuid := '00000000-0000-4000-a000-000000000003';
  v_restricted uuid := '00000000-0000-4000-a000-000000000008';
  v_child uuid := '30000000-0000-4000-a000-000000000004';
  v_daycare uuid;
  v_role uuid;
  v_educator_role uuid;
  v_event uuid;
  v_count integer;
begin
  perform pg_temp.impersonate('postgres');
  select daycare_id into v_daycare from public.profiles where id = v_owner;
  insert into public.center_roles (daycare_id, name, base_role, permissions)
  values (
    v_daycare,
    'Rollback-only no pickup approval',
    'admin',
    '{"attendance":{"view":true,"edit":false,"approve":false}}'
  ) returning id into v_role;
  update public.profiles
     set role = 'admin', center_role_id = v_role, archived_at = null
   where id = v_restricted;
  insert into public.center_roles (daycare_id, name, base_role, permissions)
  values (
    v_daycare,
    'Rollback-only pickup reporter',
    'educator',
    '{"attendance":{"view":true,"edit":true,"approve":false}}'
  ) returning id into v_educator_role;
  update public.profiles
     set role = 'educator', center_role_id = v_educator_role, archived_at = null
   where id = v_educator;
  -- Seed data may include active delegations. Remove them inside this rollback
  -- test so these two profiles exercise their base-role permission boundary.
  update public.staff_delegations
     set revoked_at = now()
   where delegate_profile_id in (v_educator, v_restricted)
     and revoked_at is null;

  perform pg_temp.impersonate('authenticated', v_educator);
  v_event := public.report_unauthorized_pickup(
    v_child,
    'Integration visitor',
    'No valid pickup pass; child remained with staff.'
  );

  if not exists (
    select 1
      from public.pickup_security_events event
     where event.id = v_event
       and event.reported_by = v_educator
       and event.status = 'open'
  ) then
    raise exception 'FAIL: educator pickup report was not recorded';
  end if;

  perform pg_temp.impersonate('postgres');
  if not exists (
    select 1
      from public.notifications notification
     where notification.profile_id = v_owner
       and notification.kind = 'pickup_security'
       and notification.payload ->> 'childId' = v_child::text
       and notification.payload ->> 'eventId' = v_event::text
  ) then
    raise exception 'FAIL: owner pickup alert was not created or routable';
  end if;
  if exists (
    select 1
      from public.notifications notification
     where notification.profile_id = v_restricted
       and notification.kind = 'pickup_security'
       and notification.payload ->> 'eventId' = v_event::text
  ) then
    raise exception 'FAIL: restricted admin received an unusable pickup alert';
  end if;

  perform pg_temp.impersonate('authenticated', v_educator);
  with changed as (
    update public.pickup_security_events
       set status = 'resolved', resolved_by = v_educator, resolved_at = now()
     where id = v_event
     returning id
  )
  select count(*) into v_count from changed;
  if v_count <> 0 then
    raise exception 'FAIL: educator resolved an admin-only security event';
  end if;

  perform pg_temp.impersonate('authenticated', v_restricted);
  with changed as (
    update public.pickup_security_events
       set status = 'resolved', resolved_by = v_restricted, resolved_at = now()
     where id = v_event
     returning id
  )
  select count(*) into v_count from changed;
  if v_count <> 0 then
    raise exception 'FAIL: restricted admin resolved a pickup security event';
  end if;

  perform pg_temp.impersonate('authenticated', v_owner);
  with changed as (
    update public.pickup_security_events
       set status = 'resolved', resolved_by = v_owner, resolved_at = now()
     where id = v_event and status = 'open'
     returning id
  )
  select count(*) into v_count from changed;
  if v_count <> 1 then
    raise exception 'FAIL: owner could not resolve the pickup security event';
  end if;

  if not exists (
    select 1
      from public.pickup_security_events event
     where event.id = v_event
       and event.status = 'resolved'
       and event.resolved_by = v_owner
       and event.resolved_at is not null
  ) then
    raise exception 'FAIL: pickup resolution did not preserve owner identity';
  end if;

  perform pg_temp.impersonate('postgres');
  if not exists (
    select 1
      from public.notifications notification
     where notification.profile_id = v_educator
       and notification.kind = 'pickup_security_resolved'
       and notification.payload ->> 'eventId' = v_event::text
       and notification.payload ->> 'screen' = 'Pickups'
  ) then
    raise exception 'FAIL: reporting educator did not receive a routable resolution acknowledgement';
  end if;

  raise notice 'PASS: educator report, permission-aware owner review, and resolution acknowledgement are intact';
end;
$$;

rollback;

select 'ADMIN/EDUCATOR PICKUP SAFETY TESTS: ALL PASSED' as result;
