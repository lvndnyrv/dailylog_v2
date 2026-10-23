-- Extend the private report archive to generated PDFs without changing
-- historical metadata-only entries or the CSV object paths.
alter table public.report_exports drop constraint report_exports_csv_archive_shape;
alter table public.report_exports add constraint report_exports_archive_shape check (
  (storage_path is null and content_sha256 is null and content_bytes is null)
  or (
    storage_path = daycare_id::text || '/' || id::text || '.' || format
    and content_sha256 ~ '^[0-9a-f]{64}$'
    and content_bytes between 0 and 52428800
  )
);

update storage.buckets set
  file_size_limit = 52428800,
  allowed_mime_types = array['text/csv','application/pdf']
where id = 'report-exports';

drop policy "admins upload own center report archives" on storage.objects;
create policy "admins upload own center report archives"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'report-exports'
    and public.is_admin()
    and public.has_permission('reports', 'view')
    and (storage.foldername(name))[1] = public.get_my_daycare_id()::text
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(csv|pdf)$'
  );
