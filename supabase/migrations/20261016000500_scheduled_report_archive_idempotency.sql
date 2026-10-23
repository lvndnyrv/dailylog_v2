-- A retried or concurrent email delivery must reuse the same scheduled file.
create unique index report_exports_scheduled_file_key
  on public.report_exports (
    daycare_id, report_kind, starts_on, ends_on, format,
    (parameters->>'schedule_id')
  )
  where parameters->>'scheduled'='true' and storage_path is not null;
