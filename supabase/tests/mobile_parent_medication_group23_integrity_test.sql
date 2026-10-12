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
  v_parent constant uuid := '00000000-0000-4000-a000-000000000023';
  v_authorization constant uuid := '52390000-0000-4000-a000-000000000024';
  v_educator constant uuid := '00000000-0000-4000-a000-000000000003';
  v_witness constant uuid := '00000000-0000-4000-a000-000000000001';
  v_valid_log constant uuid := '52390000-0000-4000-a000-000000000023';
  v_path text := v_child::text || '/' || v_parent::text || '/group23-integrity-label.jpg';
  v_failed boolean;
begin
  perform pg_temp.impersonate('postgres');
  update public.children
     set archived_at = null,
         enrolled_on = least(coalesce(enrolled_on, public.center_today()), public.center_today())
   where id = v_child;
  insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
  values (
    'medication-labels', v_path, v_parent, v_parent::text,
    jsonb_build_object('mimetype', 'image/jpeg', 'size', 2048)
  );

  perform pg_temp.impersonate('authenticated', v_parent);
  insert into public.medication_authorizations (
    id, daycare_id, child_id, parent_id, name, dosage, route,
    medication_type, schedule_type, scheduled_times, schedule,
    start_date, end_date, label_photo_path, signed_name, signed_at,
    consented_at, authorization_version
  ) values (
    v_authorization, v_daycare, v_child, v_parent,
    'Group 23 integrity medication', '5 ml', 'Oral', 'prescription',
    'scheduled', array[time '12:30'], 'Give with food', public.center_today(),
    public.center_today() + 10, v_path, 'Lucia Castillo', now(), now(), '2026-08-09'
  );

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
