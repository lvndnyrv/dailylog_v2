-- Parent mobile Group 28 — make the 10 MB promise authoritative in storage
-- and prevent a custom client from attaching spoofed file metadata.

update storage.buckets
set file_size_limit = 10485760
where id = 'documents';

create or replace function public.guard_parent_requested_document_storage_metadata()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_metadata jsonb;
  v_actual_mime text;
  v_actual_size bigint;
begin
  if new.category not like 'parent\_requested\_%' escape '\' then
    return new;
  end if;

  select object.metadata into v_metadata
  from storage.objects object
  where object.bucket_id = 'documents'
    and object.name = new.storage_path;

  if v_metadata is null then
    raise exception 'The document upload did not finish. Please try again';
  end if;

  v_actual_mime := lower(coalesce(
    nullif(v_metadata->>'mimetype', ''),
    nullif(v_metadata->>'contentType', '')
  ));
  if coalesce(v_metadata->>'size', '') ~ '^\d+$' then
    v_actual_size := (v_metadata->>'size')::bigint;
  end if;

  if lower(coalesce(new.mime_type, '')) not in (
    'application/pdf', 'image/jpeg', 'image/png'
  ) or v_actual_mime is distinct from lower(new.mime_type) then
    raise exception 'The uploaded file type does not match the selected document';
  end if;

  if v_actual_size is null
     or v_actual_size < 1
     or v_actual_size > 10485760
     or v_actual_size is distinct from new.size_bytes then
    raise exception 'The uploaded file size does not match the selected document';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_parent_requested_document_storage_metadata
  on public.documents;
create trigger guard_parent_requested_document_storage_metadata
  before insert or update of category, storage_path, mime_type, size_bytes
  on public.documents
  for each row execute function public.guard_parent_requested_document_storage_metadata();

revoke all on function public.guard_parent_requested_document_storage_metadata() from public;
