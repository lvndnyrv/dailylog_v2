-- Mobile photo flows already attribute uploads to an educator. Persist that
-- attribution so individual and bulk daily-log photos share the same audit trail.

alter table public.photos
  add column if not exists uploader_id uuid references public.profiles(id) on delete set null;

create index if not exists photos_uploader_idx
  on public.photos (uploader_id, created_at desc)
  where uploader_id is not null;

comment on column public.photos.uploader_id is
  'Staff profile that attached the photo to the child daily report.';

notify pgrst, 'reload schema';
