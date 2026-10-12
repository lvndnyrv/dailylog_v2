-- Parent Mobile Group 20 completion tests: urgent pre-signoff acknowledgment,
-- director review continuity, final state, and family payload privacy.
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
  v_incident uuid := gen_random_uuid();
  v_reporter uuid;
  v_director uuid;
  v_result jsonb;
  v_hub jsonb;
begin
  perform pg_temp.impersonate('postgres');
  select id into v_reporter from public.profiles
   where daycare_id = v_daycare and role = 'educator' and archived_at is null limit 1;
  select id into v_director from public.profiles
   where daycare_id = v_daycare and role in ('owner_admin', 'admin') and archived_at is null limit 1;

  insert into public.incident_reports (
    id, daycare_id, child_id, educator_id, classroom_id, occurred_at,
    location, severity, injury_type, description, first_aid_given,
    witness_id, notes, status, submitted_at, parent_notified_at
  ) select
    v_incident, v_daycare, v_child, v_reporter, child.classroom_id, now(),
    'Playground', 'serious', 'Head bump', 'Visible family description.',
    'First aid provided.', v_director, 'STAFF ONLY: do not expose',
    'submitted', now(), now()
  from public.children child where child.id = v_child;

  perform pg_temp.impersonate('authenticated', v_parent);
  v_result := public.acknowledge_parent_incident(v_incident, 'Lucia Castillo');
  if not (v_result->>'directorReviewPending')::boolean then
    raise exception 'FAIL: urgent pre-signoff receipt omitted pending director review';
  end if;

  v_hub := public.get_parent_incident_hub(v_child);
  if (select report ? 'notes'
        from jsonb_array_elements(v_hub->'reports') report
       where report->>'id' = v_incident::text) then
    raise exception 'FAIL: staff-only notes leaked into the parent incident payload';
  end if;
  if not (select (report->>'director_review_required')::boolean
            from jsonb_array_elements(v_hub->'reports') report
           where report->>'id' = v_incident::text) then
    raise exception 'FAIL: family history omitted pending director review state';
  end if;

  perform pg_temp.impersonate('postgres');
  if not exists (
    select 1 from public.incident_reports
     where id = v_incident and status = 'submitted'
       and parent_acknowledged_at is not null
  ) then
    raise exception 'FAIL: parent acknowledgment removed urgent report from sign-off queue';
  end if;

  perform pg_temp.impersonate('authenticated', v_director);
  update public.incident_reports
     set status = 'signed_off', signed_off_by = v_director, signed_off_at = now()
   where id = v_incident and status = 'submitted';

  perform pg_temp.impersonate('postgres');
  if not exists (
    select 1 from public.incident_reports
     where id = v_incident and status = 'acknowledged'
       and signed_off_by = v_director and signed_off_at is not null
  ) then
    raise exception 'FAIL: director sign-off did not finalize the acknowledged report';
  end if;

  raise notice 'PASS: urgent acknowledgment preserves director review and family privacy';
end;
$$;

rollback;
select 'MOBILE PARENT GROUP 20 COMPLETION TESTS: ALL PASSED' as result;
