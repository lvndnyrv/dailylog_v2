-- Parent Mobile Group 23 completion tests. All mutations roll back.
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
  v_active constant uuid := '52390000-0000-4000-a000-000000000014';
  v_log constant uuid := '52390000-0000-4000-a000-000000000013';
  v_prior constant uuid := '52390000-0000-4000-a000-000000000011';
  v_renewal constant uuid := '52390000-0000-4000-a000-000000000012';
  v_prior_path text := v_child::text || '/' || v_parent::text || '/group23-prior-label.jpg';
  v_renewal_path text := v_child::text || '/' || v_parent::text || '/group23-renewal-label.jpg';
  v_active_path text := v_child::text || '/' || v_parent::text || '/group23-active-label.jpg';
  v_failed boolean := false;
  v_rows int;
begin
  perform pg_temp.impersonate('postgres');
  update public.children
     set archived_at = null,
         enrolled_on = least(coalesce(enrolled_on, public.center_today()), public.center_today())
   where id = v_child;
  insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
  values
    ('medication-labels', v_prior_path, v_parent, v_parent::text,
      jsonb_build_object('mimetype', 'image/jpeg', 'size', 2048, 'test', 'original')),
    ('medication-labels', v_renewal_path, v_parent, v_parent::text,
      jsonb_build_object('mimetype', 'image/jpeg', 'size', 2048)),
    ('medication-labels', v_active_path, v_parent, v_parent::text,
      jsonb_build_object('mimetype', 'image/jpeg', 'size', 2048));

  perform pg_temp.impersonate('authenticated', v_parent);
  insert into public.medication_authorizations (
    id, daycare_id, child_id, parent_id, name, dosage, route,
    medication_type, schedule_type, scheduled_times, schedule,
    start_date, end_date, label_photo_path, signed_name, signed_at,
    consented_at, authorization_version
  ) values (
    v_prior, v_daycare, v_child, v_parent, 'Group 23 renewal source',
    '5 ml', 'Oral', 'prescription', 'scheduled', array[time '12:30'],
    'Give with food', public.center_today(), public.center_today() + 2, v_prior_path,
    'Lucia Castillo', now(), now(), '2026-08-09'
  );

  insert into public.medication_authorizations (
    id, daycare_id, child_id, parent_id, name, dosage, route,
    medication_type, schedule_type, scheduled_times, schedule,
    start_date, end_date, label_photo_path, signed_name, signed_at,
    consented_at, authorization_version
  ) values (
    v_active, v_daycare, v_child, v_parent, 'Group 23 operational dose',
    '5 ml', 'Oral', 'prescription', 'scheduled', array[time '12:30'],
    'Give with food', public.center_today(), public.center_today() + 10, v_active_path,
    'Lucia Castillo', now(), now(), '2026-08-09'
  );

  v_failed := false;
  begin
    insert into public.medication_authorizations (
      daycare_id, child_id, parent_id, name, dosage, route,
      medication_type, schedule_type, scheduled_times, schedule,
      start_date, end_date, label_photo_path, signed_name, signed_at,
      consented_at, authorization_version, renewed_from_id
    ) values (
      v_daycare, v_child, v_parent, 'Overlapping renewal', '5 ml', 'Oral',
      'prescription', 'scheduled', array[time '12:30'], 'Give with food',
      public.center_today() + 2, public.center_today() + 8, v_renewal_path,
      'Lucia Castillo', now(), now(), '2026-08-09', v_prior
    );
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: a renewal overlapped its active source authorization';
  end if;

  insert into public.medication_authorizations (
    id, daycare_id, child_id, parent_id, name, dosage, route,
    medication_type, schedule_type, scheduled_times, schedule,
    start_date, end_date, label_photo_path, signed_name, signed_at,
    consented_at, authorization_version, renewed_from_id
  ) values (
    v_renewal, v_daycare, v_child, v_parent, 'Group 23 valid renewal',
    '5 ml', 'Oral', 'prescription', 'scheduled', array[time '12:30'],
    'Give with food', public.center_today() + 3, public.center_today() + 10, v_renewal_path,
    'Lucia Castillo', now(), now(), '2026-08-09', v_prior
  );
  raise notice 'PASS: renewal chain is explicit and active periods cannot overlap';

  update public.medication_authorizations
  set active = false, end_date = public.center_today()
  where id = v_prior;
  if not exists (
    select 1 from public.medication_authorizations
    where id = v_prior and not active
      and ended_at is not null and ended_by = v_parent
  ) then
    raise exception 'FAIL: ending a parent authorization was not audited';
  end if;
  raise notice 'PASS: ending an authorization records the exact actor and time';

  update storage.objects
  set metadata = metadata || '{"test":"tampered"}'::jsonb
  where bucket_id = 'medication-labels' and name = v_prior_path;
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then
    raise exception 'FAIL: a signed medication label was replaced';
  end if;

  begin
    delete from storage.objects
    where bucket_id = 'medication-labels' and name = v_prior_path;
  exception when others then
    -- Current Supabase Storage also rejects direct SQL deletion before RLS;
    -- either protection layer is acceptable as long as the signed object stays.
    null;
  end;
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'medication-labels' and name = v_prior_path
  ) then
    raise exception 'FAIL: signed medication label evidence was deleted';
  end if;
  raise notice 'PASS: signed label photo evidence is immutable';

  if not exists (
    select 1 from public.medication_authorizations
     where id = v_active and active
       and start_date <= public.center_today()
       and end_date >= public.center_today()
  ) then
    raise exception 'FAIL: rollback-only operational authorization became inactive: %',
      (select to_jsonb(auth_row) from public.medication_authorizations auth_row where id = v_active);
  end if;

  perform pg_temp.impersonate('authenticated', v_educator);
  insert into public.medication_logs (
    id, daycare_id, authorization_id, child_id, administered_by,
    witness_id, dosage_given, route_given, safety_checks, notes
  ) values (
    v_log, v_daycare, v_active, v_child, v_educator, v_witness,
    '5 ml', 'Oral',
    '{"right_child":true,"right_medication":true,"right_dose":true,"right_route":true,"right_time":true}'::jsonb,
    'Group 23 priority test'
  );

  perform pg_temp.impersonate('postgres');
  if not exists (
    select 1 from public.notification_outbox outbox
    where outbox.kind = 'medication'
      and outbox.dedupe_key = 'medication-dose:' || v_log
      and outbox.payload->>'priority' = 'high'
  ) then
    raise exception 'FAIL: medication dose alert was not high priority';
  end if;
  raise notice 'PASS: medication doses create high-priority parent alerts';
end;
$$;

rollback;
select 'MOBILE PARENT GROUP 23 COMPLETION TESTS: ALL PASSED' as result;
