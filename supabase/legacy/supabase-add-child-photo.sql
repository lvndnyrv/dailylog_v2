-- ============================================
-- Add profile photo support for children
-- ============================================
-- Run this in Supabase SQL Editor

-- Add photo_url column to children table
alter table children add column if not exists photo_url text;

-- Create storage bucket for child profile photos (if not exists)
insert into storage.buckets (id, name, public)
values ('child-avatars', 'child-avatars', false)
on conflict (id) do nothing;

-- Storage policy: educators in the same daycare can upload
create policy "Educators can upload child avatars"
  on storage.objects for insert
  with check (
    bucket_id = 'child-avatars'
    and get_my_role() = 'educator'
  );

-- Storage policy: educators can update/overwrite
create policy "Educators can update child avatars"
  on storage.objects for update
  using (
    bucket_id = 'child-avatars'
    and get_my_role() = 'educator'
  );

-- Storage policy: educators can delete
create policy "Educators can delete child avatars"
  on storage.objects for delete
  using (
    bucket_id = 'child-avatars'
    and get_my_role() = 'educator'
  );

-- Storage policy: authenticated users can view (parents + educators)
create policy "Authenticated users can view child avatars"
  on storage.objects for select
  using (
    bucket_id = 'child-avatars'
    and auth.role() = 'authenticated'
  );

