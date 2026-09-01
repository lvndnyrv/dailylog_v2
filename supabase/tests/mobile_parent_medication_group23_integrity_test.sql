-- Parent Mobile Group 23 medication-integrity tests. All changes roll back.
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
  v_child constant uuid := '30000000-0000-4000-a000-000000000013';
  v_authorization constant uuid := '52300000-0000-4000-a000-000000000001';
  v_educator constant uuid := '00000000-0000-4000-a000-000000000003';
  v_witness constant uuid := '00000000-0000-4000-a000-000000000001';
  v_valid_log constant uuid := '52390000-0000-4000-a000-000000000023';
  v_failed boolean;
begin
  perform pg_temp.impersonate('authenticated', v_educator);

  v_failed := false;
  begin
    update public.medication_authorizations
    set notes = 'Changed after the parent signed'
    where id = v_authorization;
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: staff altered signed medication instructions';
  end if;
  raise notice 'PASS: signed medication evidence is immutable for staff';

  v_failed := false;
  begin
    insert into public.medication_logs (
      daycare_id, authorization_id, child_id, administered_by, witness_id,
      dosage_given, route_given, safety_checks
    ) values (
      v_daycare, v_authorization, v_child, v_educator, v_witness,
      '10 ml', 'Topical',
      '{"right_child":true,"right_medication":true,"right_dose":true,"right_route":true,"right_time":true}'::jsonb
    );
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: staff logged a dose that differs from the authorization';
  end if;
  raise notice 'PASS: dose and route must match the signed authorization';

  insert into public.medication_logs (
    id, daycare_id, authorization_id, child_id, administered_by, witness_id,
    administered_at, dosage_given, route_given, safety_checks, notes
  ) values (
    v_valid_log, v_daycare, v_authorization, v_child, v_educator, v_witness,
    now(), '5 ml', 'Oral',
    '{"right_child":true,"right_medication":true,"right_dose":true,"right_route":true,"right_time":true}'::jsonb,
    'Integrity test dose'
  );

  v_failed := false;
  begin
    insert into public.medication_logs (
      daycare_id, authorization_id, child_id, administered_by, witness_id,
      administered_at, dosage_given, route_given, safety_checks
    ) values (
      v_daycare, v_authorization, v_child, v_educator, v_witness,
      now() + interval '30 seconds', '5 ml', 'Oral',
      '{"right_child":true,"right_medication":true,"right_dose":true,"right_route":true,"right_time":true}'::jsonb
    );
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: duplicate near-simultaneous dose was accepted';
  end if;
  raise notice 'PASS: near-simultaneous duplicate doses are rejected';
end;
$$;

rollback;
select 'MOBILE PARENT GROUP 23 INTEGRITY TESTS: ALL PASSED' as result;
