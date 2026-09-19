-- Educator -> admin -> parent incident handoff, including alumni continuity.
-- All mutations roll back.
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
  v_educator constant uuid := '00000000-0000-4000-a000-000000000003';
  v_director constant uuid := '00000000-0000-4000-a000-000000000001';
  v_child constant uuid := '30000000-0000-4000-a000-000000000013';
  v_incident uuid := gen_random_uuid();
  v_classroom uuid;
  v_count int;
  v_hub jsonb;
begin
  perform pg_temp.impersonate('postgres');
  update public.children
     set archived_at = null,
         enrolled_on = least(coalesce(enrolled_on, current_date), current_date)
   where id = v_child
   returning classroom_id into v_classroom;

  perform pg_temp.impersonate('authenticated', v_educator);
  insert into public.incident_reports (
    id, daycare_id, child_id, educator_id, classroom_id, occurred_at,
    location, severity, injury_type, injury_side, body_parts, description,
    first_aid_given, first_aid_by, witness_id, status
  ) values (
    v_incident, v_daycare, v_child, v_educator, v_classroom, now(),
    'Classroom', 'minor', 'Scrape', 'front', array['left knee'],
    'Child tripped while walking between activity areas.',
    'Cleaned and covered with a bandage.', v_educator, v_director, 'draft'
  );

  update public.incident_reports
     set status = 'submitted', submitted_at = now()
   where id = v_incident;

  perform pg_temp.impersonate('postgres');
  select count(*) into v_count
    from public.notification_outbox
   where dedupe_key = 'incident:' || v_incident || ':director'
     and recipient_id = v_director;
  if v_count <> 1 then
    raise exception 'FAIL: educator submission did not create one director alert';
  end if;
  if exists (
    select 1 from public.notification_outbox
     where dedupe_key = 'incident:' || v_incident || ':parent'
  ) then
    raise exception 'FAIL: routine incident reached the parent before sign-off';
  end if;

  perform pg_temp.impersonate('authenticated', v_director);
  update public.incident_reports
     set status = 'signed_off', signed_off_by = v_director, signed_off_at = now()
   where id = v_incident and status = 'submitted';

  perform pg_temp.impersonate('postgres');
  select count(*) into v_count
    from public.notification_outbox
   where dedupe_key = 'incident:' || v_incident || ':parent'
     and recipient_id = v_parent;
  if v_count <> 1 then
    raise exception 'FAIL: director sign-off did not create one parent alert';
  end if;

  perform pg_temp.impersonate('authenticated', v_parent);
  v_hub := public.get_parent_incident_hub(v_child);
  if not exists (
    select 1 from jsonb_array_elements(v_hub->'reports') report
     where report->>'id' = v_incident::text
       and report->>'status' = 'signed_off'
  ) then
    raise exception 'FAIL: signed incident did not reach the linked parent';
  end if;
  perform public.acknowledge_parent_incident(v_incident, 'Lucia Castillo');

  perform pg_temp.impersonate('postgres');
  update public.children set archived_at = now() where id = v_child;

  perform pg_temp.impersonate('authenticated', v_educator);
  select count(*) into v_count
    from public.incident_reports where id = v_incident;
  if v_count <> 0 then
    raise exception 'FAIL: educator retained incident access after the child became alumni';
  end if;

  perform pg_temp.impersonate('authenticated', v_parent);
  v_hub := public.get_parent_incident_hub(v_child);
  if not exists (
    select 1 from jsonb_array_elements(v_hub->'reports') report
     where report->>'id' = v_incident::text
       and report->>'status' = 'acknowledged'
  ) then
    raise exception 'FAIL: family lost acknowledged incident history after archive';
  end if;

  raise notice 'PASS: educator, director and parent incident handoff has no dead end';
end;
$$;

rollback;
select 'EDUCATOR ADMIN INCIDENT HANDOFF TESTS: ALL PASSED' as result;
