-- Group 4b: owner-only employment files on a staff profile. These records use
-- the existing private document vault, with an explicit category/path boundary
-- so delegated admins and the subject cannot read confidential HR material.

drop policy if exists "read documents by subject access" on public.documents;
create policy "read documents by subject access" on public.documents
  for select using (
    (
      public.is_admin()
      and daycare_id = public.get_my_daycare_id()
      and (
        coalesce(category, '') not like 'staff_private_%'
        or public.get_my_role() = 'owner_admin'
      )
    )
    or (child_id is not null and public.can_access_child(child_id))
    or (
      profile_id = auth.uid()
      and coalesce(category, '') not like 'staff_private_%'
    )
  );

drop policy if exists "staff upload documents" on public.documents;
create policy "staff upload documents" on public.documents
  for insert with check (
    public.is_staff()
    and daycare_id = public.get_my_daycare_id()
    and uploaded_by = auth.uid()
    and (
      coalesce(category, '') not like 'staff_private_%'
      or public.get_my_role() = 'owner_admin'
    )
  );

drop policy if exists "admins manage documents" on public.documents;
create policy "admins manage documents" on public.documents
  for update using (
    public.is_admin()
    and daycare_id = public.get_my_daycare_id()
    and (
      coalesce(category, '') not like 'staff_private_%'
      or public.get_my_role() = 'owner_admin'
    )
  ) with check (
    public.is_admin()
    and daycare_id = public.get_my_daycare_id()
    and (
      coalesce(category, '') not like 'staff_private_%'
      or public.get_my_role() = 'owner_admin'
    )
  );

drop policy if exists "staff write documents bucket" on storage.objects;
create policy "staff write documents bucket" on storage.objects
  for insert with check (
    bucket_id = 'documents'
    and public.is_staff()
    and (
      name not like 'staff-private/%'
      or public.get_my_role() = 'owner_admin'
    )
  );

drop policy if exists "admins read documents bucket" on storage.objects;
create policy "admins read documents bucket" on storage.objects
  for select using (
    bucket_id = 'documents'
    and public.is_admin()
    and (
      name not like 'staff-private/%'
      or public.get_my_role() = 'owner_admin'
    )
  );

drop policy if exists "owners delete private staff documents bucket" on storage.objects;
create policy "owners delete private staff documents bucket" on storage.objects
  for delete using (
    bucket_id = 'documents'
    and name like 'staff-private/%'
    and public.get_my_role() = 'owner_admin'
  );

drop trigger if exists audit_documents on public.documents;
create trigger audit_documents
  after insert or update or delete on public.documents
  for each row execute function public.audit_write();
