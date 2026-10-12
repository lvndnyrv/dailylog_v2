-- ==========================================================================
-- Parent mobile Group 28 completion — authoritative document relationships.
-- Family storage access follows database records instead of guessable paths,
-- failed uploads remain removable, and cross-center request links are rejected.
-- ==========================================================================

create or replace function public.guard_parent_document_request_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_child_daycare_id uuid;
begin
  select child.daycare_id into v_child_daycare_id
  from public.children child
  where child.id = new.child_id and child.archived_at is null;

  if v_child_daycare_id is null or v_child_daycare_id <> new.daycare_id then
    raise exception 'The document request must belong to the child''s center';
  end if;

  if new.requested_by is not null and not exists (
    select 1
    from public.profiles profile
    where profile.id = new.requested_by
      and profile.daycare_id = new.daycare_id
      and profile.role in ('owner_admin', 'admin')
      and profile.archived_at is null
  ) then
    raise exception 'The document requester must be an active center administrator';
  end if;

  if new.latest_document_id is not null and not exists (
    select 1
    from public.documents document
    where document.id = new.latest_document_id
      and document.daycare_id = new.daycare_id
      and document.child_id = new.child_id
  ) then
    raise exception 'The latest document does not belong to this request';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_parent_document_request_integrity
  on public.parent_document_requests;
create trigger guard_parent_document_request_integrity
  before insert or update on public.parent_document_requests
  for each row execute function public.guard_parent_document_request_integrity();

create or replace function public.guard_parent_document_submission_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.parent_document_requests%rowtype;
begin
  select * into v_request
  from public.parent_document_requests request
  where request.id = new.request_id;

  if v_request.id is null or v_request.daycare_id <> new.daycare_id then
    raise exception 'The submission does not belong to this request';
  end if;

  if not exists (
    select 1
    from public.documents document
    where document.id = new.document_id
      and document.daycare_id = v_request.daycare_id
      and document.child_id = v_request.child_id
      and document.archived_at is null
  ) then
    raise exception 'The submitted document does not belong to this child';
  end if;

  if not exists (
    select 1
    from public.parent_children link
    join public.profiles profile
      on profile.id = link.parent_id
     and profile.role = 'parent'
     and profile.archived_at is null
    where link.parent_id = new.submitted_by
      and link.child_id = v_request.child_id
      and profile.daycare_id = v_request.daycare_id
  ) then
    raise exception 'The submitter is not linked to this child';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_parent_document_submission_integrity
  on public.parent_document_submissions;
create trigger guard_parent_document_submission_integrity
  before insert or update of daycare_id, request_id, document_id, submitted_by
  on public.parent_document_submissions
  for each row execute function public.guard_parent_document_submission_integrity();

-- A family may read only objects that are part of its current database-backed
-- record. Merely knowing a child ID or enrollment offer code is not sufficient.
create or replace function public.can_read_parent_document_object(p_name text)
returns boolean
language sql
security definer
stable
set search_path = public, storage
as $$
  select auth.uid() is not null and (
    exists (
      select 1
      from public.documents document
      join public.parent_children link
        on link.child_id = document.child_id
       and link.parent_id = auth.uid()
      where document.storage_path = p_name
        and document.archived_at is null
    )
    or exists (
      select 1
      from public.enrollment_application_documents document
      join public.enrollments enrollment on enrollment.id = document.enrollment_id
      join public.parent_children link
        on link.child_id = enrollment.child_id
       and link.parent_id = auth.uid()
      where document.storage_path = p_name
    )
  )
$$;

revoke all on function public.can_read_parent_document_object(text) from public;
grant execute on function public.can_read_parent_document_object(text) to authenticated;

drop policy if exists "parents read linked child documents" on storage.objects;
create policy "parents read linked child documents"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'documents'
    and public.can_read_parent_document_object(name)
  );

-- If the database submission step loses a race with cancellation or review,
-- the just-uploaded object is not referenced. Its original uploader can still
-- remove it even though the request is no longer accepting new files.
create or replace function public.can_delete_unreferenced_parent_document(p_name text)
returns boolean
language sql
security definer
stable
set search_path = public, storage
as $$
  select auth.uid() is not null
    and (storage.foldername(p_name))[1] = 'parent-documents'
    and (storage.foldername(p_name))[5] = auth.uid()::text
    and exists (
      select 1
      from storage.objects object
      where object.bucket_id = 'documents'
        and object.name = p_name
        and object.owner_id = auth.uid()::text
    )
    and exists (
      select 1
      from public.parent_children link
      where link.parent_id = auth.uid()
        and link.child_id::text = (storage.foldername(p_name))[3]
    )
    and not exists (
      select 1 from public.documents document where document.storage_path = p_name
    )
$$;

revoke all on function public.can_delete_unreferenced_parent_document(text) from public;
grant execute on function public.can_delete_unreferenced_parent_document(text) to authenticated;

drop policy if exists "parents remove failed requested uploads" on storage.objects;
create policy "parents remove failed requested uploads"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'documents'
    and public.can_delete_unreferenced_parent_document(name)
  );

-- Reissuing a rejected request starts a clean to-do. The prior submission stays
-- in the audit history, while the active request no longer advertises it as the
-- latest upload.
create or replace function public.clear_reissued_parent_document_pointer()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'rejected' and new.status = 'requested' then
    new.latest_document_id := null;
    new.submitted_at := null;
    new.completed_at := null;
    new.rejection_reason := null;
  end if;
  return new;
end;
$$;

drop trigger if exists clear_reissued_parent_document_pointer
  on public.parent_document_requests;
create trigger clear_reissued_parent_document_pointer
  before update on public.parent_document_requests
  for each row execute function public.clear_reissued_parent_document_pointer();
