-- Cross-app invariant: an educator can report a blocked pickup for a child in
-- their room, the owner is notified with a routable payload, and only an admin
-- can resolve the security event.

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
  v_child uuid := '30000000-0000-4000-a000-000000000004';
  v_event uuid;
  v_count integer;
begin
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

  raise notice 'PASS: educator report, owner routing, and admin-only resolution are intact';
end;
$$;

rollback;

select 'ADMIN/EDUCATOR PICKUP SAFETY TESTS: ALL PASSED' as result;
