-- ==========================================================================
-- Parent mobile Group 24 completion
-- Durable agreement history, safe document replacement, stricter family data,
-- and co-guardian handoff after the primary account is linked.
-- ==========================================================================

create table if not exists public.enrollment_agreement_signatures (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references public.daycares(id) on delete restrict,
  enrollment_id uuid not null references public.enrollments(id) on delete restrict,
  version text not null,
  signature_name text not null,
  terms_snapshot jsonb not null,
  application_snapshot jsonb not null default '{}'::jsonb,
  photo_consent boolean not null default false,
  signed_at timestamptz not null default now(),
  signed_ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists enrollment_agreement_signatures_enrollment_idx
  on public.enrollment_agreement_signatures (enrollment_id, signed_at desc);

alter table public.enrollment_agreement_signatures enable row level security;

drop policy if exists "staff read enrollment agreement signatures"
  on public.enrollment_agreement_signatures;
create policy "staff read enrollment agreement signatures"
  on public.enrollment_agreement_signatures for select to authenticated
  using (
    daycare_id = public.get_my_daycare_id()
    and public.has_permission('enrollment', 'view')
  );

drop policy if exists "parents read linked enrollment agreement signatures"
  on public.enrollment_agreement_signatures;
create policy "parents read linked enrollment agreement signatures"
  on public.enrollment_agreement_signatures for select to authenticated
  using (
    exists (
      select 1
      from public.enrollments enrollment
      join public.parent_children link on link.child_id = enrollment.child_id
      where enrollment.id = enrollment_agreement_signatures.enrollment_id
        and link.parent_id = auth.uid()
    )
  );

revoke all on public.enrollment_agreement_signatures from anon, authenticated;
grant select on public.enrollment_agreement_signatures to authenticated;

create or replace function public.save_parent_enrollment_application(
  p_code text,
  p_application jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer public.enrollments%rowtype;
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
  perform public.assert_rate_limit('parent_offer_application', 30, 900, left(upper(btrim(p_code)), 12));
  select * into v_offer from public.enrollments
  where upper(offer_code) = upper(btrim(p_code)) for update;
  if v_offer.id is null then raise exception 'This offer link is invalid'; end if;
  if v_offer.offer_status not in ('sent', 'viewed') or v_offer.offer_expires_at <= now() then
    raise exception 'This offer is no longer available';
  end if;
  if v_offer.offer_accepted_at is null then raise exception 'Accept the offer first'; end if;
  if jsonb_typeof(p_application) <> 'object' or pg_column_size(p_application) > 32768 then
    raise exception 'Application data is invalid or too large';
  end if;

  v_child_name := btrim(p_application->>'child_full_name');
  v_guardian_name := btrim(p_application->>'primary_guardian_name');
  v_guardian_phone := btrim(p_application->>'primary_guardian_phone');
  v_guardian_email := lower(btrim(coalesce(p_application->>'primary_guardian_email', v_offer.guardian_email)));
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
  if v_guardian_email <> lower(coalesce(v_offer.guardian_email, '')) then
    raise exception 'The primary guardian email must match this offer';
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
      application_progress = greatest(application_progress, 34),
      application_submitted_at = now(),
      parent_workflow_step = 'documents'
  where id = v_offer.id;
  return public.get_parent_enrollment_offer(p_code);
end;
$$;

create or replace function public.save_parent_enrollment_document(
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
  v_offer public.enrollments%rowtype;
  v_expected_prefix text;
  v_previous_path text;
begin
  perform public.assert_rate_limit('parent_offer_document', 30, 900, left(upper(btrim(p_code)), 12));
  select * into v_offer from public.enrollments
  where upper(offer_code) = upper(btrim(p_code)) for update;
  if v_offer.id is null then raise exception 'This offer link is invalid'; end if;
  if v_offer.offer_status not in ('sent', 'viewed') or v_offer.offer_expires_at <= now() then
    raise exception 'This offer is no longer available';
  end if;
  if v_offer.offer_accepted_at is null or v_offer.application_submitted_at is null then
    raise exception 'Complete the application before uploading documents';
  end if;
  if p_kind not in ('immunization', 'birth_certificate', 'custody') then
    raise exception 'Unsupported document type';
  end if;
  if nullif(btrim(p_file_name), '') is null or length(p_file_name) > 180 then
    raise exception 'A valid file name is required';
  end if;
  if p_file_size <= 0 or p_file_size > 10485760 then raise exception 'Files must be 10 MB or smaller'; end if;
  if p_mime_type not in ('application/pdf', 'image/jpeg', 'image/png') then
    raise exception 'Use a PDF, JPG, or PNG file';
  end if;

  v_expected_prefix := 'enrollment-offers/' || upper(btrim(p_code)) || '/' || p_kind || '/';
  if left(p_storage_path, length(v_expected_prefix)) <> v_expected_prefix
     or length(p_storage_path) > 500 then
    raise exception 'Invalid upload path';
  end if;
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'documents' and name = p_storage_path
  ) then raise exception 'Upload was not found'; end if;

  select document.storage_path into v_previous_path
  from public.enrollment_application_documents document
  where document.enrollment_id = v_offer.id and document.kind = p_kind
  for update;

  insert into public.enrollment_application_documents (
    daycare_id, enrollment_id, kind, file_name, mime_type, file_size, storage_path
  ) values (
    v_offer.daycare_id, v_offer.id, p_kind, btrim(p_file_name),
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

  if v_previous_path is not null and v_previous_path <> p_storage_path then
    delete from storage.objects
    where bucket_id = 'documents' and name = v_previous_path;
  end if;

  update public.enrollments
  set application_progress = greatest(application_progress, 67),
      parent_workflow_step = 'documents',
      documents_status = jsonb_set(
        coalesce(documents_status, '{}'::jsonb), array[p_kind], '"received"'::jsonb, true
      )
  where id = v_offer.id;
  return public.get_parent_enrollment_offer(p_code);
end;
$$;

create or replace function public.discard_parent_enrollment_upload(
  p_code text,
  p_storage_path text
)
returns boolean
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_offer public.enrollments%rowtype;
  v_prefix text;
begin
  select * into v_offer from public.enrollments
  where upper(offer_code) = upper(btrim(p_code));
  if v_offer.id is null then return false; end if;
  v_prefix := 'enrollment-offers/' || upper(btrim(p_code)) || '/';
  if left(p_storage_path, length(v_prefix)) <> v_prefix then return false; end if;
  if exists (
    select 1 from public.enrollment_application_documents document
    where document.enrollment_id = v_offer.id and document.storage_path = p_storage_path
  ) then return false; end if;
  delete from storage.objects
  where bucket_id = 'documents' and name = p_storage_path;
  return found;
end;
$$;

create or replace function public.sign_parent_enrollment_agreement(
  p_code text,
  p_signature_name text,
  p_acknowledge_tuition boolean,
  p_acknowledge_policies boolean,
  p_photo_consent boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer public.enrollments%rowtype;
  v_signature uuid;
  v_signed_ip text;
  v_user_agent text;
  v_terms jsonb;
begin
  perform public.assert_rate_limit('parent_offer_agreement', 20, 900, left(upper(btrim(p_code)), 12));
  select * into v_offer from public.enrollments
  where upper(offer_code) = upper(btrim(p_code)) for update;
  if v_offer.id is null then raise exception 'This offer link is invalid'; end if;
  if v_offer.offer_status not in ('sent', 'viewed') or v_offer.offer_expires_at <= now() then
    raise exception 'This offer is no longer available';
  end if;
  if v_offer.offer_accepted_at is null or v_offer.application_submitted_at is null then
    raise exception 'Complete the application first';
  end if;
  if nullif(btrim(p_signature_name), '') is null or length(btrim(p_signature_name)) > 160 then
    raise exception 'Sign the agreement to continue';
  end if;
  if not p_acknowledge_tuition or not p_acknowledge_policies then
    raise exception 'Both required acknowledgements must be accepted';
  end if;

  begin
    v_signed_ip := coalesce(
      nullif(current_setting('request.headers', true), '')::jsonb->>'x-forwarded-for',
      'unknown'
    );
    v_user_agent := nullif(current_setting('request.headers', true), '')::jsonb->>'user-agent';
  exception when others then
    v_signed_ip := 'unknown';
    v_user_agent := null;
  end;

  select jsonb_build_object(
    'daycare_name', daycare.name,
    'daycare_address', daycare.address,
    'classroom_name', classroom.name,
    'desired_start_date', v_offer.desired_start_date,
    'schedule', coalesce(v_offer.schedule, '{}'::jsonb),
    'tuition_cents', coalesce(v_offer.offer_tuition_cents, 0),
    'deposit_cents', coalesce(v_offer.offer_deposit_cents, 0),
    'currency', 'CAD',
    'tuition_terms', 'Tuition is billed monthly in advance and center withdrawal notice requirements apply.',
    'center_policies', 'Attendance, illness, medication, pickup, and safeguarding policies apply.'
  ) into v_terms
  from public.daycares daycare
  left join public.classrooms classroom on classroom.id = v_offer.classroom_id
  where daycare.id = v_offer.daycare_id;

  insert into public.enrollment_agreement_signatures (
    daycare_id, enrollment_id, version, signature_name, terms_snapshot,
    application_snapshot, photo_consent, signed_ip, user_agent
  ) values (
    v_offer.daycare_id, v_offer.id, '2026-08-21', btrim(p_signature_name),
    v_terms, coalesce(v_offer.application_data, '{}'::jsonb),
    p_photo_consent, v_signed_ip, v_user_agent
  ) returning id into v_signature;

  update public.enrollments
  set agreement_version = '2026-08-21',
      agreement_data = jsonb_build_object(
        'signature_id', v_signature,
        'signature_name', btrim(p_signature_name),
        'acknowledge_tuition', p_acknowledge_tuition,
        'acknowledge_policies', p_acknowledge_policies,
        'photo_consent', p_photo_consent,
        'signed_ip', v_signed_ip,
        'terms_snapshot', v_terms
      ),
      agreement_signed_at = now(),
      application_progress = 100,
      parent_workflow_step = 'deposit'
  where id = v_offer.id;
  return public.get_parent_enrollment_offer(p_code);
end;
$$;

create or replace function public.link_parent_enrollment_account(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer public.enrollments%rowtype;
  v_email text;
  v_role text;
  v_co_name text;
  v_co_email text;
  v_invite_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in or create an account first'; end if;
  perform public.assert_rate_limit('parent_offer_link_account', 10, 900, auth.uid()::text);
  select email, role into v_email, v_role from public.profiles where id = auth.uid();
  select * into v_offer from public.enrollments
  where upper(offer_code) = upper(btrim(p_code)) for update;
  if v_offer.id is null then raise exception 'This offer link is invalid'; end if;
  if v_offer.stage <> 'enrolled' or v_offer.child_id is null then raise exception 'Complete enrollment first'; end if;
  if lower(coalesce(v_email, '')) <> lower(coalesce(v_offer.guardian_email, '')) then
    raise exception 'Sign in with the email address this offer was sent to';
  end if;
  if v_role <> 'parent' then raise exception 'A parent account is required'; end if;

  update public.profiles
  set daycare_id = coalesce(daycare_id, v_offer.daycare_id)
  where id = auth.uid()
    and (daycare_id is null or daycare_id = v_offer.daycare_id);
  if not found then raise exception 'This account belongs to another center'; end if;

  insert into public.parent_children (
    parent_id, child_id, relationship, pickup_authorized, is_primary, consent_given_at
  ) values (auth.uid(), v_offer.child_id, 'Parent/guardian', true, true, now())
  on conflict (parent_id, child_id) do update set
    pickup_authorized = true, is_primary = true,
    consent_given_at = coalesce(parent_children.consent_given_at, now());

  v_co_name := nullif(btrim(v_offer.application_data->>'co_guardian_name'), '');
  v_co_email := nullif(lower(btrim(v_offer.application_data->>'co_guardian_email')), '');
  if v_offer.parent_account_linked_at is null
     and v_co_name is not null and v_co_email is not null
     and not exists (
       select 1 from public.parent_children link
       join public.profiles profile on profile.id = link.parent_id
       where link.child_id = v_offer.child_id and lower(profile.email) = v_co_email
     ) then
    select invite.id into v_invite_id
    from public.child_invite_codes invite
    where invite.child_id = v_offer.child_id
      and lower(invite.email) = v_co_email
      and invite.used_at is null
      and (invite.expires_at is null or invite.expires_at > now())
    order by invite.created_at desc
    limit 1;

    if v_invite_id is null then
      insert into public.child_invite_codes (
        daycare_id, child_id, code, email, relationship, created_by, expires_at
      ) values (
        v_offer.daycare_id, v_offer.child_id, public.generate_invite_code(),
        v_co_email, 'Parent/guardian', auth.uid(), now() + interval '14 days'
      ) returning id into v_invite_id;
    end if;
  end if;

  update public.enrollments
  set parent_account_linked_at = coalesce(parent_account_linked_at, now()),
      onboarding_steps = coalesce(onboarding_steps, '{}'::jsonb)
        || jsonb_build_object('account_linked', true),
      application_data = case when v_invite_id is null then application_data else
        coalesce(application_data, '{}'::jsonb) || jsonb_build_object(
          'co_guardian_invite_id', v_invite_id,
          'co_guardian_invite_created_at', now()
        ) end
  where id = v_offer.id;
  return public.get_parent_enrollment_offer(p_code) || jsonb_build_object(
    'co_guardian_invite', case when v_invite_id is null then null else (
      select jsonb_build_object(
        'id', invite.id,
        'email', invite.email,
        'relationship', invite.relationship,
        'code', invite.code,
        'expires_at', invite.expires_at
      )
      from public.child_invite_codes invite
      where invite.id = v_invite_id
    ) end
  );
end;
$$;

revoke all on function public.discard_parent_enrollment_upload(text, text) from public;
grant execute on function public.discard_parent_enrollment_upload(text, text) to anon, authenticated;
grant execute on function public.save_parent_enrollment_application(text, jsonb) to anon, authenticated;
grant execute on function public.save_parent_enrollment_document(text, text, text, text, bigint, text) to anon, authenticated;
grant execute on function public.sign_parent_enrollment_agreement(text, text, boolean, boolean, boolean) to anon, authenticated;
grant execute on function public.link_parent_enrollment_account(text) to authenticated;

-- Keep the documented dev offer useful after migration-driven QA runs.
update public.enrollments
set offer_sent_at = now(),
    offer_viewed_at = null,
    offer_expires_at = now() + interval '7 days',
    offer_status = 'sent',
    offer_accepted_at = null,
    offer_declined_at = null,
    offer_decline_reason = null,
    parent_workflow_step = 'offer',
    application_submitted_at = null,
    agreement_version = null,
    agreement_data = '{}'::jsonb,
    agreement_signed_at = null,
    deposit_status = 'unpaid',
    deposit_paid_at = null,
    deposit_payment_id = null,
    parent_account_linked_at = null,
    application_progress = 0,
    application_data = jsonb_build_object(
      'child_full_name', 'Mia Baker',
      'child_date_of_birth', '2025-07-18',
      'allergies', jsonb_build_array('Egg'),
      'primary_guardian_name', 'Olivia Baker',
      'primary_guardian_email', 'olivia.baker@family.test',
      'primary_guardian_phone', '416-555-0201',
      'co_guardian_name', 'Noah Baker',
      'co_guardian_email', 'noah.baker@family.test',
      'emergency_contact_name', 'Ava Baker',
      'emergency_contact_phone', '416-555-0202'
    ),
    stage = 'offer',
    stage_changed_at = now(),
    waitlist_status = 'offer',
    desired_start_date = current_date + 28,
    onboarding_steps = '{}'::jsonb
where id = '41000000-0000-4000-a000-000000000001'
  and guardian_email = 'olivia.baker@family.test';
