-- ============================================================================
-- DailyLog mobile parent Group 24
-- Secure offer -> application -> documents -> agreement -> deposit -> enrolled
-- ============================================================================

alter table public.enrollments
  add column if not exists offer_code text,
  add column if not exists offer_accepted_at timestamptz,
  add column if not exists offer_declined_at timestamptz,
  add column if not exists offer_decline_reason text,
  add column if not exists parent_workflow_step text not null default 'offer',
  add column if not exists application_submitted_at timestamptz,
  add column if not exists agreement_version text,
  add column if not exists agreement_data jsonb not null default '{}'::jsonb,
  add column if not exists agreement_signed_at timestamptz,
  add column if not exists deposit_status text not null default 'unpaid',
  add column if not exists deposit_paid_at timestamptz,
  add column if not exists deposit_payment_id uuid,
  add column if not exists payment_mode text not null default 'provider',
  add column if not exists parent_account_linked_at timestamptz;

create unique index if not exists enrollments_offer_code_unique
  on public.enrollments (upper(offer_code)) where offer_code is not null;

alter table public.enrollments drop constraint if exists enrollments_parent_workflow_step_check;
alter table public.enrollments add constraint enrollments_parent_workflow_step_check
  check (parent_workflow_step in (
    'offer', 'details', 'application', 'documents', 'agreement', 'deposit',
    'enrolled', 'declined'
  ));

alter table public.enrollments drop constraint if exists enrollments_deposit_status_check;
alter table public.enrollments add constraint enrollments_deposit_status_check
  check (deposit_status in ('unpaid', 'processing', 'paid', 'failed', 'refunded'));

alter table public.enrollments drop constraint if exists enrollments_payment_mode_check;
alter table public.enrollments add constraint enrollments_payment_mode_check
  check (payment_mode in ('provider', 'manual', 'demo'));

create table if not exists public.enrollment_application_documents (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references public.daycares(id) on delete cascade,
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  kind text not null check (kind in ('immunization', 'birth_certificate', 'custody')),
  file_name text not null,
  mime_type text not null,
  file_size bigint not null check (file_size > 0 and file_size <= 10485760),
  storage_path text not null unique,
  status text not null default 'uploaded' check (status in ('uploaded', 'verified', 'rejected')),
  uploaded_at timestamptz not null default now(),
  verified_at timestamptz,
  verified_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (enrollment_id, kind)
);

create index if not exists enrollment_application_documents_enrollment_idx
  on public.enrollment_application_documents (enrollment_id, kind);

alter table public.enrollment_application_documents enable row level security;

drop policy if exists "staff read enrollment application documents" on public.enrollment_application_documents;
create policy "staff read enrollment application documents"
  on public.enrollment_application_documents for select
  using (
    has_permission('enrollment', 'view')
    and daycare_id = get_my_daycare_id()
  );

drop policy if exists "staff manage enrollment application documents" on public.enrollment_application_documents;
create policy "staff manage enrollment application documents"
  on public.enrollment_application_documents for all
  using (
    has_permission('enrollment', 'edit')
    and daycare_id = get_my_daycare_id()
  )
  with check (
    has_permission('enrollment', 'edit')
    and daycare_id = get_my_daycare_id()
  );

create table if not exists public.enrollment_offer_payments (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id) on delete restrict,
  daycare_id uuid not null references public.daycares(id) on delete restrict,
  amount_cents int not null check (amount_cents >= 0),
  currency text not null default 'CAD',
  provider text not null,
  provider_reference text,
  status text not null check (status in ('processing', 'succeeded', 'failed', 'refunded')),
  include_first_month boolean not null default false,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);

create index if not exists enrollment_offer_payments_enrollment_idx
  on public.enrollment_offer_payments (enrollment_id, created_at desc);

alter table public.enrollment_offer_payments enable row level security;

drop policy if exists "staff read enrollment offer payments" on public.enrollment_offer_payments;
create policy "staff read enrollment offer payments"
  on public.enrollment_offer_payments for select
  using (
    has_permission('billing', 'view')
    and daycare_id = get_my_daycare_id()
  );

create or replace function public.generate_parent_offer_code()
returns text
language sql
volatile
set search_path = public
as $$
  select upper(replace(gen_random_uuid()::text, '-', ''))
$$;

revoke all on function public.generate_parent_offer_code() from public;

create or replace function public.ensure_parent_offer_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.offer_status in ('sent', 'viewed') and new.offer_code is null then
    new.offer_code := public.generate_parent_offer_code();
  end if;
  return new;
end;
$$;

drop trigger if exists enrollments_ensure_parent_offer_code on public.enrollments;
create trigger enrollments_ensure_parent_offer_code
  before insert or update of offer_status on public.enrollments
  for each row execute function public.ensure_parent_offer_code();

-- Existing open offers receive a link immediately.
update public.enrollments
set offer_code = public.generate_parent_offer_code()
where offer_status in ('sent', 'viewed') and offer_code is null;

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
  perform assert_rate_limit('parent_offer_preview', 40, 900, left(upper(btrim(p_code)), 12));

  select * into v_offer
  from public.enrollments
  where upper(offer_code) = upper(btrim(p_code))
  for update;

  if v_offer.id is null then
    raise exception 'This offer link is invalid';
  end if;

  if v_offer.offer_expires_at <= now()
     and v_offer.offer_status in ('sent', 'viewed') then
    update public.enrollments
    set offer_status = 'expired'
    where id = v_offer.id;
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
    ), '[]'::jsonb)
  ) into v_payload
  from public.daycares d
  left join public.classrooms c on c.id = v_offer.classroom_id
  where d.id = v_offer.daycare_id;

  return v_payload;
end;
$$;

create or replace function public.accept_parent_enrollment_offer(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer public.enrollments%rowtype;
begin
  perform assert_rate_limit('parent_offer_accept', 20, 900, left(upper(btrim(p_code)), 12));
  select * into v_offer from public.enrollments
  where upper(offer_code) = upper(btrim(p_code)) for update;

  if v_offer.id is null then raise exception 'This offer link is invalid'; end if;
  if v_offer.offer_status in ('withdrawn', 'expired') or v_offer.offer_expires_at <= now() then
    raise exception 'This offer is no longer available';
  end if;
  if v_offer.offer_status = 'declined' then raise exception 'Reopen the offer before accepting it'; end if;
  if v_offer.offer_status = 'accepted' then return public.get_parent_enrollment_offer(p_code); end if;

  update public.enrollments
  set offer_accepted_at = coalesce(offer_accepted_at, now()),
      parent_workflow_step = 'application'
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
begin
  perform assert_rate_limit('parent_offer_application', 30, 900, left(upper(btrim(p_code)), 12));
  select * into v_offer from public.enrollments
  where upper(offer_code) = upper(btrim(p_code)) for update;
  if v_offer.id is null then raise exception 'This offer link is invalid'; end if;
  if v_offer.offer_status not in ('sent', 'viewed') or v_offer.offer_expires_at <= now() then
    raise exception 'This offer is no longer available';
  end if;
  if v_offer.offer_accepted_at is null then raise exception 'Accept the offer first'; end if;
  if nullif(btrim(p_application->>'child_full_name'), '') is null
     or nullif(btrim(p_application->>'child_date_of_birth'), '') is null
     or nullif(btrim(p_application->>'primary_guardian_name'), '') is null
     or nullif(btrim(p_application->>'primary_guardian_phone'), '') is null
     or nullif(btrim(p_application->>'emergency_contact_name'), '') is null
     or nullif(btrim(p_application->>'emergency_contact_phone'), '') is null then
    raise exception 'Complete all required application fields';
  end if;

  update public.enrollments
  set child_first_name = split_part(btrim(p_application->>'child_full_name'), ' ', 1),
      child_last_name = nullif(btrim(regexp_replace(p_application->>'child_full_name', '^\S+\s*', '')), ''),
      child_date_of_birth = (p_application->>'child_date_of_birth')::date,
      guardian_name = btrim(p_application->>'primary_guardian_name'),
      guardian_phone = btrim(p_application->>'primary_guardian_phone'),
      application_data = p_application,
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
begin
  perform assert_rate_limit('parent_offer_document', 30, 900, left(upper(btrim(p_code)), 12));
  select * into v_offer from public.enrollments
  where upper(offer_code) = upper(btrim(p_code)) for update;
  if v_offer.id is null then raise exception 'This offer link is invalid'; end if;
  if v_offer.offer_status not in ('sent', 'viewed') or v_offer.offer_expires_at <= now() then
    raise exception 'This offer is no longer available';
  end if;
  if p_kind not in ('immunization', 'birth_certificate', 'custody') then
    raise exception 'Unsupported document type';
  end if;
  if p_file_size <= 0 or p_file_size > 10485760 then raise exception 'Files must be 10 MB or smaller'; end if;
  if p_mime_type not in ('application/pdf', 'image/jpeg', 'image/png') then
    raise exception 'Use a PDF, JPG, or PNG file';
  end if;

  v_expected_prefix := 'enrollment-offers/' || upper(btrim(p_code)) || '/' || p_kind || '/';
  if left(p_storage_path, length(v_expected_prefix)) <> v_expected_prefix then
    raise exception 'Invalid upload path';
  end if;
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'documents' and name = p_storage_path
  ) then raise exception 'Upload was not found'; end if;

  insert into public.enrollment_application_documents (
    daycare_id, enrollment_id, kind, file_name, mime_type, file_size, storage_path
  ) values (
    v_offer.daycare_id, v_offer.id, p_kind, left(p_file_name, 180),
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
        coalesce(documents_status, '{}'::jsonb),
        array[p_kind],
        '"received"'::jsonb,
        true
      )
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
  select * into v_offer from public.enrollments
  where upper(offer_code) = upper(btrim(p_code)) for update;
  if v_offer.id is null then raise exception 'This offer link is invalid'; end if;
  if v_offer.application_submitted_at is null then raise exception 'Complete the application first'; end if;
  if v_offer.offer_expires_at <= now() then raise exception 'This offer has expired'; end if;
  update public.enrollments set parent_workflow_step = 'agreement' where id = v_offer.id;
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
  perform assert_rate_limit('parent_offer_agreement', 20, 900, left(upper(btrim(p_code)), 12));
  select * into v_offer from public.enrollments
  where upper(offer_code) = upper(btrim(p_code)) for update;
  if v_offer.id is null then raise exception 'This offer link is invalid'; end if;
  if v_offer.offer_expires_at <= now() then raise exception 'This offer has expired'; end if;
  if v_offer.application_submitted_at is null then raise exception 'Complete the application first'; end if;
  if nullif(btrim(p_signature_name), '') is null then raise exception 'Sign the agreement to continue'; end if;
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
  perform assert_rate_limit('parent_offer_decline', 15, 900, left(upper(btrim(p_code)), 12));
  select * into v_offer from public.enrollments
  where upper(offer_code) = upper(btrim(p_code)) for update;
  if v_offer.id is null then raise exception 'This offer link is invalid'; end if;
  if v_offer.offer_status = 'accepted' or v_offer.deposit_status = 'paid' then
    raise exception 'An enrolled offer cannot be declined';
  end if;
  update public.enrollments
  set offer_status = 'declined', offer_declined_at = now(),
      offer_decline_reason = nullif(left(btrim(p_reason), 200), ''),
      parent_workflow_step = 'declined', waitlist_status = 'active'
  where id = v_offer.id;
  return public.get_parent_enrollment_offer(p_code);
end;
$$;

create or replace function public.reopen_parent_enrollment_offer(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_offer public.enrollments%rowtype;
begin
  perform assert_rate_limit('parent_offer_reopen', 15, 900, left(upper(btrim(p_code)), 12));
  select * into v_offer from public.enrollments
  where upper(offer_code) = upper(btrim(p_code)) for update;
  if v_offer.id is null then raise exception 'This offer link is invalid'; end if;
  if v_offer.offer_status <> 'declined' then raise exception 'This offer is not declined'; end if;
  if v_offer.offer_expires_at <= now() then raise exception 'Ask the center to extend this expired offer'; end if;
  update public.enrollments
  set offer_status = 'viewed', offer_declined_at = null, offer_decline_reason = null,
      parent_workflow_step = case when offer_accepted_at is null then 'details' else 'application' end,
      waitlist_status = 'offer'
  where id = v_offer.id;
  return public.get_parent_enrollment_offer(p_code);
end;
$$;

-- A real provider must settle the payment server-side. This RPC is intentionally
-- restricted to offers marked demo and exists so the complete flow is testable
-- without pretending a real card was charged.
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
  v_payment uuid;
  v_child uuid;
  v_amount int;
  v_allergies text[] := '{}'::text[];
begin
  perform assert_rate_limit('parent_offer_demo_payment', 10, 900, left(upper(btrim(p_code)), 12));
  select * into v_offer from public.enrollments
  where upper(offer_code) = upper(btrim(p_code)) for update;
  if v_offer.id is null then raise exception 'This offer link is invalid'; end if;
  if v_offer.payment_mode <> 'demo' then raise exception 'Online deposit payment is not configured for this offer'; end if;
  if v_offer.offer_expires_at <= now() then raise exception 'This offer has expired'; end if;
  if v_offer.agreement_signed_at is null then raise exception 'Sign the agreement first'; end if;
  if v_offer.deposit_status = 'paid' then return public.get_parent_enrollment_offer(p_code); end if;

  v_amount := coalesce(v_offer.offer_deposit_cents, 0)
    + case when p_include_first_month then coalesce(v_offer.offer_tuition_cents, 0) else 0 end;

  insert into public.enrollment_offer_payments (
    enrollment_id, daycare_id, amount_cents, provider, provider_reference,
    status, include_first_month, settled_at
  ) values (
    v_offer.id, v_offer.daycare_id, v_amount, 'demo',
    'demo_' || replace(gen_random_uuid()::text, '-', ''), 'succeeded',
    p_include_first_month, now()
  ) returning id into v_payment;

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
      deposit_paid_at = now(), deposit_payment_id = v_payment,
      parent_workflow_step = 'enrolled', stage_changed_at = now(),
      onboarding_steps = coalesce(onboarding_steps, '{}'::jsonb)
        || jsonb_build_object('offer_complete', true, 'account_linked', false)
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
begin
  if auth.uid() is null then raise exception 'Sign in or create an account first'; end if;
  perform assert_rate_limit('parent_offer_link_account', 10, 900, auth.uid()::text);
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

  update public.enrollments
  set parent_account_linked_at = coalesce(parent_account_linked_at, now()),
      onboarding_steps = coalesce(onboarding_steps, '{}'::jsonb)
        || jsonb_build_object('account_linked', true)
  where id = v_offer.id;
  return public.get_parent_enrollment_offer(p_code);
end;
$$;

-- Anonymous uploads are accepted only under an active, unexpired bearer offer
-- path. Objects remain private and cannot be listed or downloaded anonymously.
drop policy if exists "families upload active enrollment offer documents" on storage.objects;
create policy "families upload active enrollment offer documents"
  on storage.objects for insert to anon, authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = 'enrollment-offers'
    and (storage.foldername(name))[3] in ('immunization', 'birth_certificate', 'custody')
    and exists (
      select 1 from public.enrollments e
      where upper(e.offer_code) = upper((storage.foldername(name))[2])
        and e.offer_status in ('sent', 'viewed')
        and e.offer_expires_at > now()
        and e.offer_accepted_at is not null
    )
  );

grant execute on function public.get_parent_enrollment_offer(text) to anon, authenticated;
grant execute on function public.accept_parent_enrollment_offer(text) to anon, authenticated;
grant execute on function public.save_parent_enrollment_application(text, jsonb) to anon, authenticated;
grant execute on function public.save_parent_enrollment_document(text, text, text, text, bigint, text) to anon, authenticated;
grant execute on function public.continue_parent_enrollment_documents(text) to anon, authenticated;
grant execute on function public.sign_parent_enrollment_agreement(text, text, boolean, boolean, boolean) to anon, authenticated;
grant execute on function public.decline_parent_enrollment_offer(text, text) to anon, authenticated;
grant execute on function public.reopen_parent_enrollment_offer(text) to anon, authenticated;
grant execute on function public.complete_demo_parent_enrollment_deposit(text, boolean) to anon, authenticated;
grant execute on function public.link_parent_enrollment_account(text) to authenticated;

revoke all on public.enrollment_application_documents from anon, authenticated;
revoke all on public.enrollment_offer_payments from anon, authenticated;

-- Seed one renewable, isolated Group 24 offer for complete iOS testing.
update public.enrollments
set offer_code = 'PARENT24-MIA-2026',
    offer_sent_at = now(),
    offer_viewed_at = null,
    offer_expires_at = now() + interval '7 days',
    offer_status = 'sent',
    offer_accepted_at = null,
    offer_declined_at = null,
    offer_decline_reason = null,
    parent_workflow_step = 'offer',
    application_progress = 0,
    application_submitted_at = null,
    agreement_version = null,
    agreement_data = '{}'::jsonb,
    agreement_signed_at = null,
    deposit_status = 'unpaid',
    deposit_paid_at = null,
    deposit_payment_id = null,
    payment_mode = 'demo',
    parent_account_linked_at = null,
    stage = 'offer',
    waitlist_status = 'offer',
    offer_deposit_cents = 50000,
    offer_tuition_cents = 128000,
    desired_start_date = current_date + 28
where id = '41000000-0000-4000-a000-000000000001';
