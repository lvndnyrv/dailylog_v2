-- Mobile Parent Group 16 completion: keep family invites aligned with the
-- seven-day product promise and preserve center-provided relationship labels.

create or replace function public.create_parent_invite(
  p_child_id uuid,
  p_email text,
  p_relationship text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_email text := lower(btrim(p_email));
  v_relationship text := nullif(btrim(p_relationship), '');
begin
  if not public.can_write_child(p_child_id) then
    raise exception 'No access to this child';
  end if;

  if v_email is null or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid parent email address';
  end if;

  if length(v_relationship) > 60 or v_relationship ~ '[[:cntrl:]]' then
    raise exception 'Enter a valid relationship';
  end if;

  v_code := public.generate_invite_code();

  insert into public.child_invite_codes (
    daycare_id,
    child_id,
    code,
    email,
    relationship,
    created_by,
    expires_at
  )
  select
    child.daycare_id,
    child.id,
    v_code,
    v_email,
    v_relationship,
    auth.uid(),
    now() + interval '7 days'
  from public.children child
  where child.id = p_child_id and child.archived_at is null;

  if not found then
    raise exception 'This child is no longer available';
  end if;

  return v_code;
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
      return public.preview_parent_child_invite(p_code)
        || jsonb_build_object('already_linked', true);
    end if;
    raise exception 'PARENT_INVITE_ALREADY_USED: Ask the center for a new invitation';
  end if;

  if v_invite.expires_at is not null and v_invite.expires_at <= now() then
    raise exception 'PARENT_INVITE_EXPIRED: Ask the center for a new invitation';
  end if;

  v_relationship := coalesce(
    nullif(btrim(p_relationship), ''),
    nullif(btrim(v_invite.relationship), ''),
    'Parent'
  );
  if length(v_relationship) > 60 or v_relationship ~ '[[:cntrl:]]' then
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

revoke all on function public.create_parent_invite(uuid, text, text) from public, anon, authenticated;
revoke all on function public.accept_parent_child_invite(text, text) from public, anon;
grant execute on function public.create_parent_invite(uuid, text, text) to authenticated;
grant execute on function public.accept_parent_child_invite(text, text) to authenticated;

comment on function public.create_parent_invite(uuid, text, text) is
  'Creates an email-bound, single-use family invitation that expires after seven days.';
comment on function public.accept_parent_child_invite(text, text) is
  'Confirms a family invitation, preserving safe center-provided relationship labels, and leaves explicit privacy consent pending.';
