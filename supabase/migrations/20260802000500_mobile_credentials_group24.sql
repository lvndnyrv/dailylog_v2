-- ============================================================================
-- Mobile Group 24 — educator credentials, renewal uploads and verification
-- ============================================================================

create table if not exists public.staff_credentials (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references public.daycares(id) on delete cascade,
  staff_member_id uuid not null references public.staff_members(id) on delete cascade,
  name text not null,
  issuer text,
  completed_on date,
  expires_on date,
  credential_number text,
  document_id uuid references public.documents(id) on delete set null,
  required boolean not null default true,
  ratio_qualifying boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(btrim(name)) between 1 and 120),
  check (completed_on is null or expires_on is null or expires_on >= completed_on)
);

create unique index if not exists staff_credentials_member_name_idx
  on public.staff_credentials (staff_member_id, lower(btrim(name)));
create index if not exists staff_credentials_center_expiry_idx
  on public.staff_credentials (daycare_id, expires_on)
  where expires_on is not null;

drop trigger if exists staff_credentials_updated_at on public.staff_credentials;
create trigger staff_credentials_updated_at
  before update on public.staff_credentials
  for each row execute function public.update_updated_at();

create table if not exists public.staff_credential_submissions (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references public.daycares(id) on delete cascade,
  staff_member_id uuid not null references public.staff_members(id) on delete cascade,
  credential_id uuid not null references public.staff_credentials(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete restrict,
  submitted_by uuid not null references public.profiles(id) on delete restrict,
  issuer text not null,
  completed_on date not null,
  expires_on date not null,
  credential_number text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  review_notes text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_on >= completed_on),
  check (
    (status = 'pending' and reviewed_at is null)
    or status in ('approved', 'rejected', 'withdrawn')
  )
);

create unique index if not exists staff_credential_one_pending_idx
  on public.staff_credential_submissions (credential_id)
  where status = 'pending';
create index if not exists staff_credential_submissions_staff_idx
  on public.staff_credential_submissions (staff_member_id, created_at desc);
create index if not exists staff_credential_submissions_review_idx
  on public.staff_credential_submissions (daycare_id, status, created_at desc);

drop trigger if exists staff_credential_submissions_updated_at
  on public.staff_credential_submissions;
create trigger staff_credential_submissions_updated_at
  before update on public.staff_credential_submissions
  for each row execute function public.update_updated_at();

alter table public.staff_credentials enable row level security;
alter table public.staff_credential_submissions enable row level security;

drop policy if exists "educators read own credentials" on public.staff_credentials;
create policy "educators read own credentials"
  on public.staff_credentials for select
  using (
    staff_member_id = public.my_staff_member_id()
    or (
      daycare_id = public.get_my_daycare_id()
      and public.has_permission('staff', 'view')
    )
  );

drop policy if exists "staff admins manage credentials" on public.staff_credentials;
create policy "staff admins manage credentials"
  on public.staff_credentials for all
  using (
    daycare_id = public.get_my_daycare_id()
    and public.has_permission('staff', 'edit')
  )
  with check (
    daycare_id = public.get_my_daycare_id()
    and public.has_permission('staff', 'edit')
  );

drop policy if exists "educators read own credential submissions"
  on public.staff_credential_submissions;
create policy "educators read own credential submissions"
  on public.staff_credential_submissions for select
  using (
    staff_member_id = public.my_staff_member_id()
    or (
      daycare_id = public.get_my_daycare_id()
      and public.has_permission('staff', 'view')
    )
  );

-- Mutations go through the workflow RPCs below so an educator cannot approve
-- their own renewal and a reviewer cannot bypass the audit/notification steps.

drop trigger if exists audit_staff_credentials on public.staff_credentials;
create trigger audit_staff_credentials
  after insert or update on public.staff_credentials
  for each row execute function public.audit_write();

drop trigger if exists audit_staff_credential_submissions
  on public.staff_credential_submissions;
create trigger audit_staff_credential_submissions
  after insert or update on public.staff_credential_submissions
  for each row execute function public.audit_write();

-- Keep the private documents bucket, but constrain Group 24 files to an
-- educator-owned prefix. Existing admin read access remains unchanged.
drop policy if exists "educators read own credential documents" on storage.objects;
create policy "educators read own credential documents"
  on storage.objects for select
  using (
    bucket_id = 'documents'
    and split_part(name, '/', 1) = 'staff-credentials'
    and split_part(name, '/', 2) = public.get_my_daycare_id()::text
    and split_part(name, '/', 3) = auth.uid()::text
  );

drop policy if exists "educators remove own credential uploads" on storage.objects;
create policy "educators remove own credential uploads"
  on storage.objects for delete
  using (
    bucket_id = 'documents'
    and split_part(name, '/', 1) = 'staff-credentials'
    and split_part(name, '/', 2) = public.get_my_daycare_id()::text
    and split_part(name, '/', 3) = auth.uid()::text
  );

-- Backfill the normalized register from the admin console's existing JSONB
-- certification rows. Re-running the migration does not duplicate entries.
insert into public.staff_credentials (
  daycare_id, staff_member_id, name, issuer, completed_on, expires_on,
  credential_number, required, ratio_qualifying
)
select
  member.daycare_id,
  member.id,
  btrim(cert.value ->> 'item'),
  nullif(btrim(cert.value ->> 'issuer'), ''),
  case when coalesce(cert.value ->> 'issued', '') ~ '^\d{4}-\d{2}-\d{2}$'
    then (cert.value ->> 'issued')::date end,
  case when coalesce(cert.value ->> 'expires_on', '') ~ '^\d{4}-\d{2}-\d{2}$'
    then (cert.value ->> 'expires_on')::date end,
  nullif(btrim(cert.value ->> 'credential_number'), ''),
  true,
  lower(cert.value ->> 'item') ~ '(first aid|cpr)'
from public.staff_members member
cross join lateral jsonb_array_elements(coalesce(member.certifications, '[]'::jsonb)) cert(value)
where nullif(btrim(cert.value ->> 'item'), '') is not null
on conflict do nothing;

create or replace function public.sync_staff_certifications_json(p_staff_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_certifications jsonb;
begin
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'item', credential.name,
      'issuer', credential.issuer,
      'issued', credential.completed_on,
      'expires_on', credential.expires_on,
      'credential_number', credential.credential_number
    ) order by credential.name
  ), '[]'::jsonb)
    into v_certifications
    from public.staff_credentials credential
   where credential.staff_member_id = p_staff_member_id
     and credential.archived_at is null
     and (credential.completed_on is not null or credential.document_id is not null);

  update public.staff_members
     set certifications = v_certifications
   where id = p_staff_member_id;
end;
$$;

create or replace function public.get_mobile_staff_credentials()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_member public.staff_members%rowtype;
  v_reviewer_name text;
  v_credentials jsonb := '[]'::jsonb;
  v_today date := public.center_today();
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select member.* into v_member
    from public.staff_members member
   where member.id = public.my_staff_member_id()
     and member.profile_id = auth.uid()
     and member.status = 'active'
     and member.archived_at is null;
  if v_member.id is null then raise exception 'Active staff record required'; end if;

  select profile.full_name into v_reviewer_name
    from public.profiles profile
   where profile.daycare_id = v_member.daycare_id
     and profile.role in ('owner_admin', 'admin')
     and profile.archived_at is null
   order by case when profile.role = 'owner_admin' then 0 else 1 end, profile.created_at
   limit 1;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', credential.id,
      'name', credential.name,
      'issuer', credential.issuer,
      'completedOn', credential.completed_on,
      'expiresOn', credential.expires_on,
      'credentialNumber', credential.credential_number,
      'required', credential.required,
      'ratioQualifying', credential.ratio_qualifying,
      'status', case
        when credential.completed_on is null and credential.expires_on is null
          and credential.document_id is null then 'missing'
        when credential.expires_on is not null and credential.expires_on < v_today then 'expired'
        when credential.expires_on is not null and credential.expires_on <= v_today + 30 then 'expiring'
        else 'valid'
      end,
      'daysUntilExpiry', case when credential.expires_on is null then null
        else credential.expires_on - v_today end,
      'document', case when document.id is null then null else jsonb_build_object(
        'id', document.id,
        'title', document.title,
        'storagePath', document.storage_path,
        'mimeType', document.mime_type,
        'sizeBytes', document.size_bytes
      ) end,
      'latestSubmission', case when submission.id is null then null else jsonb_build_object(
        'id', submission.id,
        'status', submission.status,
        'issuer', submission.issuer,
        'completedOn', submission.completed_on,
        'expiresOn', submission.expires_on,
        'credentialNumber', submission.credential_number,
        'reviewNotes', submission.review_notes,
        'reviewedAt', submission.reviewed_at,
        'reviewerName', reviewer.full_name,
        'submittedAt', submission.created_at,
        'document', jsonb_build_object(
          'id', submission_document.id,
          'title', submission_document.title,
          'storagePath', submission_document.storage_path,
          'mimeType', submission_document.mime_type,
          'sizeBytes', submission_document.size_bytes
        )
      ) end
    ) order by
      case
        when submission.status = 'rejected' then 0
        when submission.status = 'pending' then 1
        when credential.completed_on is null and credential.expires_on is null
          and credential.document_id is null then 2
        when credential.expires_on is not null and credential.expires_on < v_today then 3
        when credential.expires_on is not null and credential.expires_on <= v_today + 30 then 4
        else 5
      end,
      credential.name
  ), '[]'::jsonb)
    into v_credentials
    from public.staff_credentials credential
    left join public.documents document on document.id = credential.document_id
    left join lateral (
      select candidate.*
        from public.staff_credential_submissions candidate
       where candidate.credential_id = credential.id
       order by candidate.created_at desc
       limit 1
    ) submission on true
    left join public.documents submission_document on submission_document.id = submission.document_id
    left join public.profiles reviewer on reviewer.id = submission.reviewed_by
   where credential.staff_member_id = v_member.id
     and credential.archived_at is null;

  return jsonb_build_object(
    'staffMemberId', v_member.id,
    'reviewerName', coalesce(v_reviewer_name, 'your director'),
    'credentials', v_credentials
  );
end;
$$;

create or replace function public.replace_admin_staff_credentials(
  p_staff_member_id uuid,
  p_credentials jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.staff_members%rowtype;
  v_row jsonb;
  v_name text;
  v_issuer text;
  v_completed date;
  v_expires date;
  v_number text;
  v_seen text[] := array[]::text[];
begin
  if auth.uid() is null or not public.has_permission('staff', 'edit') then
    raise exception 'Staff edit permission is required';
  end if;
  if jsonb_typeof(coalesce(p_credentials, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_credentials, '[]'::jsonb)) > 50 then
    raise exception 'Credential list is invalid';
  end if;

  select member.* into v_member
    from public.staff_members member
   where member.id = p_staff_member_id
     and member.daycare_id = public.get_my_daycare_id()
     and member.archived_at is null;
  if v_member.id is null then raise exception 'Staff member not found'; end if;

  for v_row in select value from jsonb_array_elements(coalesce(p_credentials, '[]'::jsonb))
  loop
    v_name := nullif(btrim(v_row ->> 'item'), '');
    if v_name is null or length(v_name) > 120 then
      raise exception 'Every credential needs a valid name';
    end if;
    if lower(v_name) = any(v_seen) then
      raise exception 'Credential names must be unique';
    end if;
    v_seen := array_append(v_seen, lower(v_name));
    v_issuer := nullif(btrim(v_row ->> 'issuer'), '');
    v_number := nullif(btrim(v_row ->> 'credential_number'), '');
    v_completed := case when coalesce(v_row ->> 'issued', '') ~ '^\d{4}-\d{2}-\d{2}$'
      then (v_row ->> 'issued')::date end;
    v_expires := case when coalesce(v_row ->> 'expires_on', '') ~ '^\d{4}-\d{2}-\d{2}$'
      then (v_row ->> 'expires_on')::date end;
    if v_completed is not null and v_expires is not null and v_expires < v_completed then
      raise exception '% expiry cannot precede its issue date', v_name;
    end if;

    update public.staff_credentials credential
       set name = v_name,
           issuer = v_issuer,
           completed_on = v_completed,
           expires_on = v_expires,
           credential_number = v_number,
           required = coalesce((v_row ->> 'required')::boolean, true),
           ratio_qualifying = coalesce(
             (v_row ->> 'ratio_qualifying')::boolean,
             lower(v_name) ~ '(first aid|cpr)'
           ),
           archived_at = null
     where credential.staff_member_id = v_member.id
       and lower(btrim(credential.name)) = lower(v_name);
    if not found then
      insert into public.staff_credentials (
        daycare_id, staff_member_id, name, issuer, completed_on, expires_on,
        credential_number, required, ratio_qualifying
      ) values (
        v_member.daycare_id, v_member.id, v_name, v_issuer, v_completed, v_expires,
        v_number, coalesce((v_row ->> 'required')::boolean, true),
        coalesce(
          (v_row ->> 'ratio_qualifying')::boolean,
          lower(v_name) ~ '(first aid|cpr)'
        )
      );
    end if;
  end loop;

  if exists (
    select 1
      from public.staff_credentials credential
     where credential.staff_member_id = v_member.id
       and credential.archived_at is null
       and not (lower(credential.name) = any(v_seen))
       and exists (
         select 1 from public.staff_credential_submissions submission
          where submission.credential_id = credential.id
            and submission.status = 'pending'
       )
  ) then
    raise exception 'A credential awaiting verification cannot be removed';
  end if;

  update public.staff_credentials credential
     set archived_at = now(), required = false
   where credential.staff_member_id = v_member.id
     and credential.archived_at is null
     and not (lower(credential.name) = any(v_seen));

  perform public.sync_staff_certifications_json(v_member.id);
end;
$$;

create or replace function public.submit_mobile_credential_renewal(
  p_credential_id uuid,
  p_issuer text,
  p_completed_on date,
  p_expires_on date,
  p_credential_number text,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_size_bytes bigint
)
returns uuid
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_member public.staff_members%rowtype;
  v_credential public.staff_credentials%rowtype;
  v_document_id uuid;
  v_submission_id uuid;
  v_prefix text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  v_member.id := public.my_staff_member_id();
  select * into v_member from public.staff_members where id = v_member.id;
  if v_member.id is null or v_member.profile_id <> auth.uid() then
    raise exception 'Active staff record required';
  end if;

  select * into v_credential
    from public.staff_credentials credential
   where credential.id = p_credential_id
     and credential.staff_member_id = v_member.id
     and credential.daycare_id = v_member.daycare_id;
  if v_credential.id is null then raise exception 'Credential not found'; end if;

  perform public.assert_rate_limit(
    'mobile_credential_submit', 10, 3600, p_credential_id::text
  );

  if nullif(btrim(p_issuer), '') is null or length(btrim(p_issuer)) > 120 then
    raise exception 'Enter the organization that issued the credential';
  end if;
  if p_completed_on is null or p_completed_on > public.center_today() + 1 then
    raise exception 'Enter a valid completion date';
  end if;
  if p_expires_on is null or p_expires_on <= p_completed_on then
    raise exception 'The expiry must be after the completion date';
  end if;
  if p_mime_type not in ('application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif') then
    raise exception 'Upload a PDF, JPG, PNG or HEIC document';
  end if;
  if p_size_bytes is null or p_size_bytes < 1 or p_size_bytes > 10485760 then
    raise exception 'The document must be 10 MB or smaller';
  end if;
  if nullif(btrim(p_file_name), '') is null or length(p_file_name) > 180 then
    raise exception 'The selected file name is invalid';
  end if;

  v_prefix := 'staff-credentials/' || v_member.daycare_id::text || '/' || auth.uid()::text || '/';
  if left(p_storage_path, length(v_prefix)) <> v_prefix
     or p_storage_path like '%..%' then
    raise exception 'The document path is invalid';
  end if;
  if not exists (
    select 1 from storage.objects object
     where object.bucket_id = 'documents' and object.name = p_storage_path
  ) then
    raise exception 'The document upload did not finish. Please try again';
  end if;
  if exists (
    select 1 from public.staff_credential_submissions submission
     where submission.credential_id = p_credential_id and submission.status = 'pending'
  ) then
    raise exception 'A renewal is already awaiting verification';
  end if;

  insert into public.documents (
    daycare_id, profile_id, title, category, storage_path, mime_type,
    size_bytes, expires_on, uploaded_by
  ) values (
    v_member.daycare_id, auth.uid(), p_file_name, 'staff_credential_renewal',
    p_storage_path, p_mime_type, p_size_bytes, p_expires_on, auth.uid()
  ) returning id into v_document_id;

  insert into public.staff_credential_submissions (
    daycare_id, staff_member_id, credential_id, document_id, submitted_by,
    issuer, completed_on, expires_on, credential_number
  ) values (
    v_member.daycare_id, v_member.id, v_credential.id, v_document_id, auth.uid(),
    btrim(p_issuer), p_completed_on, p_expires_on,
    nullif(btrim(coalesce(p_credential_number, '')), '')
  ) returning id into v_submission_id;

  insert into public.notifications (daycare_id, profile_id, kind, title, body, payload)
  select
    v_member.daycare_id,
    admin.id,
    'credential_review',
    'Credential renewal needs review',
    profile.full_name || ' submitted a ' || v_credential.name || ' renewal.',
    jsonb_build_object(
      'type', 'credential_review',
      'submissionId', v_submission_id,
      'staffMemberId', v_member.id,
      'screen', 'StaffCredentialReview',
      'category', 'compliance',
      'source', 'Compliance',
      'href', '/staff/' || v_member.id::text,
      'action_label', 'Review renewal',
      'severity', 'warning'
    )
  from public.profiles admin
  join public.profiles profile on profile.id = auth.uid()
  where admin.daycare_id = v_member.daycare_id
    and admin.role in ('owner_admin', 'admin')
    and admin.archived_at is null;

  return v_submission_id;
end;
$$;

create or replace function public.withdraw_mobile_credential_submission(p_submission_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_id uuid := public.my_staff_member_id();
begin
  if auth.uid() is null or v_member_id is null then
    raise exception 'Active staff record required';
  end if;
  perform public.assert_rate_limit(
    'mobile_credential_withdraw', 10, 3600, p_submission_id::text
  );
  update public.staff_credential_submissions submission
     set status = 'withdrawn'
   where submission.id = p_submission_id
     and submission.staff_member_id = v_member_id
     and submission.submitted_by = auth.uid()
     and submission.status = 'pending';
  if not found then raise exception 'Only your pending renewal can be withdrawn'; end if;
  return true;
end;
$$;

create or replace function public.review_staff_credential_submission(
  p_submission_id uuid,
  p_decision text,
  p_review_notes text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_submission public.staff_credential_submissions%rowtype;
  v_credential public.staff_credentials%rowtype;
  v_recipient uuid;
  v_reviewer_name text;
  v_title text;
  v_body text;
  v_payload jsonb;
begin
  if auth.uid() is null or not public.has_permission('staff', 'approve') then
    raise exception 'Staff approval permission is required';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected';
  end if;
  if p_decision = 'rejected' and nullif(btrim(coalesce(p_review_notes, '')), '') is null then
    raise exception 'Tell the educator what needs to be corrected';
  end if;

  perform public.assert_rate_limit(
    'credential_review', 40, 3600, p_submission_id::text
  );

  select submission.* into v_submission
    from public.staff_credential_submissions submission
   where submission.id = p_submission_id
     and submission.daycare_id = public.get_my_daycare_id()
     and submission.status = 'pending'
   for update;
  if v_submission.id is null then raise exception 'Pending renewal not found'; end if;

  update public.staff_credential_submissions
     set status = p_decision,
         review_notes = nullif(btrim(coalesce(p_review_notes, '')), ''),
         reviewed_by = auth.uid(),
         reviewed_at = now()
   where id = v_submission.id;

  if p_decision = 'approved' then
    update public.staff_credentials credential
       set issuer = v_submission.issuer,
           completed_on = v_submission.completed_on,
           expires_on = v_submission.expires_on,
           credential_number = v_submission.credential_number,
           document_id = v_submission.document_id
     where credential.id = v_submission.credential_id
     returning * into v_credential;
    perform public.sync_staff_certifications_json(v_submission.staff_member_id);
  else
    select * into v_credential from public.staff_credentials
     where id = v_submission.credential_id;
  end if;

  select member.profile_id into v_recipient
    from public.staff_members member where member.id = v_submission.staff_member_id;
  select profile.full_name into v_reviewer_name
    from public.profiles profile where profile.id = auth.uid();

  v_title := case p_decision
    when 'approved' then v_credential.name || ' renewal verified'
    else v_credential.name || ' renewal needs changes'
  end;
  v_body := case p_decision
    when 'approved' then coalesce(v_reviewer_name, 'Your director') ||
      ' verified your renewal. It is now valid through ' ||
      to_char(v_submission.expires_on, 'Mon FMDD, YYYY') || '.'
    else coalesce(v_reviewer_name, 'Your director') ||
      ' requested a correction: ' || btrim(p_review_notes)
  end;
  v_payload := jsonb_build_object(
    'type', 'credential_decision',
    'screen', 'CredentialDetail',
    'credentialId', v_credential.id,
    'submissionId', v_submission.id,
    'status', p_decision,
    'channelId', 'default'
  );

  insert into public.notifications (daycare_id, profile_id, kind, title, body, payload)
  values (v_submission.daycare_id, v_recipient, 'credential', v_title, v_body, v_payload);

  insert into public.notification_outbox (
    daycare_id, recipient_id, channel, kind, title, body, payload, dedupe_key
  ) values (
    v_submission.daycare_id, v_recipient, 'push', 'credential', v_title, v_body,
    v_payload,
    'credential-decision:' || v_submission.id::text || ':' || p_decision
  ) on conflict do nothing;

  return true;
end;
$$;

create or replace function public.enqueue_staff_credential_expiry_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_days integer;
  v_title text;
  v_body text;
  v_payload jsonb;
  v_dedupe text;
  v_count integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;

  for v_row in
    select
      credential.id as credential_id,
      credential.daycare_id,
      credential.name,
      credential.expires_on,
      member.id as staff_member_id,
      member.profile_id,
      profile.full_name,
      ((credential.expires_on -
        (now() at time zone coalesce(daycare.timezone, 'UTC'))::date))::integer as days_left
    from public.staff_credentials credential
    join public.staff_members member on member.id = credential.staff_member_id
    join public.profiles profile on profile.id = member.profile_id
    join public.daycares daycare on daycare.id = credential.daycare_id
    where credential.archived_at is null
      and credential.expires_on is not null
      and member.status = 'active'
      and member.archived_at is null
      and profile.archived_at is null
      and ((credential.expires_on -
        (now() at time zone coalesce(daycare.timezone, 'UTC'))::date))::integer
        in (30, 14, 7, 1, 0, -1)
  loop
    v_days := v_row.days_left;
    v_title := case
      when v_days < 0 then v_row.name || ' has expired'
      when v_days = 0 then v_row.name || ' expires today'
      when v_days = 1 then v_row.name || ' expires tomorrow'
      else v_row.name || ' expires in ' || v_days || ' days'
    end;
    v_body := case
      when v_days < 0 then 'Upload a current document now so your director can restore your credential status.'
      else 'Upload your renewal now so your director has time to verify it.'
    end;
    v_dedupe := 'credential-expiry:' || v_row.credential_id::text || ':' ||
      v_row.expires_on::text || ':' || v_days::text;
    v_payload := jsonb_build_object(
      'type', 'cert_expiry',
      'screen', 'CredentialRenewal',
      'credentialId', v_row.credential_id,
      'daysUntilExpiry', v_days,
      'channelId', 'default',
      'dedupeKey', v_dedupe
    );

    if not exists (
      select 1 from public.notifications notification
       where notification.profile_id = v_row.profile_id
         and notification.kind = 'cert_expiry'
         and notification.payload ->> 'dedupeKey' = v_dedupe
    ) then
      insert into public.notifications (daycare_id, profile_id, kind, title, body, payload)
      values (
        v_row.daycare_id, v_row.profile_id, 'cert_expiry', v_title, v_body, v_payload
      );
      v_count := v_count + 1;
    end if;

    insert into public.notification_outbox (
      daycare_id, recipient_id, channel, kind, title, body, payload, dedupe_key
    ) values (
      v_row.daycare_id, v_row.profile_id, 'push', 'cert_expiry',
      v_title, v_body, v_payload, v_dedupe
    ) on conflict do nothing;

    insert into public.notifications (daycare_id, profile_id, kind, title, body, payload)
    select
      v_row.daycare_id,
      admin.id,
      'cert_expiry',
      split_part(v_row.full_name, ' ', 1) || '''s ' || v_title,
      'Review the credential or remind the educator from their staff record.',
      jsonb_build_object(
        'category', 'compliance',
        'source', 'Compliance',
        'href', '/staff/' || v_row.staff_member_id::text,
        'action_label', 'Review credential',
        'severity', case when v_days <= 0 then 'critical' else 'warning' end,
        'credentialId', v_row.credential_id,
        'dedupeKey', v_dedupe || ':admin:' || admin.id::text
      )
    from public.profiles admin
    where admin.daycare_id = v_row.daycare_id
      and admin.role in ('owner_admin', 'admin')
      and admin.archived_at is null
      and not exists (
        select 1 from public.notifications existing
         where existing.profile_id = admin.id
           and existing.kind = 'cert_expiry'
           and existing.payload ->> 'dedupeKey' = v_dedupe || ':admin:' || admin.id::text
      );
  end loop;

  return v_count;
end;
$$;

-- Route staff-domain notification events through the same permission gate as
-- the review RPC. This retains every mapping introduced by Group 22.
create or replace function public.enforce_notification_enqueue_permission()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare v_area text;
begin
  if auth.role() = 'service_role' or (auth.uid() is null and auth.role() is null) then return new; end if;
  if new.kind = 'time_off' then
    if not public.has_permission('staff', 'approve') then
      raise exception 'staff approve permission required';
    end if;
    return new;
  end if;
  if new.kind in ('credential', 'cert_expiry') then
    if not public.has_permission('staff', 'approve') then
      raise exception 'staff approve permission required';
    end if;
    return new;
  end if;
  v_area := case new.kind
    when 'announcement' then 'broadcasts'
    when 'incident' then 'incidents'
    when 'medication' then 'medications'
    when 'invoice' then 'billing'
    when 'payment' then 'billing'
    when 'staff_invite' then 'staff'
    when 'parent_invite' then 'children'
    else 'daily_logs'
  end;
  if not public.has_permission(v_area, 'edit') then
    raise exception '% edit permission required', v_area;
  end if;
  return new;
end;
$$;

revoke all on function public.sync_staff_certifications_json(uuid) from public, anon, authenticated;
revoke all on function public.replace_admin_staff_credentials(uuid, jsonb)
  from public, anon;
revoke all on function public.get_mobile_staff_credentials() from public, anon;
revoke all on function public.submit_mobile_credential_renewal(
  uuid, text, date, date, text, text, text, text, bigint
) from public, anon;
revoke all on function public.withdraw_mobile_credential_submission(uuid) from public, anon;
revoke all on function public.review_staff_credential_submission(uuid, text, text)
  from public, anon;
revoke all on function public.enqueue_staff_credential_expiry_reminders()
  from public, anon, authenticated;

grant execute on function public.get_mobile_staff_credentials() to authenticated;
grant execute on function public.replace_admin_staff_credentials(uuid, jsonb)
  to authenticated;
grant execute on function public.submit_mobile_credential_renewal(
  uuid, text, date, date, text, text, text, text, bigint
) to authenticated;
grant execute on function public.withdraw_mobile_credential_submission(uuid) to authenticated;
grant execute on function public.review_staff_credential_submission(uuid, text, text)
  to authenticated;
grant execute on function public.enqueue_staff_credential_expiry_reminders()
  to service_role;

grant select on public.staff_credentials, public.staff_credential_submissions
  to authenticated;
