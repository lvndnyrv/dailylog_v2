-- Mobile Parent Group 16: safe child-invite preview and confirmed redemption.
-- A code can now be inspected without consuming it, so the parent can verify
-- the child and relationship before the family link is created.

create or replace function public.preview_parent_child_invite(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.child_invite_codes%rowtype;
  v_email text;
  v_already_linked boolean;
  v_result jsonb;
begin
  if auth.uid() is null or public.get_my_role() <> 'parent' then
    raise exception 'PARENT_INVITE_AUTH_REQUIRED: Sign in with a parent account first';
  end if;

  perform public.assert_rate_limit('parent_child_invite_preview', 20, 900);

  select * into v_invite
  from public.child_invite_codes
  where upper(code) = upper(btrim(p_code));

  if v_invite.id is null then
    raise exception 'PARENT_INVITE_NOT_FOUND: Check the code and try again';
  end if;

  select email into v_email from public.profiles where id = auth.uid();
  if v_invite.email is not null and lower(v_invite.email) <> lower(v_email) then
    raise exception 'PARENT_INVITE_EMAIL_MISMATCH: Sign in with the email address this invitation was sent to';
  end if;

  select exists (
    select 1 from public.parent_children link
    where link.parent_id = auth.uid() and link.child_id = v_invite.child_id
  ) into v_already_linked;

  if v_invite.used_at is not null
     and not (v_invite.used_by = auth.uid() and v_already_linked) then
    raise exception 'PARENT_INVITE_ALREADY_USED: Ask the center for a new invitation';
  end if;

  if v_invite.used_at is null
     and v_invite.expires_at is not null
     and v_invite.expires_at <= now() then
    raise exception 'PARENT_INVITE_EXPIRED: Ask the center for a new invitation';
  end if;

  select jsonb_build_object(
    'invite_id', v_invite.id,
    'child_id', child.id,
    'child_first_name', child.first_name,
    'child_last_name', child.last_name,
    'child_photo_url', child.photo_url,
    'daycare_id', daycare.id,
    'daycare_name', daycare.name,
    'classroom_id', classroom.id,
    'classroom_name', classroom.name,
    'classroom_age_group', classroom.age_group,
    'invited_by_name', creator.full_name,
    'relationship', coalesce(v_invite.relationship, 'Parent'),
    'expires_at', v_invite.expires_at,
    'already_linked', v_already_linked
  ) into v_result
  from public.children child
  join public.daycares daycare on daycare.id = child.daycare_id
  left join public.classrooms classroom on classroom.id = child.classroom_id
  left join public.profiles creator on creator.id = v_invite.created_by
  where child.id = v_invite.child_id and child.archived_at is null;

  if v_result is null then
    raise exception 'PARENT_INVITE_UNAVAILABLE: This child is no longer available to link';
  end if;

  return v_result;
end;
$$;

create or replace function public.accept_parent_child_invite(
  p_code text,
  p_relationship text default 'Parent'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.child_invite_codes%rowtype;
  v_email text;
  v_relationship text;
  v_already_linked boolean;
  v_result jsonb;
begin
  if auth.uid() is null or public.get_my_role() <> 'parent' then
    raise exception 'PARENT_INVITE_AUTH_REQUIRED: Sign in with a parent account first';
  end if;

  perform public.assert_rate_limit('parent_child_invite_accept', 10, 900);

  select * into v_invite
  from public.child_invite_codes
  where upper(code) = upper(btrim(p_code))
  for update;

  if v_invite.id is null then
    raise exception 'PARENT_INVITE_NOT_FOUND: Check the code and try again';
  end if;

  select email into v_email from public.profiles where id = auth.uid();
  if v_invite.email is not null and lower(v_invite.email) <> lower(v_email) then
    raise exception 'PARENT_INVITE_EMAIL_MISMATCH: Sign in with the email address this invitation was sent to';
  end if;

  select exists (
    select 1 from public.parent_children link
    where link.parent_id = auth.uid() and link.child_id = v_invite.child_id
  ) into v_already_linked;

  if v_invite.used_at is not null then
    if v_invite.used_by = auth.uid() and v_already_linked then
      return public.preview_parent_child_invite(p_code) || jsonb_build_object('already_linked', true);
    end if;
    raise exception 'PARENT_INVITE_ALREADY_USED: Ask the center for a new invitation';
  end if;

  if v_invite.expires_at is not null and v_invite.expires_at <= now() then
    raise exception 'PARENT_INVITE_EXPIRED: Ask the center for a new invitation';
  end if;

  v_relationship := nullif(btrim(p_relationship), '');
  if v_relationship not in ('Parent', 'Guardian', 'Grandparent', 'Foster parent', 'Other') then
    raise exception 'PARENT_INVITE_RELATIONSHIP_INVALID: Choose a valid relationship';
  end if;

  insert into public.parent_children (
    parent_id,
    child_id,
    relationship,
    pickup_authorized,
    is_primary,
    consent_given_at
  ) values (
    auth.uid(),
    v_invite.child_id,
    v_relationship,
    true,
    not exists (
      select 1 from public.parent_children link where link.child_id = v_invite.child_id
    ),
    null
  )
  on conflict (parent_id, child_id) do update
    set relationship = excluded.relationship;

  update public.profiles
  set daycare_id = (
    select child.daycare_id from public.children child where child.id = v_invite.child_id
  )
  where id = auth.uid() and daycare_id is null;

  update public.child_invite_codes
  set used_at = now(), used_by = auth.uid()
  where id = v_invite.id;

  v_result := public.preview_parent_child_invite(p_code);
  return v_result || jsonb_build_object('already_linked', v_already_linked);
end;
$$;

revoke all on function public.preview_parent_child_invite(text) from public, anon;
revoke all on function public.accept_parent_child_invite(text, text) from public, anon;
grant execute on function public.preview_parent_child_invite(text) to authenticated;
grant execute on function public.accept_parent_child_invite(text, text) to authenticated;

comment on function public.preview_parent_child_invite(text) is
  'Returns the minimum child and center identity needed for a parent to confirm a valid email-bound invite without consuming it.';
comment on function public.accept_parent_child_invite(text, text) is
  'Confirms and consumes a child invite after preview; leaves privacy consent pending for the explicit consent flow.';
