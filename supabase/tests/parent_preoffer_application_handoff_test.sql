-- Group 2o pre-offer family application handoff; rollback only.
begin;

create function pg_temp.impersonate(p_role text, p_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('role', p_role, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_id, 'role', p_role)::text,
    true
  );
end;
$$;

do $$
declare
  center uuid := '10000000-0000-4000-a000-000000000001';
  owner_id uuid := '00000000-0000-4000-a000-000000000001';
  room_id uuid;
  enrollment_id uuid;
  code text := 'PREOFFER-APPLICATION-ROLLBACK';
  path text := 'enrollment-offers/PREOFFER-APPLICATION-ROLLBACK/immunization/record.pdf';
  payload jsonb;
  failed boolean := false;
begin
  perform pg_temp.impersonate('postgres', owner_id);
  select id into room_id from public.classrooms where daycare_id = center order by created_at limit 1;
  insert into public.enrollments (
    daycare_id, child_first_name, child_last_name, child_date_of_birth,
    guardian_name, guardian_email, guardian_phone, classroom_id, stage,
    tour_outcome, offer_code, offer_status, application_progress,
    parent_workflow_step, documents_status
  ) values (
    center, 'Preoffer', 'Child', public.center_today() - interval '3 years',
    'Jordan Family', 'preoffer-family@dailylog.invalid', '416-555-0190',
    room_id, 'application', 'attended', code, 'draft', 20,
    'application', jsonb_build_object('immunization', 'requested')
  ) returning id into enrollment_id;

  perform pg_temp.impersonate('anon', owner_id);
  payload := public.get_parent_inquiry_journey(code);
  if payload->'application'->>'available' <> 'true'
     or payload->'application'->>'submitted_at' is not null then
    raise exception 'FAIL: journey did not expose the ready application: %', payload;
  end if;
  payload := public.get_parent_enrollment_offer(code);
  if payload->>'pre_offer_application' <> 'true'
     or payload->>'workflow_step' <> 'application' then
    raise exception 'FAIL: secure application overlay was not available: %', payload;
  end if;
  raise notice 'PASS: post-tour journey opens the pre-offer application';

  payload := public.save_parent_inquiry_application(
    code,
    jsonb_build_object(
      'child_full_name', 'Preoffer Child',
      'child_date_of_birth', to_char(public.center_today() - interval '3 years', 'YYYY-MM-DD'),
      'allergies', jsonb_build_array('None reported'),
      'primary_guardian_name', 'Jordan Family',
      'primary_guardian_email', 'preoffer-family@dailylog.invalid',
      'primary_guardian_phone', '416-555-0190',
      'emergency_contact_name', 'Taylor Family',
      'emergency_contact_phone', '416-555-0191'
    )
  );
  if payload->>'workflow_step' <> 'documents'
     or payload->'documents_status'->'emergency_contacts'->>'status' <> 'received'
     or payload->'documents_status'->'medical'->>'status' <> 'received' then
    raise exception 'FAIL: application details did not complete the in-app form records: %', payload;
  end if;
  raise notice 'PASS: family details persist and complete contact/medical forms';

  perform pg_temp.impersonate('postgres', owner_id);
  insert into storage.objects (bucket_id, name, metadata)
  values ('documents', path, jsonb_build_object('mimetype', 'application/pdf', 'size', 256));
  perform pg_temp.impersonate('anon', owner_id);
  if not public.can_upload_parent_enrollment_document(code, 'immunization') then
    raise exception 'FAIL: storage guard rejected the active pre-offer application';
  end if;
  payload := public.save_parent_inquiry_document(
    code, 'immunization', 'record.pdf', 'application/pdf', 256, path
  );
  if payload->'documents_status'->'immunization'->>'status' <> 'received'
     or jsonb_array_length(payload->'documents') <> 1 then
    raise exception 'FAIL: pre-offer document was not attached: %', payload;
  end if;
  perform public.complete_parent_inquiry_application(code);
  raise notice 'PASS: pre-offer document upload and completion remain in the application stage';

  perform pg_temp.impersonate('postgres', owner_id);
  if not exists (
    select 1 from public.enrollments enrollment
     where enrollment.id = enrollment_id
       and enrollment.stage = 'application'
       and enrollment.application_submitted_at is not null
       and enrollment.application_progress >= 80
       and enrollment.agreement_signed_at is null
       and enrollment.deposit_status = 'unpaid'
  ) then
    raise exception 'FAIL: application completion crossed the offer/payment boundary';
  end if;

  perform pg_temp.impersonate('anon', owner_id);
  failed := false;
  begin
    perform public.sign_parent_enrollment_agreement(code, 'Jordan Family', true, true, true);
  exception when others then
    failed := true;
  end;
  if not failed then
    raise exception 'FAIL: pre-offer family could sign an agreement without an offer';
  end if;
  raise notice 'PASS: offer agreement and payment gates remain closed';
end;
$$;

rollback;
select 'PARENT PRE-OFFER APPLICATION HANDOFF TESTS: ALL PASSED' as result;
