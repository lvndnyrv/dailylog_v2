-- Supabase Storage rejects direct SQL deletes from storage.objects. Return the
-- replaced path to the client and permit Storage API deletion only when that
-- object belongs to the active bearer offer and is no longer referenced.

create or replace function public.can_delete_parent_enrollment_upload(p_storage_path text)
returns boolean
language sql
security definer
stable
set search_path = public, storage
as $$
  select (storage.foldername(p_storage_path))[1] = 'enrollment-offers'
    and public.can_upload_parent_enrollment_document(
      (storage.foldername(p_storage_path))[2],
      (storage.foldername(p_storage_path))[3]
    )
    and not exists (
      select 1 from public.enrollment_application_documents document
      where document.storage_path = p_storage_path
    )
$$;

revoke all on function public.can_delete_parent_enrollment_upload(text) from public;
grant execute on function public.can_delete_parent_enrollment_upload(text) to anon, authenticated;

drop policy if exists "families delete unreferenced enrollment offer uploads" on storage.objects;
create policy "families delete unreferenced enrollment offer uploads"
  on storage.objects for delete to anon, authenticated
  using (
    bucket_id = 'documents'
    and public.can_delete_parent_enrollment_upload(name)
  );

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

  update public.enrollments
  set application_progress = greatest(application_progress, 67),
      parent_workflow_step = 'documents',
      documents_status = jsonb_set(
        coalesce(documents_status, '{}'::jsonb), array[p_kind], '"received"'::jsonb, true
      )
  where id = v_offer.id;

  return public.get_parent_enrollment_offer(p_code) || jsonb_build_object(
    'replaced_storage_path', case
      when v_previous_path is distinct from p_storage_path then v_previous_path
      else null
    end
  );
end;
$$;

revoke all on function public.discard_parent_enrollment_upload(text, text) from public, anon, authenticated;
drop function if exists public.discard_parent_enrollment_upload(text, text);

grant execute on function public.save_parent_enrollment_document(text, text, text, text, bigint, text)
  to anon, authenticated;
