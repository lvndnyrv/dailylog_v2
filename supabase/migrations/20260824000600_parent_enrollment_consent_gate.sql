-- Parent Mobile Group 14 integration completion.
--
-- Linking an enrolled family account must not silently accept DailyLog's
-- care-data consent. The parent sees the full-screen consent gate after the
-- child link is created, just like a family that joins with an invite code.

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
  v_co_name text;
  v_co_email text;
  v_invite_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in or create an account first'; end if;
  perform public.assert_rate_limit('parent_offer_link_account', 10, 900, auth.uid()::text);
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

  -- Consent is deliberately omitted. The link unlocks the family relationship;
  -- the separate audited Group 14 flow records the parent's actual decision.
  insert into public.parent_children (
    parent_id, child_id, relationship, pickup_authorized, is_primary
  ) values (
    auth.uid(), v_offer.child_id, 'Parent/guardian', true, true
  )
  on conflict (parent_id, child_id) do update set
    pickup_authorized = true,
    is_primary = true;

  v_co_name := nullif(btrim(v_offer.application_data->>'co_guardian_name'), '');
  v_co_email := nullif(lower(btrim(v_offer.application_data->>'co_guardian_email')), '');
  if v_offer.parent_account_linked_at is null
     and v_co_name is not null and v_co_email is not null
     and not exists (
       select 1 from public.parent_children link
       join public.profiles profile on profile.id = link.parent_id
       where link.child_id = v_offer.child_id and lower(profile.email) = v_co_email
     ) then
    select invite.id into v_invite_id
    from public.child_invite_codes invite
    where invite.child_id = v_offer.child_id
      and lower(invite.email) = v_co_email
      and invite.used_at is null
      and (invite.expires_at is null or invite.expires_at > now())
    order by invite.created_at desc
    limit 1;

    if v_invite_id is null then
      insert into public.child_invite_codes (
        daycare_id, child_id, code, email, relationship, created_by, expires_at
      ) values (
        v_offer.daycare_id, v_offer.child_id, public.generate_invite_code(),
        v_co_email, 'Parent/guardian', auth.uid(), now() + interval '14 days'
      ) returning id into v_invite_id;
    end if;
  end if;

  update public.enrollments
  set parent_account_linked_at = coalesce(parent_account_linked_at, now()),
      onboarding_steps = coalesce(onboarding_steps, '{}'::jsonb)
        || jsonb_build_object('account_linked', true),
      application_data = case when v_invite_id is null then application_data else
        coalesce(application_data, '{}'::jsonb) || jsonb_build_object(
          'co_guardian_invite_id', v_invite_id,
          'co_guardian_invite_created_at', now()
        ) end
  where id = v_offer.id;

  return public.get_parent_enrollment_offer(p_code) || jsonb_build_object(
    'co_guardian_invite', case when v_invite_id is null then null else (
      select jsonb_build_object(
        'id', invite.id,
        'email', invite.email,
        'relationship', invite.relationship,
        'code', invite.code,
        'expires_at', invite.expires_at
      )
      from public.child_invite_codes invite
      where invite.id = v_invite_id
    ) end
  );
end;
$$;

revoke all on function public.link_parent_enrollment_account(text) from public, anon;
grant execute on function public.link_parent_enrollment_account(text) to authenticated;
