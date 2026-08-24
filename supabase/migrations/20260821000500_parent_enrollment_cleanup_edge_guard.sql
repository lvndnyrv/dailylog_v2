-- Cleanup is performed by the JWT-protected Edge Function with service-role
-- Storage access. Keep the eligibility predicate private to that worker.

drop policy if exists "families delete unreferenced enrollment offer uploads" on storage.objects;

revoke all on function public.can_delete_parent_enrollment_upload(text)
  from public, anon, authenticated;
grant execute on function public.can_delete_parent_enrollment_upload(text)
  to service_role;
