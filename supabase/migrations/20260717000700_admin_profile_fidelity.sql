-- ============================================================================
-- DailyLog — admin profile fidelity (design 14d)
-- ============================================================================

alter table profiles add column if not exists display_name text;

update profiles
set display_name = nullif(split_part(btrim(full_name), ' ', 1), '')
where display_name is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_display_name_length_check'
  ) then
    alter table profiles add constraint profiles_display_name_length_check
      check (display_name is null or char_length(btrim(display_name)) between 1 and 60);
  end if;
end
$$;

-- Profile photos are intentionally public: they appear throughout the signed-in
-- center experience. Writes remain restricted to the user's own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-avatars',
  'profile-avatars',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "users upload own profile avatar" on storage.objects;
create policy "users upload own profile avatar" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "users read own profile avatar object" on storage.objects;
create policy "users read own profile avatar object" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "users update own profile avatar" on storage.objects;
create policy "users update own profile avatar" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "users delete own profile avatar" on storage.objects;
create policy "users delete own profile avatar" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'profile-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- The profile screen tells admins these visible identity changes are audited.
drop trigger if exists audit_profiles on profiles;
create trigger audit_profiles
  after update on profiles
  for each row
  when (
    old.role is distinct from new.role
    or old.daycare_id is distinct from new.daycare_id
    or old.full_name is distinct from new.full_name
    or old.display_name is distinct from new.display_name
    or old.avatar_url is distinct from new.avatar_url
  )
  execute function audit_write();
