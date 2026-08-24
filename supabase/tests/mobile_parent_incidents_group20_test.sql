-- Parent Mobile Group 20 acknowledgment identity, evidence and isolation tests.
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
  v_child constant uuid := '30000000-0000-4000-a000-000000000013';
  v_foreign_parent constant uuid := '00000000-0000-4000-a000-000000000021';
  v_incident uuid := gen_random_uuid();
  v_reporter uuid;
  v_director uuid;
  v_result jsonb;
  v_retry jsonb;
  v_failed boolean;
begin
  perform pg_temp.impersonate('postgres');
  select id into v_reporter from public.profiles
   where daycare_id = v_daycare and role = 'educator' and archived_at is null limit 1;
  select id into v_director from public.profiles
   where daycare_id = v_daycare and role in ('owner_admin', 'admin') and archived_at is null limit 1;
  insert into public.incident_reports (
    id, daycare_id, child_id, educator_id, classroom_id, occurred_at,
    location, severity, injury_type, description, first_aid_given,
    witness_id, status, signed_off_by, signed_off_at, parent_notified_at
  ) select
    v_incident, v_daycare, v_child, v_reporter, child.classroom_id, now(),
    'Playground', 'minor', 'Scrape', 'Test incident for Group 20.',
    'Cleaned and bandaged.', v_director, 'signed_off', v_director, now(), now()
  from public.children child where child.id = v_child;

  perform pg_temp.impersonate('authenticated', v_parent);
  v_failed := false;
  begin
    perform public.acknowledge_parent_incident(v_incident, 'Someone Else');
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL: signature did not have to match the account'; end if;

  v_result := public.acknowledge_parent_incident(v_incident, 'Lucia Castillo');
  if (v_result->>'incidentId')::uuid <> v_incident
     or (v_result->>'alreadyAcknowledged')::boolean then
    raise exception 'FAIL: acknowledgment result is incomplete: %', v_result;
  end if;

  perform pg_temp.impersonate('postgres');
  if not exists (
    select 1 from public.incident_acknowledgments acknowledgment
     where acknowledgment.incident_id = v_incident
       and acknowledgment.parent_id = v_parent
       and acknowledgment.signed_name = 'Lucia Castillo'
       and acknowledgment.statement_version = 'parent-incident-v1'
  ) then raise exception 'FAIL: immutable acknowledgment evidence was not stored'; end if;
  if not exists (
    select 1 from public.incident_reports incident
     where incident.id = v_incident and incident.status = 'acknowledged'
       and incident.parent_acknowledged_by = v_parent
  ) then raise exception 'FAIL: report was not marked acknowledged by the parent account'; end if;
  if not exists (
    select 1 from public.audit_log audit
     where audit.entity_id = v_incident and audit.action = 'parent_incident_acknowledged'
  ) then raise exception 'FAIL: acknowledgment was not explicitly audited'; end if;
  if not exists (
    select 1 from public.notifications notification
     where notification.payload->>'incidentId' = v_incident::text
       and notification.payload->>'type' = 'incident_acknowledged'
  ) then raise exception 'FAIL: staff workflow was not notified'; end if;
  raise notice 'PASS: signed acknowledgment stores identity, evidence, audit and staff feedback';

  perform pg_temp.impersonate('authenticated', v_parent);
  v_retry := public.acknowledge_parent_incident(v_incident, 'Lucia Castillo');
  if not (v_retry->>'alreadyAcknowledged')::boolean then
    raise exception 'FAIL: a safe retry was not idempotent';
  end if;
  raise notice 'PASS: acknowledgment retries are idempotent';

  perform pg_temp.impersonate('authenticated', v_foreign_parent);
  v_failed := false;
  begin
    perform public.acknowledge_parent_incident(v_incident, 'Test Parent');
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL: unrelated parent acknowledged the report'; end if;

  perform pg_temp.impersonate('authenticated', v_parent);
  v_failed := false;
  begin
    insert into public.incident_acknowledgments (
      daycare_id, incident_id, child_id, parent_id, signed_name, statement_text
    ) values (
      v_daycare, gen_random_uuid(), v_child, v_parent, 'Lucia Castillo', 'Bypass'
    );
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL: parent bypassed the signed RPC'; end if;
  raise notice 'PASS: cross-family and direct-write bypasses are rejected';
end;
$$;

rollback;
select 'MOBILE PARENT GROUP 20 INCIDENT TESTS: ALL PASSED' as result;
