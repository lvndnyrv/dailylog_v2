-- Group 24 account handoff: profiles are born as parent accounts through the
-- trusted auth trigger. Linking only attaches that existing parent to the
-- offer's center, avoiding a role-assignment mutation entirely.

create or replace function public.link_parent_enrollment_account(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer public.enrollments%rowtype;
  v_email text;
  v_role text;
begin
  if auth.uid() is null then raise exception 'Sign in or create an account first'; end if;
  perform assert_rate_limit('parent_offer_link_account', 10, 900, auth.uid()::text);
  select email, role into v_email, v_role from public.profiles where id = auth.uid();
  select * into v_offer from public.enrollments
  where upper(offer_code) = upper(btrim(p_code)) for update;
  if v_offer.id is null then raise exception 'This offer link is invalid'; end if;
  if v_offer.stage <> 'enrolled' or v_offer.child_id is null then raise exception 'Complete enrollment first'; end if;
  if lower(coalesce(v_email, '')) <> lower(coalesce(v_offer.guardian_email, '')) then
    raise exception 'Sign in with the email address this offer was sent to';
  end if;
  if v_role <> 'parent' then raise exception 'A parent account is required'; end if;

  update public.profiles
  set daycare_id = coalesce(daycare_id, v_offer.daycare_id)
  where id = auth.uid()
    and (daycare_id is null or daycare_id = v_offer.daycare_id);
  if not found then raise exception 'This account belongs to another center'; end if;

  insert into public.parent_children (
    parent_id, child_id, relationship, pickup_authorized, is_primary, consent_given_at
  ) values (auth.uid(), v_offer.child_id, 'Parent/guardian', true, true, now())
  on conflict (parent_id, child_id) do update set
    pickup_authorized = true, is_primary = true,
    consent_given_at = coalesce(parent_children.consent_given_at, now());

  update public.enrollments
  set parent_account_linked_at = coalesce(parent_account_linked_at, now()),
      onboarding_steps = coalesce(onboarding_steps, '{}'::jsonb)
        || jsonb_build_object('account_linked', true)
  where id = v_offer.id;
  return public.get_parent_enrollment_offer(p_code);
end;
$$;

grant execute on function public.link_parent_enrollment_account(text) to authenticated;
