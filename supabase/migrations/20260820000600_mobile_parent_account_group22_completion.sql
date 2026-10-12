-- ============================================================================
-- Parent mobile Group 22 completion
-- Parent-specific profile editing, recoverable guardian invitations, and
-- independent privacy request statuses.
-- ============================================================================

create or replace function public.get_parent_account_hub()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_children jsonb := '[]'::jsonb;
  v_requests jsonb := '[]'::jsonb;
  v_request jsonb;
begin
  select * into v_profile
  from public.profiles
  where id = auth.uid() and role = 'parent' and archived_at is null;

  if v_profile.id is null then
    raise exception 'A signed-in parent account is required';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', child.id,
      'first_name', child.first_name,
      'last_name', child.last_name,
      'date_of_birth', child.date_of_birth,
      'photo_url', child.photo_url,
      'classroom_name', child.classroom_name,
      'is_primary', child.is_primary,
      'guardians', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', guardian.id,
          'full_name', guardian.full_name,
          'email', guardian.email,
          'relationship', link.relationship,
          'is_primary', link.is_primary,
          'is_current_user', guardian.id = auth.uid()
        ) order by link.is_primary desc, guardian.full_name)
        from public.parent_children link
        join public.profiles guardian on guardian.id = link.parent_id
        where link.child_id = child.id and guardian.archived_at is null
      ), '[]'::jsonb),
      'pending_invites', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', invite.id,
          'email', invite.email,
          'relationship', invite.relationship,
          'code', invite.code,
          'created_at', invite.created_at,
          'expires_at', invite.expires_at
        ) order by invite.created_at desc)
        from public.child_invite_codes invite
        where invite.child_id = child.id
          and invite.created_by = auth.uid()
          and invite.used_at is null
          and (invite.expires_at is null or invite.expires_at > now())
      ), '[]'::jsonb)
    ) order by child.first_name, child.last_name
  ), '[]'::jsonb)
  into v_children
  from (
    select c.id, c.first_name, c.last_name, c.date_of_birth, c.photo_url,
           room.name as classroom_name, mine.is_primary
    from public.parent_children mine
    join public.children c on c.id = mine.child_id and c.archived_at is null
    left join public.classrooms room on room.id = c.classroom_id
    where mine.parent_id = auth.uid()
  ) child;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', request.id,
    'request_type', request.request_type,
    'status', request.status,
    'requested_at', request.requested_at,
    'completed_at', request.completed_at
  ) order by request.requested_at desc), '[]'::jsonb)
  into v_requests
  from public.parent_data_requests request
  where request.profile_id = auth.uid();

  select item into v_request
  from jsonb_array_elements(v_requests) item
  limit 1;

  return jsonb_build_object(
    'profile', jsonb_build_object(
      'id', v_profile.id,
      'full_name', v_profile.full_name,
      'display_name', v_profile.display_name,
      'email', v_profile.email,
      'phone', v_profile.phone,
      'avatar_url', v_profile.avatar_url
    ),
    'children', v_children,
    'data_requests', v_requests,
    'latest_data_request', v_request
  );
end;
$$;

create or replace function public.update_parent_profile(
  p_full_name text,
  p_display_name text,
  p_phone text default null,
  p_avatar_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_full_name text := btrim(coalesce(p_full_name, ''));
  v_display_name text := btrim(coalesce(p_display_name, ''));
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
begin
  if auth.uid() is null then
    raise exception 'A signed-in parent account is required';
  end if;
  if char_length(v_full_name) not between 2 and 120 then
    raise exception 'Full name must be between 2 and 120 characters';
  end if;
  if char_length(v_display_name) not between 1 and 60 then
    raise exception 'Display name must be between 1 and 60 characters';
  end if;
  if v_phone is not null and char_length(v_phone) > 32 then
    raise exception 'Phone number must be 32 characters or fewer';
  end if;
  if p_avatar_url is not null
     and p_avatar_url <> ''
     and p_avatar_url not like '%/storage/v1/object/public/profile-avatars/' || auth.uid()::text || '/%' then
    raise exception 'Profile photo must belong to the signed-in account';
  end if;

  update public.profiles profile
  set full_name = v_full_name,
      display_name = v_display_name,
      phone = coalesce(v_phone, ''),
      avatar_url = case
        when p_avatar_url is null then profile.avatar_url
        when p_avatar_url = '' then null
        else p_avatar_url
      end,
      updated_at = now()
  where profile.id = auth.uid()
    and profile.role = 'parent'
    and profile.archived_at is null
  returning * into v_profile;

  if v_profile.id is null then
    raise exception 'A signed-in parent account is required';
  end if;

  return jsonb_build_object(
    'id', v_profile.id,
    'full_name', v_profile.full_name,
    'display_name', v_profile.display_name,
    'email', v_profile.email,
    'phone', v_profile.phone,
    'avatar_url', v_profile.avatar_url
  );
end;
$$;

create or replace function public.cancel_parent_co_guardian_invite(p_invite_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted uuid;
begin
  delete from public.child_invite_codes invite
  using public.parent_children mine
  where invite.id = p_invite_id
    and invite.created_by = auth.uid()
    and invite.used_at is null
    and mine.parent_id = auth.uid()
    and mine.child_id = invite.child_id
  returning invite.id into v_deleted;

  if v_deleted is null then
    raise exception 'This invitation is no longer available';
  end if;
  return true;
end;
$$;

create or replace function public.cancel_parent_data_request(p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cancelled uuid;
begin
  update public.parent_data_requests request
  set status = 'cancelled', updated_at = now()
  where request.id = p_request_id
    and request.profile_id = auth.uid()
    and request.status = 'requested'
  returning request.id into v_cancelled;

  if v_cancelled is null then
    raise exception 'Only a pending request can be cancelled';
  end if;
  return true;
end;
$$;

revoke all on function public.get_parent_account_hub() from public, anon;
revoke all on function public.update_parent_profile(text, text, text, text) from public, anon;
revoke all on function public.cancel_parent_co_guardian_invite(uuid) from public, anon;
revoke all on function public.cancel_parent_data_request(uuid) from public, anon;

grant execute on function public.get_parent_account_hub() to authenticated;
grant execute on function public.update_parent_profile(text, text, text, text) to authenticated;
grant execute on function public.cancel_parent_co_guardian_invite(uuid) to authenticated;
grant execute on function public.cancel_parent_data_request(uuid) to authenticated;
