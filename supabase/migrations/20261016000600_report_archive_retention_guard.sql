-- Enforce the product's seven-year minimum for report archive metadata.
-- expires_at marks the earliest policy review date, not an automatic purge.
update public.report_exports
set expires_at = generated_at + interval '7 years'
where expires_at < generated_at + interval '7 years';

alter table public.report_exports
  add constraint report_exports_minimum_retention
  check (expires_at >= generated_at + interval '7 years');

create function public.prevent_report_export_mutation()
returns trigger language plpgsql set search_path=public as $$
begin
  raise exception 'Report export records are immutable; retention changes require a reviewed migration';
end $$;

create trigger prevent_report_export_update_or_delete
  before update or delete on public.report_exports
  for each row execute function public.prevent_report_export_mutation();

revoke all on function public.prevent_report_export_mutation()
  from public,anon,authenticated;

-- Read-only operational signal. This checks Storage metadata and declared size;
-- it cannot prove that provider bytes are durable or still hash to SHA-256.
create function public.report_archive_retention_health()
returns table(
  archived_files bigint,
  missing_storage_metadata bigint,
  size_mismatches bigint,
  due_for_policy_review bigint
) language sql stable security definer set search_path=public as $$
  select
    count(*) filter (where e.storage_path is not null),
    count(*) filter (where e.storage_path is not null and o.id is null),
    count(*) filter (where e.storage_path is not null and o.id is not null
      and case when coalesce(o.metadata->>'size','') ~ '^[0-9]+$'
        then (o.metadata->>'size')::bigint is distinct from e.content_bytes::bigint
        else true end),
    count(*) filter (where e.expires_at <= now())
  from public.report_exports e
  left join storage.objects o
    on o.bucket_id='report-exports' and o.name=e.storage_path;
$$;

revoke all on function public.report_archive_retention_health()
  from public,anon,authenticated;
grant execute on function public.report_archive_retention_health() to service_role;
