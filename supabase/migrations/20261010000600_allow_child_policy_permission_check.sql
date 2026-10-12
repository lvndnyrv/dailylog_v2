-- PostgreSQL validates execute privileges for every function referenced by an
-- RLS expression while planning the query, even when an earlier CASE branch
-- would return false for an anonymous caller. This helper only evaluates the
-- current auth.uid() and returns false when there is no matching profile, so it
-- is safe for the anonymous role and lets roster reads fail closed as [].

grant execute on function public.has_permission_for_classroom(text, text, uuid)
  to anon;

