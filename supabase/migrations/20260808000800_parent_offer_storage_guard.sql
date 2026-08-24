-- Storage policies execute their subqueries under the caller's RLS context.
-- Keep the enrollment table private and expose only this boolean bearer check.

create or replace function public.can_upload_parent_enrollment_document(
  p_code text,
  p_kind text
)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select p_kind in ('immunization', 'birth_certificate', 'custody')
    and exists (
      select 1 from public.enrollments e
      where upper(e.offer_code) = upper(btrim(p_code))
        and e.offer_status in ('sent', 'viewed')
        and e.offer_expires_at > now()
        and e.offer_accepted_at is not null
    )
$$;

revoke all on function public.can_upload_parent_enrollment_document(text, text) from public;
grant execute on function public.can_upload_parent_enrollment_document(text, text) to anon, authenticated;

drop policy if exists "families upload active enrollment offer documents" on storage.objects;
create policy "families upload active enrollment offer documents"
  on storage.objects for insert to anon, authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = 'enrollment-offers'
    and public.can_upload_parent_enrollment_document(
      (storage.foldername(name))[2],
      (storage.foldername(name))[3]
    )
  );
