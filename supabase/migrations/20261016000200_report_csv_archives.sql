-- Store exact CSV downloads in a private, center-scoped bucket. Historical
-- report_exports rows remain metadata-only and have a null storage_path.
alter table public.report_exports
  add column storage_path text,
  add column content_sha256 text,
  add column content_bytes integer;

alter table public.report_exports
  add constraint report_exports_csv_archive_shape check (
    (storage_path is null and content_sha256 is null and content_bytes is null)
    or (
      format = 'csv'
      and storage_path = daycare_id::text || '/' || id::text || '.csv'
      and content_sha256 ~ '^[0-9a-f]{64}$'
      and content_bytes between 0 and 52428800
    )
  );

create unique index report_exports_storage_path_key
  on public.report_exports(storage_path) where storage_path is not null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('report-exports', 'report-exports', false, 52428800, array['text/csv'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "admins upload own center report archives"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'report-exports'
    and public.is_admin()
    and public.has_permission('reports', 'view')
    and (storage.foldername(name))[1] = public.get_my_daycare_id()::text
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.csv$'
  );

create policy "admins read own center report archives"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'report-exports'
    and public.is_admin()
    and public.has_permission('reports', 'view')
    and (storage.foldername(name))[1] = public.get_my_daycare_id()::text
  );

-- Only an upload that failed to acquire an immutable metadata row can be
-- cleaned up. A completed archived export has no update or delete policy.
create policy "admins remove unlinked report archive uploads"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'report-exports'
    and public.is_admin()
    and public.has_permission('reports', 'view')
    and (storage.foldername(name))[1] = public.get_my_daycare_id()::text
    and not exists (
      select 1 from public.report_exports e
      where e.storage_path = storage.objects.name
    )
  );
