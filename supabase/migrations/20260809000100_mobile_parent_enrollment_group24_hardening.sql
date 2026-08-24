-- Parent Mobile Group 24 hardening: durable details progress, strict workflow
-- gates, normalized application data, and a real enrollment receipt outbox.

alter table public.enrollment_offer_payments
  add column if not exists receipt_number text,
  add column if not exists receipt_emailed_to text;

create or replace function public.get_parent_enrollment_offer(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_offer public.enrollments%rowtype;
  v_payload jsonb;
begin
  perform public.assert_rate_limit('parent_offer_preview', 40, 900, left(upper(btrim(p_code)), 12));

  select * into v_offer
  from public.enrollments
  where upper(offer_code) = upper(btrim(p_code))
  for update;

  if v_offer.id is null then raise exception 'This offer link is invalid'; end if;

  if v_offer.offer_expires_at <= now()
     and v_offer.offer_status in ('sent', 'viewed') then
    update public.enrollments set offer_status = 'expired' where id = v_offer.id;
    v_offer.offer_status := 'expired';
  elsif v_offer.offer_status = 'sent' then
    update public.enrollments
    set offer_status = 'viewed', offer_viewed_at = coalesce(offer_viewed_at, now())
    where id = v_offer.id;
    v_offer.offer_status := 'viewed';
    v_offer.offer_viewed_at := coalesce(v_offer.offer_viewed_at, now());
  end if;

  select jsonb_build_object(
    'id', v_offer.id,
    'daycare_name', d.name,
    'daycare_address', d.address,
    'daycare_phone', d.phone,
    'child_first_name', v_offer.child_first_name,
    'child_last_name', v_offer.child_last_name,
    'child_date_of_birth', v_offer.child_date_of_birth,
    'guardian_name', v_offer.guardian_name,
    'guardian_email', v_offer.guardian_email,
    'guardian_phone', v_offer.guardian_phone,
    'classroom_name', c.name,
    'desired_start_date', v_offer.desired_start_date,
    'schedule', coalesce(v_offer.schedule, '{}'::jsonb),
    'tuition_cents', coalesce(v_offer.offer_tuition_cents, 0),
    'deposit_cents', coalesce(v_offer.offer_deposit_cents, 0),
    'currency', 'CAD',
    'offer_status', v_offer.offer_status,
    'offer_expires_at', v_offer.offer_expires_at,
    'offer_accepted_at', v_offer.offer_accepted_at,
    'offer_decline_reason', v_offer.offer_decline_reason,
    'workflow_step', v_offer.parent_workflow_step,
    'application_data', coalesce(v_offer.application_data, '{}'::jsonb),
    'application_progress', v_offer.application_progress,
    'agreement_data', coalesce(v_offer.agreement_data, '{}'::jsonb),
    'agreement_signed_at', v_offer.agreement_signed_at,
    'deposit_status', v_offer.deposit_status,
    'payment_mode', v_offer.payment_mode,
    'child_id', v_offer.child_id,
    'account_linked', v_offer.parent_account_linked_at is not null,
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', doc.id,
        'kind', doc.kind,
        'file_name', doc.file_name,
        'mime_type', doc.mime_type,
        'file_size', doc.file_size,
        'status', doc.status,
        'uploaded_at', doc.uploaded_at
      ) order by doc.kind)
      from public.enrollment_application_documents doc
      where doc.enrollment_id = v_offer.id
    ), '[]'::jsonb),
    'deposit_payment', (
      select jsonb_build_object(
        'id', payment.id,
        'amount_cents', payment.amount_cents,
        'currency', payment.currency,
        'provider', payment.provider,
        'status', payment.status,
        'include_first_month', payment.include_first_month,
        'settled_at', payment.settled_at,
        'receipt_number', payment.receipt_number,
        'receipt_email', payment.receipt_emailed_to,
        'email_status', coalesce((
          select outbox.status
          from public.notification_outbox outbox
          where outbox.dedupe_key = 'parent-enrollment-receipt:' || payment.id
            and outbox.channel = 'email'
          order by outbox.created_at desc
          limit 1
        ), case when payment.receipt_emailed_to is null then 'not_requested' else 'not_queued' end)
      )
      from public.enrollment_offer_payments payment
      where payment.id = v_offer.deposit_payment_id
    )
  ) into v_payload
  from public.daycares d
  left join public.classrooms c on c.id = v_offer.classroom_id
  where d.id = v_offer.daycare_id;

  return v_payload;
end;
$$;

create or replace function public.review_parent_enrollment_offer(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_offer public.enrollments%rowtype;
begin
  perform public.assert_rate_limit('parent_offer_review', 30, 900, left(upper(btrim(p_code)), 12));
  select * into v_offer from public.enrollments
  where upper(offer_code) = upper(btrim(p_code)) for update;
  if v_offer.id is null then raise exception 'This offer link is invalid'; end if;
  if v_offer.offer_status not in ('sent', 'viewed') or v_offer.offer_expires_at <= now() then
    raise exception 'This offer is no longer available';
  end if;
  update public.enrollments
  set offer_status = 'viewed',
      offer_viewed_at = coalesce(offer_viewed_at, now()),
      parent_workflow_step = case
        when parent_workflow_step = 'offer' then 'details'
        else parent_workflow_step
      end
  where id = v_offer.id;
  return public.get_parent_enrollment_offer(p_code);
end;
$$;

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

  if nullif(v_child_name, '') is null or length(v_child_name) > 160
     or nullif(v_guardian_name, '') is null or length(v_guardian_name) > 160
     or nullif(v_guardian_phone, '') is null or length(v_guardian_phone) > 40
     or nullif(v_emergency_name, '') is null or length(v_emergency_name) > 160
     or nullif(v_emergency_phone, '') is null or length(v_emergency_phone) > 40 then
    raise exception 'Complete all required application fields';
  end if;
  if v_guardian_email <> lower(coalesce(v_offer.guardian_email, '')) then
    raise exception 'The primary guardian email must match this offer';
  end if;
  if jsonb_typeof(v_allergies) <> 'array' or jsonb_array_length(v_allergies) > 20 then
    raise exception 'Allergies must be a short list';
  end if;
  if (v_co_name is null) <> (v_co_email is null) then
    raise exception 'Complete both co-guardian fields or leave both blank';
  end if;
  if v_co_name is not null and (length(v_co_name) > 160 or length(v_co_email) > 320
     or v_co_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     or v_co_email = v_guardian_email) then
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

create or replace function public.continue_parent_enrollment_documents(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_offer public.enrollments%rowtype;
begin
  perform public.assert_rate_limit('parent_offer_documents_continue', 30, 900, left(upper(btrim(p_code)), 12));
  select * into v_offer from public.enrollments
  where upper(offer_code) = upper(btrim(p_code)) for update;
  if v_offer.id is null then raise exception 'This offer link is invalid'; end if;
  if v_offer.offer_status not in ('sent', 'viewed') or v_offer.offer_expires_at <= now() then
    raise exception 'This offer is no longer available';
  end if;
  if v_offer.offer_accepted_at is null or v_offer.application_submitted_at is null then
    raise exception 'Complete the application first';
  end if;
  update public.enrollments set parent_workflow_step = 'agreement' where id = v_offer.id;
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
declare v_offer public.enrollments%rowtype;
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

  update public.enrollments
  set agreement_version = '2026-08-08',
      agreement_data = jsonb_build_object(
        'signature_name', btrim(p_signature_name),
        'acknowledge_tuition', p_acknowledge_tuition,
        'acknowledge_policies', p_acknowledge_policies,
        'photo_consent', p_photo_consent,
        'signed_ip', coalesce(nullif(current_setting('request.headers', true), '')::jsonb->>'x-forwarded-for', 'unknown')
      ),
      agreement_signed_at = now(),
      application_progress = 100,
      parent_workflow_step = 'deposit'
  where id = v_offer.id;
  return public.get_parent_enrollment_offer(p_code);
end;
$$;

drop policy if exists "families upload active enrollment offer documents" on storage.objects;
create policy "families upload active enrollment offer documents"
  on storage.objects for insert to anon, authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = 'enrollment-offers'
    and (storage.foldername(name))[3] in ('immunization', 'birth_certificate', 'custody')
    and exists (
      select 1 from public.enrollments enrollment
      where upper(enrollment.offer_code) = upper((storage.foldername(name))[2])
        and enrollment.offer_status in ('sent', 'viewed')
        and enrollment.offer_expires_at > now()
        and enrollment.offer_accepted_at is not null
        and enrollment.application_submitted_at is not null
    )
  );

create or replace function public.decline_parent_enrollment_offer(
  p_code text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_offer public.enrollments%rowtype;
begin
  perform public.assert_rate_limit('parent_offer_decline', 15, 900, left(upper(btrim(p_code)), 12));
  select * into v_offer from public.enrollments
  where upper(offer_code) = upper(btrim(p_code)) for update;
  if v_offer.id is null then raise exception 'This offer link is invalid'; end if;
  if v_offer.offer_status = 'declined' then return public.get_parent_enrollment_offer(p_code); end if;
  if v_offer.offer_status not in ('sent', 'viewed') or v_offer.offer_expires_at <= now() then
    raise exception 'This offer is no longer available';
  end if;
  if v_offer.deposit_status = 'paid' then raise exception 'An enrolled offer cannot be declined'; end if;
  update public.enrollments
  set offer_status = 'declined', offer_declined_at = now(),
      offer_decline_reason = nullif(left(btrim(p_reason), 200), ''),
      parent_workflow_step = 'declined', waitlist_status = 'active'
  where id = v_offer.id;
  return public.get_parent_enrollment_offer(p_code);
end;
$$;

create or replace function public.complete_demo_parent_enrollment_deposit(
  p_code text,
  p_include_first_month boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer public.enrollments%rowtype;
  v_payment public.enrollment_offer_payments%rowtype;
  v_child uuid;
  v_amount int;
  v_allergies text[] := '{}'::text[];
  v_receipt text;
begin
  perform public.assert_rate_limit('parent_offer_demo_payment', 10, 900, left(upper(btrim(p_code)), 12));
  select * into v_offer from public.enrollments
  where upper(offer_code) = upper(btrim(p_code)) for update;
  if v_offer.id is null then raise exception 'This offer link is invalid'; end if;
  if v_offer.payment_mode <> 'demo' then raise exception 'Online deposit payment is not configured for this offer'; end if;

  if v_offer.deposit_status = 'paid' then
    select * into v_payment from public.enrollment_offer_payments
    where id = v_offer.deposit_payment_id and enrollment_id = v_offer.id and status = 'succeeded';
    if v_payment.id is null then raise exception 'The settled deposit record is unavailable'; end if;
  else
    if v_offer.offer_status not in ('sent', 'viewed') or v_offer.offer_expires_at <= now() then
      raise exception 'This offer is no longer available';
    end if;
    if v_offer.offer_accepted_at is null or v_offer.application_submitted_at is null then
      raise exception 'Complete the application first';
    end if;
    if v_offer.agreement_signed_at is null then raise exception 'Sign the agreement first'; end if;

    v_amount := coalesce(v_offer.offer_deposit_cents, 0)
      + case when p_include_first_month then coalesce(v_offer.offer_tuition_cents, 0) else 0 end;
    v_receipt := 'DL-ENR-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

    insert into public.enrollment_offer_payments (
      enrollment_id, daycare_id, amount_cents, currency, provider,
      provider_reference, status, include_first_month, settled_at,
      receipt_number, receipt_emailed_to
    ) values (
      v_offer.id, v_offer.daycare_id, v_amount, 'CAD', 'demo',
      'demo_' || replace(gen_random_uuid()::text, '-', ''), 'succeeded',
      p_include_first_month, now(), v_receipt, lower(v_offer.guardian_email)
    ) returning * into v_payment;

    if jsonb_typeof(v_offer.application_data->'allergies') = 'array' then
      select coalesce(array_agg(value), '{}'::text[]) into v_allergies
      from jsonb_array_elements_text(v_offer.application_data->'allergies');
    end if;

    if v_offer.child_id is null then
      insert into public.children (
        daycare_id, classroom_id, first_name, last_name, date_of_birth,
        allergies, emergency_contacts, enrolled_on, setup_state
      ) values (
        v_offer.daycare_id, v_offer.classroom_id,
        coalesce(nullif(v_offer.child_first_name, ''), 'New'),
        coalesce(nullif(v_offer.child_last_name, ''), 'Family'),
        v_offer.child_date_of_birth, v_allergies,
        jsonb_build_array(jsonb_build_object(
          'name', v_offer.application_data->>'emergency_contact_name',
          'phone', v_offer.application_data->>'emergency_contact_phone'
        )),
        coalesce(v_offer.desired_start_date, current_date),
        jsonb_build_object('enrollment_documents_pending', true)
      ) returning id into v_child;
    else
      v_child := v_offer.child_id;
    end if;

    update public.enrollments
    set child_id = v_child, stage = 'enrolled', offer_status = 'accepted',
        waitlist_status = 'not_waitlisted', deposit_status = 'paid',
        deposit_paid_at = now(), deposit_payment_id = v_payment.id,
        parent_workflow_step = 'enrolled', stage_changed_at = now(),
        onboarding_steps = coalesce(onboarding_steps, '{}'::jsonb)
          || jsonb_build_object('offer_complete', true, 'account_linked', false)
    where id = v_offer.id;
  end if;

  update public.enrollment_offer_payments
  set receipt_number = coalesce(receipt_number, 'DL-ENR-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
      receipt_emailed_to = coalesce(receipt_emailed_to, lower(v_offer.guardian_email))
  where id = v_payment.id
  returning * into v_payment;

  perform set_config('dailylog.parent_enrollment_payment_id', v_payment.id::text, true);
  if v_payment.receipt_emailed_to is not null then
    insert into public.notification_outbox (
      daycare_id, recipient_email, channel, kind, title, body, payload, dedupe_key
    ) values (
      v_offer.daycare_id,
      v_payment.receipt_emailed_to,
      'email',
      'parent_enrollment_receipt',
      'Enrollment confirmed for ' || coalesce(v_offer.child_first_name, 'your child'),
      'Your enrollment deposit of ' || v_payment.currency || ' '
        || to_char(v_payment.amount_cents / 100.0, 'FM9999990.00')
        || ' was received. Receipt ' || v_payment.receipt_number
        || E'.\n\nOpen your enrollment securely in DailyLog: dailylog://offer?code='
        || upper(btrim(p_code)),
      jsonb_build_object(
        'type', 'parent_enrollment_receipt',
        'screen', 'EnrollmentOffer',
        'paymentId', v_payment.id,
        'enrollmentId', v_offer.id,
        'offerCode', upper(btrim(p_code)),
        'receiptNumber', v_payment.receipt_number,
        'amountCents', v_payment.amount_cents,
        'currency', v_payment.currency
      ),
      'parent-enrollment-receipt:' || v_payment.id
    ) on conflict do nothing;
  end if;

  return public.get_parent_enrollment_offer(p_code);
end;
$$;

create or replace function public.enforce_notification_enqueue_permission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_area text;
  v_marker text;
  v_family_id uuid;
  v_payment_id uuid;
  v_enrollment_id uuid;
begin
  if auth.role() = 'service_role' or (auth.uid() is null and auth.role() is null) then
    return new;
  end if;

  if auth.role() = 'anon' and new.kind in (
    'enrollment_inquiry_received', 'tour_confirmation', 'waitlist_confirmation'
  ) then
    return new;
  end if;

  if new.kind = 'parent_enrollment_receipt'
     and new.channel = 'email' and new.recipient_id is null then
    v_marker := current_setting('dailylog.parent_enrollment_payment_id', true);
    begin
      v_payment_id := nullif(new.payload->>'paymentId', '')::uuid;
      v_enrollment_id := nullif(new.payload->>'enrollmentId', '')::uuid;
    exception when invalid_text_representation then
      v_payment_id := null;
      v_enrollment_id := null;
    end;
    if v_marker = v_payment_id::text and exists (
      select 1
      from public.enrollment_offer_payments payment
      join public.enrollments enrollment on enrollment.id = payment.enrollment_id
      where payment.id = v_payment_id
        and payment.enrollment_id = v_enrollment_id
        and payment.status = 'succeeded'
        and lower(payment.receipt_emailed_to) = lower(new.recipient_email)
        and lower(enrollment.guardian_email) = lower(new.recipient_email)
    ) then
      return new;
    end if;
  end if;

  if auth.uid() is not null and new.kind = 'parent_payment_receipt'
     and new.channel = 'email' and new.recipient_id is null then
    v_marker := current_setting('dailylog.parent_demo_payment_family', true);
    begin
      v_family_id := nullif(new.payload->>'familyId', '')::uuid;
      v_payment_id := nullif(new.payload->>'paymentId', '')::uuid;
    exception when invalid_text_representation then
      v_family_id := null;
      v_payment_id := null;
    end;
    if v_marker = v_family_id::text
       and coalesce(public.can_manage_family_billing(v_family_id), false)
       and exists (
         select 1 from public.payments payment
         where payment.id = v_payment_id
           and payment.family_id = v_family_id
           and payment.status = 'succeeded'
           and lower(payment.receipt_emailed_to) = lower(new.recipient_email)
       ) then
      return new;
    end if;
  end if;

  v_area := case
    when new.kind in (
      'enrollment_inquiry_received', 'tour_confirmation', 'enrollment_application',
      'enrollment_documents', 'waitlist_offer', 'offer_reminder',
      'offer_withdrawn', 'inquiry_closed', 'waitlist_checkin',
      'waitlist_confirmation', 'waitlist_position_changed'
    ) then 'enrollment'
    when new.kind = 'announcement' then 'broadcasts'
    when new.kind = 'incident' then 'incidents'
    when new.kind = 'medication' then 'medications'
    when new.kind in ('invoice', 'payment', 'parent_payment_receipt', 'parent_enrollment_receipt') then 'billing'
    when new.kind = 'staff_invite' then 'staff'
    when new.kind = 'parent_invite' then 'children'
    else 'daily_logs'
  end;
  if not public.has_permission(v_area, 'edit') then
    raise exception '% edit permission required', v_area;
  end if;
  return new;
end;
$$;

revoke all on function public.review_parent_enrollment_offer(text) from public;
grant execute on function public.review_parent_enrollment_offer(text) to anon, authenticated;
