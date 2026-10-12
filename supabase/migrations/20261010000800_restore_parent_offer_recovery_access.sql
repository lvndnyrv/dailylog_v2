-- An expired family offer can be reopened from the same opaque bearer-code
-- journey before the family has an account. The function validates the code,
-- workflow state and rate limit internally.

grant execute on function public.reopen_parent_enrollment_offer(text)
  to anon;

