-- ==========================================================================
-- Parent mobile Group 28 — standing family document vault.
-- Keeps post-enrollment requests, submission history, review state, and the
-- family-visible enrollment record in one child-scoped workflow.
-- ==========================================================================

create table if not exists public.parent_document_requests (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references public.daycares(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  kind text not null,
  title text not null,
  message text,
  due_on date,
  status text not null default 'requested'
    check (status in ('requested', 'under_review', 'accepted', 'rejected', 'cancelled')),
  requested_by uuid references public.profiles(id) on delete set null default auth.uid(),
  requested_at timestamptz not null default now(),
  submitted_at timestamptz,
  completed_at timestamptz,
  rejection_reason text,
  latest_document_id uuid references public.documents(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(btrim(kind)) between 2 and 80),
  check (length(btrim(title)) between 2 and 160),
  check (message is null or length(message) <= 2000),
  check (rejection_reason is null or length(rejection_reason) <= 1000)
);

create unique index if not exists parent_document_requests_one_active_idx
  on public.parent_document_requests (child_id, lower(kind))
  where status in ('requested', 'under_review', 'rejected');

create index if not exists parent_document_requests_family_idx
  on public.parent_document_requests (child_id, status, requested_at desc);

create index if not exists parent_document_requests_center_idx
  on public.parent_document_requests (daycare_id, status, due_on);

drop trigger if exists parent_document_requests_updated_at
  on public.parent_document_requests;
create trigger parent_document_requests_updated_at
  before update on public.parent_document_requests
  for each row execute function public.update_updated_at();

create table if not exists public.parent_document_submissions (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references public.daycares(id) on delete cascade,
  request_id uuid not null references public.parent_document_requests(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete restrict,
  submitted_by uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'under_review'
    check (status in ('under_review', 'accepted', 'rejected', 'superseded')),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  rejection_reason text,
  created_at timestamptz not null default now(),
  unique (document_id),
  check (rejection_reason is null or length(rejection_reason) <= 1000)
);

create index if not exists parent_document_submissions_request_idx
  on public.parent_document_submissions (request_id, submitted_at desc);

alter table public.parent_document_requests enable row level security;
alter table public.parent_document_submissions enable row level security;

drop policy if exists "parents read linked document requests"
  on public.parent_document_requests;
create policy "parents read linked document requests"
  on public.parent_document_requests for select
  using (child_id in (select public.my_child_ids()));

drop policy if exists "admins manage center document requests"
  on public.parent_document_requests;
create policy "admins manage center document requests"
  on public.parent_document_requests for all
  using (public.is_admin() and daycare_id = public.get_my_daycare_id())
  with check (public.is_admin() and daycare_id = public.get_my_daycare_id());

drop policy if exists "parents read linked document submissions"
  on public.parent_document_submissions;
create policy "parents read linked document submissions"
  on public.parent_document_submissions for select
  using (
    exists (
      select 1
      from public.parent_document_requests request
      where request.id = request_id
        and request.child_id in (select public.my_child_ids())
    )
  );

drop policy if exists "admins manage center document submissions"
  on public.parent_document_submissions;
create policy "admins manage center document submissions"
  on public.parent_document_submissions for all
  using (public.is_admin() and daycare_id = public.get_my_daycare_id())
  with check (public.is_admin() and daycare_id = public.get_my_daycare_id());

-- Storage policy helpers are SECURITY DEFINER because storage.objects evaluates
-- policy subqueries under storage's RLS context. Inputs remain plain text so a
-- malformed object path is rejected instead of causing a UUID cast exception.
create or replace function public.can_upload_parent_requested_document(
  p_daycare_id text,
  p_child_id text,
  p_request_id text
)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.parent_document_requests request
    join public.parent_children link
      on link.child_id = request.child_id and link.parent_id = auth.uid()
    join public.profiles profile on profile.id = auth.uid()
    where request.id::text = p_request_id
      and request.child_id::text = p_child_id
      and request.daycare_id::text = p_daycare_id
      and profile.daycare_id = request.daycare_id
      and profile.role = 'parent'
      and profile.archived_at is null
      and request.status in ('requested', 'rejected')
  )
$$;

create or replace function public.can_read_parent_document_object(p_name text)
returns boolean
language sql
security definer
stable
set search_path = public, storage
as $$
  select auth.uid() is not null and (
    (
      (storage.foldername(p_name))[1] = 'parent-documents'
      and exists (
        select 1
        from public.parent_children link
        where link.parent_id = auth.uid()
          and link.child_id::text = (storage.foldername(p_name))[3]
      )
    )
    or (
      (storage.foldername(p_name))[1] = 'enrollment-offers'
      and exists (
        select 1
        from public.enrollments enrollment
        join public.parent_children link
          on link.child_id = enrollment.child_id and link.parent_id = auth.uid()
        where upper(enrollment.offer_code) = upper((storage.foldername(p_name))[2])
      )
    )
  )
$$;

revoke all on function public.can_upload_parent_requested_document(text, text, text) from public;
grant execute on function public.can_upload_parent_requested_document(text, text, text) to authenticated;
revoke all on function public.can_read_parent_document_object(text) from public;
grant execute on function public.can_read_parent_document_object(text) to authenticated;

drop policy if exists "parents upload requested child documents" on storage.objects;
create policy "parents upload requested child documents"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = 'parent-documents'
    and (storage.foldername(name))[5] = auth.uid()::text
    and public.can_upload_parent_requested_document(
      (storage.foldername(name))[2],
      (storage.foldername(name))[3],
      (storage.foldername(name))[4]
    )
  );

drop policy if exists "parents read linked child documents" on storage.objects;
create policy "parents read linked child documents"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'documents'
    and public.can_read_parent_document_object(name)
  );

drop policy if exists "parents remove failed requested uploads" on storage.objects;
create policy "parents remove failed requested uploads"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = 'parent-documents'
    and (storage.foldername(name))[5] = auth.uid()::text
    and public.can_upload_parent_requested_document(
      (storage.foldername(name))[2],
      (storage.foldername(name))[3],
      (storage.foldername(name))[4]
    )
  );

create or replace function public.create_parent_document_request(
  p_child_id uuid,
  p_kind text,
  p_title text default null,
  p_message text default null,
  p_due_on date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_child public.children%rowtype;
  v_request public.parent_document_requests%rowtype;
  v_kind text := lower(regexp_replace(btrim(coalesce(p_kind, '')), '[^a-zA-Z0-9]+', '_', 'g'));
  v_title text;
begin
  select * into v_profile from public.profiles where id = auth.uid() and archived_at is null;
  if v_profile.id is null or not public.is_admin() or v_profile.daycare_id is null then
    raise exception 'An administrator account is required';
  end if;

  select * into v_child from public.children
  where id = p_child_id and daycare_id = v_profile.daycare_id and archived_at is null;
  if v_child.id is null then raise exception 'Child not found'; end if;
  if length(v_kind) < 2 or length(v_kind) > 80 then raise exception 'Choose a valid document type'; end if;

  v_title := coalesce(nullif(btrim(p_title), ''), initcap(replace(v_kind, '_', ' ')));
  if length(v_title) > 160 then raise exception 'The request title is too long'; end if;
  if length(coalesce(p_message, '')) > 2000 then raise exception 'The request message is too long'; end if;

  select * into v_request
  from public.parent_document_requests request
  where request.child_id = v_child.id
    and lower(request.kind) = v_kind
    and request.status in ('requested', 'under_review', 'rejected')
  for update;

  if v_request.id is null then
    insert into public.parent_document_requests (
      daycare_id, child_id, kind, title, message, due_on, requested_by
    ) values (
      v_child.daycare_id, v_child.id, v_kind, v_title,
      nullif(btrim(coalesce(p_message, '')), ''), p_due_on, auth.uid()
    ) returning * into v_request;
  elsif v_request.status <> 'under_review' then
    update public.parent_document_requests
    set title = v_title,
        message = nullif(btrim(coalesce(p_message, '')), ''),
        due_on = p_due_on,
        status = 'requested',
        requested_by = auth.uid(),
        requested_at = now(),
        completed_at = null,
        rejection_reason = null
    where id = v_request.id
    returning * into v_request;
  end if;

  insert into public.notifications (daycare_id, profile_id, kind, title, body, payload)
  select
    v_request.daycare_id,
    link.parent_id,
    'parent_document_request',
    'Document requested for ' || v_child.first_name,
    v_request.title || case when v_request.due_on is null then '' else ' is due ' || to_char(v_request.due_on, 'Mon FMDD') end,
    jsonb_build_object(
      'screen', 'ParentDocumentUpload',
      'requestId', v_request.id,
      'childId', v_child.id,
      'category', 'documents'
    )
  from public.parent_children link
  where link.child_id = v_child.id
    and not exists (
      select 1 from public.notifications notification
      where notification.profile_id = link.parent_id
        and notification.kind = 'parent_document_request'
        and notification.payload->>'requestId' = v_request.id::text
        and notification.created_at >= now() - interval '1 hour'
    );

  return to_jsonb(v_request);
end;
$$;

create or replace function public.submit_parent_document_request(
  p_request_id uuid,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_size_bytes bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_profile public.profiles%rowtype;
  v_request public.parent_document_requests%rowtype;
  v_child public.children%rowtype;
  v_document_id uuid;
  v_submission_id uuid;
  v_prefix text;
begin
  select * into v_profile
  from public.profiles
  where id = auth.uid() and role = 'parent' and archived_at is null;
  if v_profile.id is null or v_profile.daycare_id is null then
    raise exception 'A linked parent account is required';
  end if;

  select request.* into v_request
  from public.parent_document_requests request
  join public.parent_children link
    on link.child_id = request.child_id and link.parent_id = auth.uid()
  where request.id = p_request_id
  for update of request;
  if v_request.id is null then raise exception 'Document request not found'; end if;
  if v_request.status not in ('requested', 'rejected') then
    raise exception 'This request is not accepting another upload';
  end if;
  if v_request.daycare_id <> v_profile.daycare_id then raise exception 'Document request not found'; end if;

  if p_mime_type not in ('application/pdf', 'image/jpeg', 'image/png') then
    raise exception 'Choose a PDF, JPG, or PNG document';
  end if;
  if p_size_bytes is null or p_size_bytes < 1 or p_size_bytes > 10485760 then
    raise exception 'The document must be 10 MB or smaller';
  end if;
  if nullif(btrim(p_file_name), '') is null or length(p_file_name) > 180 then
    raise exception 'The selected file name is invalid';
  end if;

  v_prefix := 'parent-documents/' || v_request.daycare_id::text || '/' ||
    v_request.child_id::text || '/' || v_request.id::text || '/' || auth.uid()::text || '/';
  if left(p_storage_path, length(v_prefix)) <> v_prefix or p_storage_path like '%..%' then
    raise exception 'The document path is invalid';
  end if;
  if not exists (
    select 1 from storage.objects object
    where object.bucket_id = 'documents' and object.name = p_storage_path
  ) then
    raise exception 'The document upload did not finish. Please try again';
  end if;

  select * into v_child from public.children where id = v_request.child_id;

  update public.parent_document_submissions
  set status = 'superseded'
  where request_id = v_request.id and status in ('under_review', 'rejected');

  insert into public.documents (
    daycare_id, child_id, title, category, storage_path,
    mime_type, size_bytes, uploaded_by
  ) values (
    v_request.daycare_id, v_request.child_id, left(p_file_name, 180),
    'parent_requested_' || v_request.kind, p_storage_path,
    p_mime_type, p_size_bytes, auth.uid()
  ) returning id into v_document_id;

  insert into public.parent_document_submissions (
    daycare_id, request_id, document_id, submitted_by
  ) values (
    v_request.daycare_id, v_request.id, v_document_id, auth.uid()
  ) returning id into v_submission_id;

  update public.parent_document_requests
  set status = 'under_review', submitted_at = now(), completed_at = null,
      rejection_reason = null, latest_document_id = v_document_id
  where id = v_request.id
  returning * into v_request;

  insert into public.notifications (daycare_id, profile_id, kind, title, body, payload)
  select
    v_request.daycare_id,
    admin.id,
    'parent_document_review',
    v_request.title || ' needs review',
    coalesce(v_profile.full_name, 'A parent') || ' uploaded a document for ' || v_child.first_name || '.',
    jsonb_build_object(
      'screen', 'ChildProfile',
      'childId', v_request.child_id,
      'requestId', v_request.id,
      'submissionId', v_submission_id,
      'category', 'documents'
    )
  from public.profiles admin
  where admin.daycare_id = v_request.daycare_id
    and admin.role in ('owner_admin', 'admin')
    and admin.archived_at is null;

  return to_jsonb(v_request) || jsonb_build_object(
    'submission_id', v_submission_id,
    'document_id', v_document_id,
    'file_name', p_file_name,
    'mime_type', p_mime_type,
    'size_bytes', p_size_bytes
  );
end;
$$;

create or replace function public.review_parent_document_submission(
  p_submission_id uuid,
  p_decision text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_submission public.parent_document_submissions%rowtype;
  v_request public.parent_document_requests%rowtype;
  v_child public.children%rowtype;
begin
  select * into v_profile from public.profiles where id = auth.uid() and archived_at is null;
  if v_profile.id is null or not public.is_admin() or v_profile.daycare_id is null then
    raise exception 'An administrator account is required';
  end if;
  if p_decision not in ('accepted', 'rejected') then raise exception 'Choose accepted or rejected'; end if;
  if p_decision = 'rejected' and nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Explain what the family needs to correct';
  end if;

  select * into v_submission
  from public.parent_document_submissions submission
  where submission.id = p_submission_id and submission.daycare_id = v_profile.daycare_id
  for update;
  if v_submission.id is null or v_submission.status <> 'under_review' then
    raise exception 'Submission not found or already reviewed';
  end if;

  update public.parent_document_submissions
  set status = p_decision,
      reviewed_at = now(),
      reviewed_by = auth.uid(),
      rejection_reason = case when p_decision = 'rejected' then left(btrim(p_reason), 1000) else null end
  where id = v_submission.id;

  update public.parent_document_requests
  set status = p_decision,
      completed_at = case when p_decision = 'accepted' then now() else null end,
      rejection_reason = case when p_decision = 'rejected' then left(btrim(p_reason), 1000) else null end
  where id = v_submission.request_id
  returning * into v_request;

  select * into v_child from public.children where id = v_request.child_id;
  insert into public.notifications (daycare_id, profile_id, kind, title, body, payload)
  select
    v_request.daycare_id,
    link.parent_id,
    'parent_document_status',
    case when p_decision = 'accepted' then v_request.title || ' is on file'
         else v_request.title || ' needs another upload' end,
    case when p_decision = 'accepted' then 'The office accepted the document for ' || v_child.first_name || '.'
         else left(btrim(p_reason), 1000) end,
    jsonb_build_object(
      'screen', case when p_decision = 'accepted' then 'ParentDocuments' else 'ParentDocumentUpload' end,
      'requestId', v_request.id,
      'childId', v_request.child_id,
      'category', 'documents'
    )
  from public.parent_children link where link.child_id = v_request.child_id;

  return to_jsonb(v_request);
end;
$$;

create or replace function public.get_parent_documents_hub()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_daycare public.daycares%rowtype;
  v_children jsonb := '[]'::jsonb;
begin
  select * into v_profile
  from public.profiles
  where id = auth.uid() and role = 'parent' and archived_at is null;
  if v_profile.id is null or v_profile.daycare_id is null then
    raise exception 'A linked parent account is required';
  end if;
  select * into v_daycare from public.daycares where id = v_profile.daycare_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', child.id,
      'first_name', child.first_name,
      'last_name', child.last_name,
      'date_of_birth', child.date_of_birth,
      'classroom_name', child.classroom_name,
      'requests', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', request.id,
            'kind', request.kind,
            'title', request.title,
            'message', request.message,
            'due_on', request.due_on,
            'status', request.status,
            'requested_at', request.requested_at,
            'submitted_at', request.submitted_at,
            'completed_at', request.completed_at,
            'rejection_reason', request.rejection_reason,
            'latest_document', case when document.id is null then null else jsonb_build_object(
              'id', document.id,
              'title', document.title,
              'storage_path', document.storage_path,
              'mime_type', document.mime_type,
              'size_bytes', document.size_bytes,
              'created_at', document.created_at,
              'submission_status', submission.status
            ) end
          ) order by
            case request.status when 'rejected' then 0 when 'requested' then 1 when 'under_review' then 2 else 3 end,
            request.due_on nulls last,
            request.requested_at desc
        )
        from public.parent_document_requests request
        left join public.documents document on document.id = request.latest_document_id
        left join public.parent_document_submissions submission on submission.document_id = document.id
        where request.child_id = child.id and request.status <> 'cancelled'
      ), '[]'::jsonb),
      'records', coalesce((
        select jsonb_agg(to_jsonb(record_row) - 'sort_order' order by record_row.sort_order, record_row.recorded_at desc)
        from (
          select
            enrollment.id::text as id,
            'agreement'::text as source_type,
            'Enrollment agreement'::text as title,
            'enrollment'::text as category,
            'signed'::text as status,
            enrollment.agreement_signed_at as recorded_at,
            null::text as storage_path,
            'application/pdf'::text as mime_type,
            null::bigint as size_bytes,
            enrollment.agreement_data as structured_data,
            enrollment.agreement_version as version,
            'DL-AGR-' || upper(left(replace(enrollment.id::text, '-', ''), 8)) as reference,
            10 as sort_order
          from public.enrollments enrollment
          where enrollment.child_id = child.id and enrollment.agreement_signed_at is not null

          union all

          select
            enrollment.id::text,
            'application_summary',
            'Application summary',
            'enrollment',
            'submitted',
            enrollment.application_submitted_at,
            null,
            'application/pdf',
            null,
            enrollment.application_data,
            null,
            'DL-APP-' || upper(left(replace(enrollment.id::text, '-', ''), 8)),
            20
          from public.enrollments enrollment
          where enrollment.child_id = child.id and enrollment.application_submitted_at is not null

          union all

          select
            enrollment_document.id::text,
            'stored',
            case enrollment_document.kind
              when 'immunization' then 'Immunization record'
              when 'birth_certificate' then 'Birth certificate'
              when 'custody' then 'Custody document'
              else initcap(replace(enrollment_document.kind, '_', ' '))
            end,
            'health',
            enrollment_document.status,
            enrollment_document.uploaded_at,
            enrollment_document.storage_path,
            enrollment_document.mime_type,
            enrollment_document.file_size,
            '{}'::jsonb,
            null,
            null,
            30
          from public.enrollment_application_documents enrollment_document
          join public.enrollments enrollment on enrollment.id = enrollment_document.enrollment_id
          where enrollment.child_id = child.id

          union all

          select
            child.id::text || '-health',
            'health_summary',
            'Allergy & medical form',
            'health',
            'on_file',
            child.updated_at,
            null,
            'application/pdf',
            null,
            jsonb_build_object(
              'allergies', to_jsonb(coalesce(child.allergies, '{}'::text[])),
              'medical_notes', child.medical_notes,
              'emergency_contacts', coalesce(child.emergency_contacts, '[]'::jsonb)
            ),
            null,
            'DL-HEALTH-' || upper(left(replace(child.id::text, '-', ''), 8)),
            40
          where coalesce(array_length(child.allergies, 1), 0) > 0
             or nullif(btrim(coalesce(child.medical_notes, '')), '') is not null

          union all

          select
            document.id::text,
            'stored',
            request.title,
            'health',
            submission.status,
            submission.reviewed_at,
            document.storage_path,
            document.mime_type,
            document.size_bytes,
            '{}'::jsonb,
            null,
            null,
            50
          from public.parent_document_submissions submission
          join public.parent_document_requests request on request.id = submission.request_id
          join public.documents document on document.id = submission.document_id
          where request.child_id = child.id and submission.status = 'accepted'
        ) record_row
      ), '[]'::jsonb)
    ) order by child.first_name, child.last_name
  ), '[]'::jsonb)
  into v_children
  from (
    select c.id, c.first_name, c.last_name, c.date_of_birth,
           c.allergies, c.medical_notes, c.emergency_contacts, c.updated_at,
           classroom.name as classroom_name
    from public.parent_children link
    join public.children c on c.id = link.child_id and c.archived_at is null
    left join public.classrooms classroom on classroom.id = c.classroom_id
    where link.parent_id = auth.uid()
  ) child;

  return jsonb_build_object(
    'profile', jsonb_build_object(
      'id', v_profile.id,
      'full_name', v_profile.full_name,
      'email', v_profile.email
    ),
    'daycare', jsonb_build_object(
      'id', v_daycare.id,
      'name', v_daycare.name,
      'phone', v_daycare.phone,
      'email', null,
      'address', v_daycare.address
    ),
    'children', v_children
  );
end;
$$;

revoke all on function public.create_parent_document_request(uuid, text, text, text, date) from public;
grant execute on function public.create_parent_document_request(uuid, text, text, text, date) to authenticated;
revoke all on function public.submit_parent_document_request(uuid, text, text, text, bigint) from public;
grant execute on function public.submit_parent_document_request(uuid, text, text, text, bigint) to authenticated;
revoke all on function public.review_parent_document_submission(uuid, text, text) from public;
grant execute on function public.review_parent_document_submission(uuid, text, text) to authenticated;
revoke all on function public.get_parent_documents_hub() from public;
grant execute on function public.get_parent_documents_hub() to authenticated;

revoke insert, update, delete on public.parent_document_requests from authenticated;
revoke insert, update, delete on public.parent_document_submissions from authenticated;
