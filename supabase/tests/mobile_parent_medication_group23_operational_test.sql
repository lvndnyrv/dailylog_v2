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
  v_archived_witness_log constant uuid := '52390000-0000-4000-a000-000000000025';
  v_label_path text := v_child::text || '/' || v_parent::text || '/group23-operational-label.jpg';
  v_failed boolean := false;
  v_allowed boolean;
  v_today date;
begin
  perform pg_temp.impersonate('postgres');
  select (now() at time zone coalesce(daycare.timezone, 'UTC'))::date
    into v_today from public.daycares daycare where daycare.id = v_daycare;
  update public.children
     set archived_at = null,
         enrolled_on = least(coalesce(enrolled_on, v_today), v_today)
   where id = v_child;
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
    'As needed', 'Fever above 38.5 C', 1, v_today, v_today + 1,
    v_label_path, 'Lucia Castillo', now(), now(), '2026-08-09'
  );

  perform pg_temp.impersonate('postgres');
  update public.profiles set archived_at = now() where id = v_witness;
  if not exists (
    select 1 from public.profiles
     where id = v_witness and archived_at is not null
  ) then
    raise exception 'FAIL: archived-witness fixture was not established';
  end if;
  perform pg_temp.impersonate('authenticated', v_educator);
  begin
    insert into public.medication_logs (
      id, daycare_id, authorization_id, child_id, administered_by,
      witness_id, dosage_given, route_given, safety_checks, notes
    ) values (
      v_archived_witness_log, v_daycare, v_prn_auth, v_child, v_educator,
      v_witness, '5 ml', 'Oral',
      '{"right_child":true,"right_medication":true,"right_dose":true,"right_route":true,"right_time":true}'::jsonb,
      'This archived witness must be rejected'
    );
  exception when others then
    raise notice 'Archived witness rejection: %', sqlerrm;
    v_failed := true;
  end;
  if not v_failed or exists (
    select 1 from public.medication_logs where id = v_archived_witness_log
  ) then
    raise exception 'FAIL: an archived staff profile was accepted as a medication witness';
  end if;
  perform pg_temp.impersonate('postgres');
  update public.profiles set archived_at = null where id = v_witness;
  raise notice 'PASS: archived staff cannot witness a medication dose';

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

  perform pg_temp.impersonate('authenticated', v_parent);
  if not exists (
    select 1
      from public.notifications notification
     where notification.profile_id = v_parent
       and notification.kind = 'medication'
       and notification.payload ->> 'medicationLogId' = v_first_log::text
       and notification.payload ->> 'screen' = 'Medication'
  ) then
    raise exception 'FAIL: the parent did not receive a routed dose notification';
  end if;

  perform pg_temp.impersonate('authenticated', v_witness);
  if not exists (
    select 1
      from public.medication_logs medication_log
     where medication_log.id = v_first_log
       and medication_log.administered_by = v_educator
       and medication_log.witness_id = v_witness
  ) then
    raise exception 'FAIL: the center owner could not audit the educator dose record';
  end if;
  raise notice 'PASS: educator dose is shared with the parent and admin audit views';

  v_failed := false;
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
    'At noon', v_today - 10, v_today - 1, true
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

  update public.children set archived_at = now() where id = v_child;

  perform pg_temp.impersonate('authenticated', v_educator);
  select public.can_write_child(v_child) into v_allowed;
  if v_allowed then
    raise exception 'FAIL: an educator retained operational write access to an alumni child';
  end if;

  perform pg_temp.impersonate('authenticated', v_parent);
  select public.can_access_child(v_child) into v_allowed;
  if not v_allowed then
    raise exception 'FAIL: a linked parent lost historical access after the child was archived';
  end if;
  raise notice 'PASS: alumni records remain with the family but leave educator operations';
end;
$$;

rollback;
select 'MOBILE PARENT GROUP 23 OPERATIONAL TESTS: ALL PASSED' as result;
