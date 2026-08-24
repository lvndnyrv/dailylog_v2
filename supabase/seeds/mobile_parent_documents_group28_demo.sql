-- Resettable Parent Mobile Group 28 document-vault demo.
-- Login: lucia.castillo@parent.test / password123

do $$
declare
  v_daycare constant uuid := '10000000-0000-4000-a000-000000000001';
  v_parent constant uuid := '00000000-0000-4000-a000-000000000023';
  v_admin constant uuid := '00000000-0000-4000-a000-000000000001';
  v_child constant uuid := '30000000-0000-4000-a000-000000000013';
  v_enrollment constant uuid := '42800000-0000-4000-a000-000000000001';
  v_request constant uuid := '42810000-0000-4000-a000-000000000001';
begin
  if not exists (
    select 1 from public.parent_children
    where parent_id = v_parent and child_id = v_child
  ) then
    raise notice 'Skipping Group 28 demo: Lucia and Mateo are not seeded';
    return;
  end if;

  update public.children
  set allergies = array['Peanuts'],
      medical_notes = 'Epinephrine auto-injector is stored in the classroom medication cabinet.',
      emergency_contacts = jsonb_build_array(
        jsonb_build_object('name', 'Carmen Castillo', 'relationship', 'Grandmother', 'phone', '416-555-0192')
      ),
      updated_at = now() - interval '5 months'
  where id = v_child;

  insert into public.enrollments (
    id, daycare_id, child_id, classroom_id,
    child_first_name, child_last_name, child_date_of_birth,
    guardian_name, guardian_email, guardian_phone,
    stage, desired_start_date, source, schedule,
    application_data, documents_status, application_progress,
    application_submitted_at, offer_code, offer_status,
    parent_workflow_step, agreement_version, agreement_data,
    agreement_signed_at, deposit_status, deposit_paid_at,
    payment_mode, parent_account_linked_at, onboarding_steps,
    stage_changed_at, created_at, updated_at
  )
  select
    v_enrollment, v_daycare, child.id, child.classroom_id,
    child.first_name, child.last_name, child.date_of_birth,
    'Lucia Castillo', 'lucia.castillo@parent.test', '416-555-0162',
    'enrolled', child.enrolled_on, 'website',
    jsonb_build_object('label', 'Mon–Fri · full day', 'drop_off', '7:30 AM', 'pickup', '5:30 PM'),
    jsonb_build_object(
      'child_full_name', child.first_name || ' ' || child.last_name,
      'child_date_of_birth', child.date_of_birth,
      'allergies', to_jsonb(array['Peanuts']::text[]),
      'primary_guardian_name', 'Lucia Castillo',
      'primary_guardian_email', 'lucia.castillo@parent.test',
      'primary_guardian_phone', '416-555-0162',
      'emergency_contact_name', 'Carmen Castillo',
      'emergency_contact_phone', '416-555-0192'
    ),
    jsonb_build_object('immunization', 'requested', 'birth_certificate', 'received'),
    100,
    make_timestamptz(2025, 7, 12, 10, 30, 0, 'America/Toronto'),
    'PARENT28-MATEO-2025', 'accepted', 'enrolled', '2025-09-03',
    jsonb_build_object(
      'signature_name', 'Lucia Castillo',
      'acknowledge_tuition', true,
      'acknowledge_policies', true,
      'photo_consent', true
    ),
    make_timestamptz(2025, 9, 3, 14, 12, 0, 'America/Toronto'),
    'paid', make_timestamptz(2025, 9, 3, 14, 15, 0, 'America/Toronto'),
    'demo', make_timestamptz(2025, 9, 3, 14, 20, 0, 'America/Toronto'),
    jsonb_build_object('offer_complete', true, 'account_linked', true),
    make_timestamptz(2025, 9, 3, 14, 20, 0, 'America/Toronto'),
    make_timestamptz(2025, 7, 12, 9, 0, 0, 'America/Toronto'), now()
  from public.children child where child.id = v_child
  on conflict (id) do update set
    child_id = excluded.child_id,
    classroom_id = excluded.classroom_id,
    application_data = excluded.application_data,
    application_progress = excluded.application_progress,
    application_submitted_at = excluded.application_submitted_at,
    agreement_version = excluded.agreement_version,
    agreement_data = excluded.agreement_data,
    agreement_signed_at = excluded.agreement_signed_at,
    parent_workflow_step = excluded.parent_workflow_step,
    parent_account_linked_at = excluded.parent_account_linked_at,
    stage = excluded.stage,
    offer_status = excluded.offer_status,
    updated_at = now();

  delete from public.parent_document_submissions
  where request_id in (
    select id from public.parent_document_requests
    where child_id = v_child and lower(kind) = 'immunization'
  );
  delete from public.parent_document_requests
  where child_id = v_child and lower(kind) = 'immunization';

  insert into public.parent_document_requests (
    id, daycare_id, child_id, kind, title, message, due_on,
    status, requested_by, requested_at
  ) values (
    v_request, v_daycare, v_child, 'immunization',
    'Updated immunization record',
    'Hi Lucia — Mateo''s file needs his latest shots because the record on file is from last year. A clear photo of the new card is perfect. Thank you!',
    current_date + 7,
    'requested', v_admin, now() - interval '2 days'
  );
end;
$$;
