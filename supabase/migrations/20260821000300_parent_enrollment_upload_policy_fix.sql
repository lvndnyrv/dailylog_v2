-- Restore the Group 24 bearer upload policy after the hardening migration
-- replaced it with a caller-RLS subquery that cannot see enrollment rows.

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
      select 1 from public.enrollments enrollment
      where upper(enrollment.offer_code) = upper(btrim(p_code))
        and enrollment.offer_status in ('sent', 'viewed')
        and enrollment.offer_expires_at > now()
        and enrollment.offer_accepted_at is not null
        and enrollment.application_submitted_at is not null
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
