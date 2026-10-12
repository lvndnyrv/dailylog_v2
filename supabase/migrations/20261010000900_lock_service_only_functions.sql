-- New routines must opt in to client execution explicitly. Service-side jobs
-- retain their existing service_role grant.

alter default privileges for role postgres in schema public
  revoke execute on functions from authenticated;

-- These routines are scheduler/worker internals. Client-facing medication and
-- waitlist RPCs call the appropriate workflow functions instead.
revoke execute on function public.enqueue_system_medication_notification(
  uuid, text, text, jsonb, text
) from public, anon, authenticated;

revoke execute on function public.process_medication_authorization_statuses()
  from public, anon, authenticated;

revoke execute on function public.process_overdue_waitlist_checkins()
  from public, anon, authenticated;

