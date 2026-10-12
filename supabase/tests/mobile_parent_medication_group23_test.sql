-- Parent Mobile Group 23 medication history, authorization, and notification tests.
-- Requires the standard seed plus mobile_parent_medication_group23_demo.sql.
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
  v_foreign_child constant uuid := '30000000-0000-4000-a000-000000000002';
  v_auth constant uuid := '52390000-0000-4000-a000-000000000001';
  v_log constant uuid := '52390000-0000-4000-a000-000000000002';
  v_path text := v_child::text || '/' || v_parent::text || '/group23-test-label.jpg';
  v_count int;
  v_failed boolean;
begin
  -- The shared demo child may have moved to Alumni and the shared medication
  -- authorization has real dates. Keep this rollback-only test operational and
  -- create its own current authorization below.
  perform pg_temp.impersonate('postgres');
  update public.children
     set archived_at = null,
         enrolled_on = least(coalesce(enrolled_on, public.center_today()), public.center_today())
   where id = v_child;

  perform pg_temp.impersonate('authenticated', v_parent);
  select count(*) into v_count
    from public.medication_authorizations
   where child_id = v_child;
  if v_count < 1 then
    raise exception 'FAIL: parent cannot see the child medication history';
  end if;
  select count(*) into v_count
    from public.medication_logs
   where child_id = v_child;
  if v_count < 2 then
    raise exception 'FAIL: parent dose history is incomplete';
  end if;
  select count(*) into v_count
    from public.medication_authorizations
   where child_id = v_foreign_child;
  if v_count <> 0 then
    raise exception 'FAIL: parent can read another family''s medication records';
  end if;
  raise notice 'PASS: parent history is complete and family isolated';

  v_failed := false;
  begin
    insert into public.medication_authorizations (
      daycare_id, child_id, parent_id, name, dosage, route,
      medication_type, schedule_type, start_date, end_date
    ) values (
      v_daycare, v_child, v_parent, 'Unsafe bypass', '5 ml', 'Oral',
      'prescription', 'as_needed', public.center_today(), public.center_today() + 5
    );
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: parent bypassed label, PRN limits, consent, and signature validation';
  end if;

  v_failed := false;
  begin
    insert into public.medication_authorizations (
      daycare_id, child_id, parent_id, name, dosage, route,
      medication_type, schedule_type, as_needed_condition, max_daily_doses,
      start_date, end_date, label_photo_path, signed_name, signed_at,
      consented_at, authorization_version
    ) values (
      v_daycare, v_foreign_child, v_parent, 'Foreign child bypass', '5 ml', 'Oral',
      'prescription', 'as_needed', 'Fever', 3,
      public.center_today(), public.center_today() + 5, 'foreign/path.jpg', 'Lucia Castillo', now(),
      now(), '2026-08-09'
    );
  exception when others then
    v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL: parent authorized another child'; end if;

  v_failed := false;
  begin
    insert into public.medication_authorizations (
      daycare_id, child_id, parent_id, name, dosage, route,
      medication_type, schedule_type, as_needed_condition, max_daily_doses,
      start_date, end_date, label_photo_path, signed_name, signed_at,
      consented_at, authorization_version
    ) values (
      v_daycare, v_child, v_parent, 'Long PRN bypass', '5 ml', 'Oral',
      'prescription', 'as_needed', 'Fever', 3,
      public.center_today(), public.center_today() + 31, v_path, 'Lucia Castillo', now(),
      now(), '2026-08-09'
    );
  exception when others then
    v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL: parent created a PRN authorization longer than 30 days'; end if;
  raise notice 'PASS: authorization bypasses and cross-family writes are rejected';

  perform pg_temp.impersonate('postgres');
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
    v_auth, v_daycare, v_child, v_parent, 'Group 23 test medication',
    '2 puffs', 'Inhaler', 'prescription', 'scheduled',
    array[time '12:30', time '18:00'], 'Use with spacer',
    public.center_today(), public.center_today() + 10, v_path, 'Lucia Castillo', now(),
    now(), '2026-08-09'
  );

  if not exists (
    select 1 from public.medication_authorizations
     where id = v_auth and active
       and start_date <= public.center_today() and end_date >= public.center_today()
  ) then
    raise exception 'FAIL: parent cannot see the current authorization';
  end if;

  v_failed := false;
  begin
    update public.medication_authorizations
       set dosage = '4 puffs'
     where id = v_auth;
  exception when others then
    v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL: parent changed signed medication details'; end if;

  v_failed := false;
  begin
    insert into public.medication_logs (
      daycare_id, authorization_id, child_id, administered_by,
      witness_id, dosage_given, route_given, safety_checks
    ) values (
      v_daycare, v_auth, v_child, v_parent, v_witness,
      '2 puffs', 'Inhaler',
      '{"right_child":true,"right_medication":true,"right_dose":true,"right_route":true,"right_time":true}'::jsonb
    );
  exception when others then
    v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL: parent logged their own medication dose'; end if;

  perform pg_temp.impersonate('authenticated', v_educator);
  insert into public.medication_logs (
    id, daycare_id, authorization_id, child_id, administered_by,
    witness_id, dosage_given, route_given, safety_checks, notes
  ) values (
    v_log, v_daycare, v_auth, v_child, v_educator, v_witness,
    '2 puffs', 'Inhaler',
    '{"right_child":true,"right_medication":true,"right_dose":true,"right_route":true,"right_time":true}'::jsonb,
    'Group 23 notification test'
  );

  perform pg_temp.impersonate('postgres');
  if not exists (
    select 1 from public.medication_logs
     where id = v_log and parent_notified_at is not null
  ) then
    raise exception 'FAIL: server did not stamp parent notification time';
  end if;
  select count(*) into v_count
    from public.notification_outbox outbox
   where outbox.recipient_id = v_parent
     and outbox.kind = 'medication'
     and outbox.dedupe_key = 'medication-dose:' || v_log
     and outbox.payload->>'screen' = 'Medication'
     and outbox.payload->>'childId' = v_child::text;
  if v_count <> 1 then
    raise exception 'FAIL: dose did not queue exactly one deep-linked parent notification';
  end if;
  select count(*) into v_count
    from public.notifications notification
   where notification.profile_id = v_parent
     and notification.kind = 'medication'
     and notification.payload->>'medicationLogId' = v_log::text;
  if v_count <> 1 then
    raise exception 'FAIL: dose did not create one persistent in-app record';
  end if;
  raise notice 'PASS: staff dose atomically stamps and queues the parent notification';

  perform pg_temp.impersonate('authenticated', v_parent);
  update public.medication_authorizations
     set active = false, end_date = public.center_today()
   where id = v_auth;
  if not exists (
    select 1 from public.medication_authorizations
     where id = v_auth and not active and end_date = public.center_today()
  ) then
    raise exception 'FAIL: parent could not end their authorization';
  end if;
  raise notice 'PASS: valid authorization is signed, immutable, and can be ended safely';
end;
$$;

rollback;
select 'MOBILE PARENT GROUP 23 MEDICATION TESTS: ALL PASSED' as result;
