-- Group 2o: make the post-tour application email open a real family flow.
--
-- An attended tour could move the admin pipeline to Application and send a
-- secure journey link, but the family journey had no application state. The
-- same secure code now opens the existing application/document screens before
-- an offer, then returns to the journey tracker. Offer-specific agreement and
-- payment remain correctly gated until a real spot is offered.

create or replace function public.sync_enrollment_application_documents()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.stage = 'application'
     and old.stage is distinct from new.stage
     and new.child_id is null
     and coalesce(new.offer_status, 'none') not in ('sent', 'viewed', 'accepted')
     and new.application_submitted_at is null then
    new.parent_workflow_step := 'application';
  end if;

  if new.application_submitted_at is not null
     and old.application_submitted_at is distinct from new.application_submitted_at then
    new.documents_status := jsonb_set(
      jsonb_set(
        coalesce(new.documents_status, '{}'::jsonb),
        '{emergency_contacts}',
        jsonb_build_object('status', 'received', 'received_at', new.application_submitted_at),
        true
      ),
      '{medical}',
      jsonb_build_object('status', 'received', 'received_at', new.application_submitted_at),
      true
    );
  end if;

  if new.agreement_signed_at is not null
     and old.agreement_signed_at is distinct from new.agreement_signed_at then
    new.documents_status := jsonb_set(
      coalesce(new.documents_status, '{}'::jsonb),
      '{handbook}',
      jsonb_build_object('status', 'received', 'received_at', new.agreement_signed_at),
      true
    );
  end if;

  return new;
end;
$$;

drop trigger if exists enrollments_sync_application_documents on public.enrollments;
create trigger enrollments_sync_application_documents
before update on public.enrollments
for each row execute function public.sync_enrollment_application_documents();

update public.enrollments enrollment
   set parent_workflow_step = 'application'
 where enrollment.stage = 'application'
   and enrollment.child_id is null
   and enrollment.application_submitted_at is null
   and coalesce(enrollment.offer_status, 'none') not in ('sent', 'viewed', 'accepted')
   and enrollment.parent_workflow_step <> 'application';

update public.enrollments enrollment
   set documents_status = jsonb_set(
     jsonb_set(
       coalesce(enrollment.documents_status, '{}'::jsonb),
       '{emergency_contacts}',
       jsonb_build_object('status', 'received', 'received_at', enrollment.application_submitted_at),
       true
     ),
     '{medical}',
     jsonb_build_object('status', 'received', 'received_at', enrollment.application_submitted_at),
     true
   )
 where enrollment.application_submitted_at is not null
   and (
     coalesce(enrollment.documents_status->'emergency_contacts'->>'status', enrollment.documents_status->>'emergency_contacts', '') not in ('received', 'verified', 'accepted')
     or coalesce(enrollment.documents_status->'medical'->>'status', enrollment.documents_status->>'medical', '') not in ('received', 'verified', 'accepted')
   );

update public.enrollments enrollment
   set documents_status = jsonb_set(
     coalesce(enrollment.documents_status, '{}'::jsonb),
     '{handbook}',
     jsonb_build_object('status', 'received', 'received_at', enrollment.agreement_signed_at),
     true
   )
 where enrollment.agreement_signed_at is not null
   and coalesce(enrollment.documents_status->'handbook'->>'status', enrollment.documents_status->>'handbook', '') not in ('received', 'verified', 'accepted');

-- Preserve the linked-account privacy guard and add only the workflow fields
-- required by the pre-offer application UI.
alter function public.get_parent_enrollment_offer(text)
  rename to get_parent_enrollment_offer_application_internal;

revoke all on function public.get_parent_enrollment_offer_application_internal(text)
  from public, anon, authenticated;

create or replace function public.get_parent_enrollment_offer(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enrollment public.enrollments%rowtype;
  v_payload jsonb;
begin
  select * into v_enrollment
    from public.enrollments enrollment
   where upper(enrollment.offer_code) = upper(btrim(p_code));
  if v_enrollment.id is null then
    raise exception 'This family link is invalid';
  end if;

  v_payload := public.get_parent_enrollment_offer_application_internal(p_code);
  return v_payload || jsonb_build_object(
    'pre_offer_application',
      v_enrollment.stage = 'application'
      and v_enrollment.child_id is null
      and coalesce(v_enrollment.offer_status, 'none') not in ('sent', 'viewed', 'accepted'),
    'documents_status', coalesce(v_enrollment.documents_status, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.get_parent_enrollment_offer(text) from public;
grant execute on function public.get_parent_enrollment_offer(text) to anon, authenticated;

-- Add application progress to the existing journey payload without widening
-- the data returned by the original bearer-scoped function.
alter function public.get_parent_inquiry_journey(text)
  rename to get_parent_inquiry_journey_application_internal;

revoke all on function public.get_parent_inquiry_journey_application_internal(text)
  from public, anon, authenticated;

create or replace function public.get_parent_inquiry_journey(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enrollment public.enrollments%rowtype;
  v_payload jsonb;
begin
  select * into v_enrollment
    from public.enrollments enrollment
   where upper(enrollment.offer_code) = upper(btrim(p_code));
  if v_enrollment.id is null then
    raise exception 'This family link is invalid';
  end if;

  v_payload := public.get_parent_inquiry_journey_application_internal(p_code);
  return v_payload || jsonb_build_object(
    'application', jsonb_build_object(
      'available', v_enrollment.stage = 'application',
      'submitted_at', v_enrollment.application_submitted_at,
      'progress', v_enrollment.application_progress,
      'documents_status', coalesce(v_enrollment.documents_status, '{}'::jsonb)
    )
  );
end;
$$;

revoke all on function public.get_parent_inquiry_journey(text) from public;
grant execute on function public.get_parent_inquiry_journey(text) to anon, authenticated;

create or replace function public.save_parent_inquiry_application(
  p_code text,
  p_application jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enrollment public.enrollments%rowtype;
  v_child_name text;
  v_dob date;
  v_guardian_name text;
  v_guardian_phone text;
  v_guardian_email text;
  v_co_name text;
  v_co_email text;
  v_emergency_name text;
  v_emergency_phone text;
  v_allergies jsonb;
begin
  perform public.assert_rate_limit('parent_inquiry_application', 30, 900, left(upper(btrim(p_code)), 12));
  select * into v_enrollment
    from public.enrollments enrollment
   where upper(enrollment.offer_code) = upper(btrim(p_code))
   for update;
  if v_enrollment.id is null then raise exception 'This family link is invalid'; end if;
  if v_enrollment.stage <> 'application'
     or v_enrollment.child_id is not null
     or coalesce(v_enrollment.offer_status, 'none') in ('sent', 'viewed', 'accepted') then
    raise exception 'This pre-offer application is no longer available';
  end if;
  if jsonb_typeof(p_application) <> 'object' or pg_column_size(p_application) > 32768 then
    raise exception 'Application data is invalid or too large';
  end if;

  v_child_name := btrim(p_application->>'child_full_name');
  v_guardian_name := btrim(p_application->>'primary_guardian_name');
  v_guardian_phone := btrim(p_application->>'primary_guardian_phone');
  v_guardian_email := lower(btrim(coalesce(p_application->>'primary_guardian_email', v_enrollment.guardian_email)));
  v_co_name := nullif(btrim(p_application->>'co_guardian_name'), '');
  v_co_email := nullif(lower(btrim(p_application->>'co_guardian_email')), '');
  v_emergency_name := btrim(p_application->>'emergency_contact_name');
  v_emergency_phone := btrim(p_application->>'emergency_contact_phone');
  v_allergies := coalesce(p_application->'allergies', '[]'::jsonb);

  if char_length(v_child_name) not between 2 and 160
     or char_length(v_guardian_name) not between 2 and 160
     or char_length(v_emergency_name) not between 2 and 160 then
    raise exception 'Enter complete names for the child, guardian, and emergency contact';
  end if;
  if char_length(regexp_replace(v_guardian_phone, '[^0-9]', '', 'g')) not between 7 and 15
     or char_length(regexp_replace(v_emergency_phone, '[^0-9]', '', 'g')) not between 7 and 15 then
    raise exception 'Enter valid guardian and emergency phone numbers';
  end if;
  if v_guardian_email <> lower(coalesce(v_enrollment.guardian_email, '')) then
    raise exception 'The primary guardian email must match this application';
  end if;
  if jsonb_typeof(v_allergies) <> 'array'
     or jsonb_array_length(v_allergies) > 20
     or exists (
       select 1 from jsonb_array_elements(v_allergies) item
        where jsonb_typeof(item) <> 'string' or char_length(item #>> '{}') > 120
     ) then
    raise exception 'Allergies must be a short text list';
  end if;
  if (v_co_name is null) <> (v_co_email is null) then
    raise exception 'Complete both co-guardian fields or leave both blank';
  end if;
  if v_co_name is not null and (
    char_length(v_co_name) not between 2 and 160
    or length(v_co_email) > 320
    or v_co_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    or v_co_email = v_guardian_email
  ) then
    raise exception 'Enter valid, distinct co-guardian details';
  end if;
  begin
    v_dob := (p_application->>'child_date_of_birth')::date;
  exception when others then
    raise exception 'Enter a valid child date of birth';
  end;
  if v_dob > current_date or v_dob < current_date - interval '18 years' then
    raise exception 'Enter a valid child date of birth';
  end if;

  update public.enrollments
     set child_first_name = split_part(v_child_name, ' ', 1),
         child_last_name = nullif(btrim(regexp_replace(v_child_name, '^\S+\s*', '')), ''),
         child_date_of_birth = v_dob,
         guardian_name = v_guardian_name,
         guardian_phone = v_guardian_phone,
         application_data = jsonb_strip_nulls(jsonb_build_object(
           'child_full_name', v_child_name,
           'child_date_of_birth', v_dob,
           'allergies', v_allergies,
           'primary_guardian_name', v_guardian_name,
           'primary_guardian_email', v_guardian_email,
           'primary_guardian_phone', v_guardian_phone,
           'co_guardian_name', v_co_name,
           'co_guardian_email', v_co_email,
           'emergency_contact_name', v_emergency_name,
           'emergency_contact_phone', v_emergency_phone
         )),
         application_progress = greatest(application_progress, 67),
         application_submitted_at = now(),
         parent_workflow_step = 'documents'
   where id = v_enrollment.id;

  return public.get_parent_enrollment_offer(p_code);
end;
$$;

create or replace function public.can_upload_parent_enrollment_document(
  p_code text,
  p_kind text
)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select p_kind in ('immunization', 'birth_certificate', 'custody')
    and exists (
      select 1
        from public.enrollments enrollment
       where upper(enrollment.offer_code) = upper(btrim(p_code))
         and enrollment.application_submitted_at is not null
         and (
           (
             enrollment.offer_status in ('sent', 'viewed')
             and enrollment.offer_expires_at > now()
             and enrollment.offer_accepted_at is not null
           )
           or (
             enrollment.stage = 'application'
             and enrollment.child_id is null
             and coalesce(enrollment.offer_status, 'none') not in ('sent', 'viewed', 'accepted')
           )
         )
    )
$$;

revoke all on function public.can_upload_parent_enrollment_document(text, text) from public;
grant execute on function public.can_upload_parent_enrollment_document(text, text) to anon, authenticated;

create or replace function public.save_parent_inquiry_document(
  p_code text,
  p_kind text,
  p_file_name text,
  p_mime_type text,
  p_file_size bigint,
  p_storage_path text
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_enrollment public.enrollments%rowtype;
  v_expected_prefix text;
  v_previous_path text;
begin
  perform public.assert_rate_limit('parent_inquiry_document', 30, 900, left(upper(btrim(p_code)), 12));
  select * into v_enrollment
    from public.enrollments enrollment
   where upper(enrollment.offer_code) = upper(btrim(p_code))
   for update;
  if v_enrollment.id is null then raise exception 'This family link is invalid'; end if;
  if v_enrollment.stage <> 'application'
     or v_enrollment.child_id is not null
     or coalesce(v_enrollment.offer_status, 'none') in ('sent', 'viewed', 'accepted') then
    raise exception 'This pre-offer application is no longer available';
  end if;
  if v_enrollment.application_submitted_at is null then
    raise exception 'Complete the application before uploading documents';
  end if;
  if p_kind not in ('immunization', 'birth_certificate', 'custody') then
    raise exception 'Unsupported document type';
  end if;
  if nullif(btrim(p_file_name), '') is null or length(p_file_name) > 180 then
    raise exception 'A valid file name is required';
  end if;
  if p_file_size <= 0 or p_file_size > 10485760 then
    raise exception 'Files must be 10 MB or smaller';
  end if;
  if p_mime_type not in ('application/pdf', 'image/jpeg', 'image/png') then
    raise exception 'Use a PDF, JPG, or PNG file';
  end if;

  v_expected_prefix := 'enrollment-offers/' || upper(btrim(p_code)) || '/' || p_kind || '/';
  if left(p_storage_path, length(v_expected_prefix)) <> v_expected_prefix
     or length(p_storage_path) > 500 then
    raise exception 'Invalid upload path';
  end if;
  if not exists (
    select 1 from storage.objects object
     where object.bucket_id = 'documents' and object.name = p_storage_path
  ) then
    raise exception 'Upload was not found';
  end if;

  select document.storage_path into v_previous_path
    from public.enrollment_application_documents document
   where document.enrollment_id = v_enrollment.id and document.kind = p_kind
   for update;

  insert into public.enrollment_application_documents (
    daycare_id, enrollment_id, kind, file_name, mime_type, file_size, storage_path
  ) values (
    v_enrollment.daycare_id, v_enrollment.id, p_kind, btrim(p_file_name),
    p_mime_type, p_file_size, p_storage_path
  ) on conflict (enrollment_id, kind) do update set
    file_name = excluded.file_name,
    mime_type = excluded.mime_type,
    file_size = excluded.file_size,
    storage_path = excluded.storage_path,
    status = 'uploaded',
    uploaded_at = now(),
    verified_at = null,
    verified_by = null;

  update public.enrollments
     set application_progress = greatest(application_progress, 75),
         documents_status = jsonb_set(
           coalesce(documents_status, '{}'::jsonb),
           array[p_kind],
           jsonb_build_object('status', 'received', 'received_at', now()),
           true
         )
   where id = v_enrollment.id;

  return public.get_parent_enrollment_offer(p_code) || jsonb_build_object(
    'replaced_storage_path', case
      when v_previous_path is distinct from p_storage_path then v_previous_path
      else null
    end
  );
end;
$$;

create or replace function public.complete_parent_inquiry_application(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enrollment public.enrollments%rowtype;
begin
  perform public.assert_rate_limit('parent_inquiry_application_complete', 30, 900, left(upper(btrim(p_code)), 12));
  select * into v_enrollment
    from public.enrollments enrollment
   where upper(enrollment.offer_code) = upper(btrim(p_code))
   for update;
  if v_enrollment.id is null then raise exception 'This family link is invalid'; end if;
  if v_enrollment.stage <> 'application'
     or v_enrollment.child_id is not null
     or coalesce(v_enrollment.offer_status, 'none') in ('sent', 'viewed', 'accepted') then
    raise exception 'This pre-offer application is no longer available';
  end if;
  if v_enrollment.application_submitted_at is null then
    raise exception 'Complete the family details first';
  end if;

  update public.enrollments
     set application_progress = greatest(application_progress, 80),
         parent_workflow_step = 'documents'
   where id = v_enrollment.id;

  return public.get_parent_enrollment_offer(p_code);
end;
$$;

revoke all on function public.save_parent_inquiry_application(text, jsonb) from public;
grant execute on function public.save_parent_inquiry_application(text, jsonb) to anon, authenticated;
revoke all on function public.save_parent_inquiry_document(text, text, text, text, bigint, text) from public;
grant execute on function public.save_parent_inquiry_document(text, text, text, text, bigint, text) to anon, authenticated;
revoke all on function public.complete_parent_inquiry_application(text) from public;
grant execute on function public.complete_parent_inquiry_application(text) to anon, authenticated;

notify pgrst, 'reload schema';
