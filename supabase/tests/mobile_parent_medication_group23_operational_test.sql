-- Parent Mobile Group 23 operational safety tests. All mutations roll back.
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
  v_witness constant uuid := '00000000-0000-4000-a000-000000000001';
  v_child constant uuid := '30000000-0000-4000-a000-000000000013';
  v_prn_auth constant uuid := '52390000-0000-4000-a000-000000000021';
  v_expired_auth constant uuid := '52390000-0000-4000-a000-000000000022';
  v_first_log constant uuid := '52390000-0000-4000-a000-000000000023';
  v_second_log constant uuid := '52390000-0000-4000-a000-000000000024';
  v_label_path text := v_child::text || '/' || v_parent::text || '/group23-operational-label.jpg';
  v_failed boolean := false;
begin
  perform pg_temp.impersonate('postgres');
  insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
  values (
    'medication-labels', v_label_path, v_parent, v_parent::text,
    jsonb_build_object('mimetype', 'image/jpeg', 'size', 2048)
  );

  perform pg_temp.impersonate('authenticated', v_parent);
  insert into public.medication_authorizations (
    id, daycare_id, child_id, parent_id, name, dosage, route,
    medication_type, schedule_type, scheduled_times, schedule,
    as_needed_condition, max_daily_doses, start_date, end_date,
    label_photo_path, signed_name, signed_at, consented_at,
    authorization_version
  ) values (
    v_prn_auth, v_daycare, v_child, v_parent, 'Group 23 daily limit',
    '5 ml', 'Oral', 'over_the_counter', 'as_needed', '{}'::time[],
    'As needed', 'Fever above 38.5 C', 1, current_date, current_date + 1,
    v_label_path, 'Lucia Castillo', now(), now(), '2026-08-09'
  );

  perform pg_temp.impersonate('authenticated', v_educator);
  insert into public.medication_logs (
    id, daycare_id, authorization_id, child_id, administered_by,
    witness_id, dosage_given, route_given, safety_checks, notes
  ) values (
    v_first_log, v_daycare, v_prn_auth, v_child, v_educator,
    v_witness, '5 ml', 'Oral',
    '{"right_child":true,"right_medication":true,"right_dose":true,"right_route":true,"right_time":true}'::jsonb,
    'First permitted dose'
  );

  begin
    insert into public.medication_logs (
      id, daycare_id, authorization_id, child_id, administered_by,
      witness_id, dosage_given, route_given, safety_checks, notes
    ) values (
      v_second_log, v_daycare, v_prn_auth, v_child, v_educator,
      v_witness, '5 ml', 'Oral',
      '{"right_child":true,"right_medication":true,"right_dose":true,"right_route":true,"right_time":true}'::jsonb,
      'This dose must be rejected'
    );
  exception when others then
    v_failed := sqlerrm like '%maximum daily doses%';
  end;
  if not v_failed then
    raise exception 'FAIL: the as-needed daily limit was not enforced';
  end if;
  raise notice 'PASS: as-needed daily dose limits are enforced by the database';

  perform pg_temp.impersonate('postgres');
  insert into public.medication_authorizations (
    id, daycare_id, child_id, parent_id, name, dosage, route,
    medication_type, schedule_type, scheduled_times, schedule,
    start_date, end_date, active
  ) values (
    v_expired_auth, v_daycare, v_child, v_parent, 'Group 23 expired record',
    '1 tablet', 'Oral', 'prescription', 'scheduled', array[time '12:00'],
    'At noon', current_date - 10, current_date - 1, true
  );

  -- Match the pg_cron execution context: database role with no request JWT.
  perform set_config('request.jwt.claims', '{}'::text, true);
  perform public.process_medication_authorization_statuses();
  if exists (
    select 1 from public.medication_authorizations
     where id = v_expired_auth and active
  ) then
    raise exception 'FAIL: an expired authorization remained active';
  end if;
  if not exists (
    select 1 from public.medication_authorizations
     where id = v_expired_auth and ended_at is not null
  ) then
    raise exception 'FAIL: automatic expiration was not audited';
  end if;
  raise notice 'PASS: expired authorizations are closed automatically and audited';
end;
$$;

rollback;
select 'MOBILE PARENT GROUP 23 OPERATIONAL TESTS: ALL PASSED' as result;
