-- Parent Mobile Group 24 privacy completion.
--
-- An enrollment offer code is intentionally a bearer credential while a
-- prospective family completes the application. Once that offer has been
-- linked to a parent account, the same link must no longer expose the child's
-- application, documents, or guardian details to an anonymous caller.

alter function public.get_parent_enrollment_offer(text)
  rename to get_parent_enrollment_offer_bearer_internal;

revoke all on function public.get_parent_enrollment_offer_bearer_internal(text)
  from public, anon, authenticated;

create or replace function public.get_parent_enrollment_offer(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enrollment_id uuid;
  v_child_id uuid;
  v_account_linked_at timestamptz;
begin
  select enrollment.id, enrollment.child_id, enrollment.parent_account_linked_at
  into v_enrollment_id, v_child_id, v_account_linked_at
  from public.enrollments enrollment
  where upper(enrollment.offer_code) = upper(btrim(p_code));

  if v_enrollment_id is not null and v_account_linked_at is not null then
    if auth.uid() is null or not exists (
      select 1
      from public.parent_children family_link
      where family_link.parent_id = auth.uid()
        and family_link.child_id = v_child_id
    ) then
      raise exception 'Sign in with the family account linked to this enrollment';
    end if;
  end if;

  return public.get_parent_enrollment_offer_bearer_internal(p_code);
end;
$$;

revoke all on function public.get_parent_enrollment_offer(text) from public;
grant execute on function public.get_parent_enrollment_offer(text)
  to anon, authenticated;

comment on function public.get_parent_enrollment_offer(text) is
  'Returns bearer offer details before account linking; afterwards requires the linked parent account.';
