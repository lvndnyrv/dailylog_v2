-- Group 2n atomic application-document requests; rollback only.
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
  application_id uuid;
  enrolled_application_id uuid;
  enrolled_child_id uuid;
  payload jsonb;
  request_count integer;
  email_count integer;
  failed boolean := false;
begin
  perform pg_temp.impersonate('postgres', owner_id);
  select id into room_id from public.classrooms where daycare_id = center order by created_at limit 1;

  insert into public.enrollments (
    daycare_id, child_first_name, child_last_name, child_date_of_birth,
    guardian_name, guardian_email, classroom_id, stage, documents_status
  ) values (
    center, 'Atomic', 'Applicant', public.center_today() - interval '3 years',
    'Avery Applicant', 'atomic-docs-applicant@dailylog.invalid', room_id,
    'application', jsonb_build_object('immunization', 'missing', 'medical', 'missing')
  ) returning id into application_id;

  perform pg_temp.impersonate('authenticated', owner_id);
  payload := public.request_enrollment_documents(
    application_id,
    array['medical', 'immunization', 'medical'],
    'Please complete both remaining records.',
    public.center_today() + 12
  );
  if payload->>'retry' <> 'false' then
    raise exception 'FAIL: first request was reported as a retry: %', payload;
  end if;

  perform pg_temp.impersonate('postgres', owner_id);
  if not exists (
    select 1 from public.enrollments enrollment
     where enrollment.id = application_id
       and enrollment.documents_status->'medical'->>'status' = 'requested'
       and enrollment.documents_status->'immunization'->>'status' = 'requested'
  ) then
    raise exception 'FAIL: the complete pre-enrollment request batch was not recorded';
  end if;
  select count(*) into email_count
    from public.notification_outbox outbox
   where outbox.dedupe_key = 'documents:' || application_id || ':immunization-medical';
  if email_count <> 1 then
    raise exception 'FAIL: request did not create exactly one family email';
  end if;
  raise notice 'PASS: pre-enrollment document batch and email commit together';

  perform pg_temp.impersonate('authenticated', owner_id);
  payload := public.request_enrollment_documents(
    application_id,
    array['immunization', 'medical'],
    'Please complete both remaining records.',
    public.center_today() + 12
  );
  perform pg_temp.impersonate('postgres', owner_id);
  select count(*) into email_count
    from public.notification_outbox outbox
   where outbox.dedupe_key = 'documents:' || application_id || ':immunization-medical';
  if payload->>'retry' <> 'true' or email_count <> 1 then
    raise exception 'FAIL: retry duplicated the request or email: % / %', payload, email_count;
  end if;
  raise notice 'PASS: repeating the same batch is idempotent';

  insert into public.children (
    daycare_id, first_name, last_name, date_of_birth, classroom_id
  ) values (
    center, 'Enrolled', 'Child', public.center_today() - interval '4 years', room_id
  ) returning id into enrolled_child_id;
  insert into public.enrollments (
    daycare_id, child_id, child_first_name, child_last_name, child_date_of_birth,
    guardian_name, guardian_email, classroom_id, stage, documents_status
  ) values (
    center, enrolled_child_id, 'Enrolled', 'Child', public.center_today() - interval '4 years',
    'Parker Parent', 'atomic-docs-parent@dailylog.invalid', room_id,
    'enrolled', '{}'::jsonb
  ) returning id into enrolled_application_id;

  perform pg_temp.impersonate('authenticated', owner_id);
  perform public.request_enrollment_documents(
    enrolled_application_id,
    array['handbook', 'emergency_contacts'],
    'Please upload the current records.',
    public.center_today() + 14
  );
  perform pg_temp.impersonate('postgres', owner_id);
  select count(*) into request_count
    from public.parent_document_requests request
   where request.child_id = enrolled_child_id
     and request.kind in ('handbook', 'emergency_contacts')
     and request.status = 'requested';
  if request_count <> 2 then
    raise exception 'FAIL: enrolled family did not receive the complete standing-vault batch';
  end if;
  raise notice 'PASS: enrolled family requests land in the standing document vault';

  perform pg_temp.impersonate('authenticated', owner_id);
  failed := false;
  begin
    perform public.request_enrollment_documents(
      enrolled_application_id,
      array['medical', 'unsupported-record'],
      'This entire batch must fail.',
      public.center_today() + 10
    );
  exception when others then
    failed := true;
  end;
  if not failed then raise exception 'FAIL: invalid mixed batch was accepted'; end if;
  perform pg_temp.impersonate('postgres', owner_id);
  if exists (
    select 1 from public.parent_document_requests request
     where request.child_id = enrolled_child_id and request.kind = 'medical'
  ) or exists (
    select 1 from public.enrollments enrollment
     where enrollment.id = enrolled_application_id
       and enrollment.documents_status ? 'medical'
  ) then
    raise exception 'FAIL: rejected mixed batch left a partial request behind';
  end if;
  raise notice 'PASS: invalid batches roll back without partial requests';
end;
$$;

rollback;
select 'ATOMIC ENROLLMENT DOCUMENT REQUEST TESTS: ALL PASSED' as result;
