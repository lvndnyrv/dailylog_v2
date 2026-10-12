-- ============================================================================
-- DailyLog mobile Group 21 — reliable, auditable staff invite acceptance
-- ============================================================================

alter table public.staff_invites
  add column if not exists accepted_terms_at timestamptz,
  add column if not exists accepted_terms_version text;

-- Earlier migrations expanded invite_staff by adding defaulted arguments. In
-- PostgreSQL that created overloads instead of replacing the old signatures,
-- leaving PostgREST unable to choose a function when a client sent only the
-- three original fields. Keep one canonical RPC.
drop function if exists public.invite_staff(text, text, uuid);
drop function if exists public.invite_staff(text, text, uuid, text);

create or replace function public.invite_staff(
  p_email text,
  p_role text,
  p_classroom_id uuid default null,
  p_full_name text default null,
  p_job_title text default null,
  p_require_background_check boolean default false
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_daycare_id uuid;
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;
  if not has_permission('staff', 'edit') then
    raise exception 'Staff edit permission required';
  end if;

  v_daycare_id := get_my_daycare_id();
  if v_daycare_id is null then
    raise exception 'Your account is not attached to a center';
  end if;
  if v_email = '' or position('@' in v_email) < 2 then
    raise exception 'Enter a valid email address';
  end if;
  if p_role not in ('owner_admin', 'admin', 'educator') then
    raise exception 'Invalid staff role';
  end if;
  if p_classroom_id is not null and not exists (
    select 1
      from public.classrooms classroom
     where classroom.id = p_classroom_id
       and classroom.daycare_id = v_daycare_id
       and classroom.archived_at is null
  ) then
    raise exception 'The selected room does not belong to this center';
  end if;
  if exists (
    select 1
      from public.profiles profile
     where lower(profile.email) = v_email
       and profile.daycare_id is not null
       and profile.daycare_id <> v_daycare_id
  ) then
    raise exception 'This account already belongs to another center';
  end if;

  -- Keep the audit trail but make older pending links unusable. This also
  -- ensures the recipient sees one authoritative role/room assignment.
  update public.staff_invites invite
     set expires_at = least(coalesce(invite.expires_at, now()), now())
   where invite.daycare_id = v_daycare_id
     and lower(invite.email) = v_email
     and invite.accepted_at is null
     and (invite.expires_at is null or invite.expires_at > now());

  v_code := public.generate_invite_code();

  insert into public.staff_invites (
    daycare_id,
    email,
    role,
    classroom_id,
    code,
    full_name,
    job_title,
    require_background_check,
    invited_by,
    expires_at
  ) values (
    v_daycare_id,
    v_email,
    p_role,
    case when p_role = 'educator' then p_classroom_id else null end,
    v_code,
    nullif(btrim(p_full_name), ''),
    nullif(btrim(p_job_title), ''),
    coalesce(p_require_background_check, false),
    auth.uid(),
    now() + interval '14 days'
  );

  return v_code;
end;
$$;

-- Preview stays bearer-link accessible, but returns the complete assignment so
-- the recipient can confirm title and onboarding requirements before signup.
drop function if exists public.get_staff_invite(text);
create function public.get_staff_invite(p_code text)
returns table (
  email text,
  full_name text,
  role text,
  job_title text,
  require_background_check boolean,
  daycare_name text,
  classroom_name text,
  invited_by_name text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_rate_limit(
    'staff_invite_preview',
    20,
    600,
    left(upper(btrim(coalesce(p_code, ''))), 16)
  );

  return query
    select invite.email,
           invite.full_name,
           invite.role,
           invite.job_title,
           invite.require_background_check,
           daycare.name,
           classroom.name,
           inviter.full_name,
           invite.expires_at
      from public.staff_invites invite
      join public.daycares daycare on daycare.id = invite.daycare_id
      left join public.classrooms classroom on classroom.id = invite.classroom_id
      left join public.profiles inviter on inviter.id = invite.invited_by
     where upper(invite.code) = upper(btrim(coalesce(p_code, '')))
       and invite.accepted_at is null
       and (invite.expires_at is null or invite.expires_at > now());
end;
$$;

-- An invited account may be new (no center) or already be a parent at this
-- same center. In either case, the still-pending invite is the administrator's
-- authorization for the role assignment.
create or replace function public.enforce_profile_role_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' or (auth.uid() is null and auth.role() is null) then return new; end if;
  if new.role is not distinct from old.role
     and new.daycare_id is not distinct from old.daycare_id
     and new.center_role_id is not distinct from old.center_role_id then return new; end if;

  -- First-time center owner setup.
  if new.id = auth.uid() and old.daycare_id is null and new.role = 'owner_admin'
     and exists (select 1 from daycares d where d.id = new.daycare_id and d.created_by = auth.uid()) then
    select id into new.center_role_id from center_roles
     where daycare_id = new.daycare_id and name = 'Owner admin' limit 1;
    return new;
  end if;
  -- Invite acceptance can attach a new account or promote an existing parent
  -- already connected to this center.
  if new.id = auth.uid()
     and (old.daycare_id is null or old.daycare_id = new.daycare_id)
     and exists (
       select 1
         from staff_invites invite
         left join center_roles center_role on center_role.id = new.center_role_id
        where lower(invite.email) = lower(new.email)
          and invite.daycare_id = new.daycare_id
          and invite.role = new.role
          and invite.accepted_at is null
          and (invite.expires_at is null or invite.expires_at > now())
          and (
            new.center_role_id is null
            or (
              center_role.daycare_id = invite.daycare_id
              and center_role.base_role = invite.role
            )
          )
     ) then return new; end if;
  -- Legacy center join codes are still supported during the migration window.
  if new.id = auth.uid() and old.daycare_id is null and exists (
    select 1 from daycare_signup_codes dc
     where dc.daycare_id = new.daycare_id and dc.role = new.role
       and coalesce(dc.uses_remaining, 0) > 0
       and (dc.expires_at is null or dc.expires_at > now())
  ) then return new; end if;
  -- A parent adopts the linked child's center when redeeming an invite.
  if new.id = auth.uid() and new.role = 'parent' and old.daycare_id is null
     and new.daycare_id is not null and exists (
    select 1 from child_invite_codes ci
    join children c on c.id = ci.child_id
     where c.daycare_id = new.daycare_id and ci.used_at is null
       and (ci.email is null or lower(ci.email) = lower(new.email))
       and (ci.expires_at is null or ci.expires_at > now())
  ) then return new; end if;

  if not has_permission('staff', 'approve') then raise exception 'Staff approval permission required'; end if;
  if new.role is distinct from old.role
     and new.center_role_id is not distinct from old.center_role_id then
    select r.id into new.center_role_id
      from center_roles r
     where r.daycare_id = new.daycare_id
       and r.name = default_role_name(new.role, null, new.classroom_id)
     limit 1;
  end if;
  return new;
end;
$$;

drop function if exists public.accept_staff_invite(text);
create function public.accept_staff_invite(
  p_code text,
  p_terms_version text,
  p_terms_accepted boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.staff_invites%rowtype;
  v_user_id uuid := auth.uid();
  v_my_email text;
  v_existing_daycare uuid;
  v_role_id uuid;
  v_classroom_id uuid;
  v_updated integer;
begin
  if v_user_id is null then
    raise exception 'Sign in before accepting this invitation';
  end if;
  if p_terms_accepted is not true
     or nullif(btrim(coalesce(p_terms_version, '')), '') is null then
    raise exception 'Accept the Staff Terms and confidentiality policy to continue';
  end if;

  select invite.*
    into v_invite
    from public.staff_invites invite
   where upper(invite.code) = upper(btrim(coalesce(p_code, '')))
     and invite.accepted_at is null
     and (invite.expires_at is null or invite.expires_at > now())
   for update;

  if v_invite.id is null then
    raise exception 'This invitation is invalid, expired, or already accepted';
  end if;

  select profile.email, profile.daycare_id
    into v_my_email, v_existing_daycare
    from public.profiles profile
   where profile.id = v_user_id
   for update;

  if v_my_email is null then
    raise exception 'Your account profile is not ready yet. Please try again';
  end if;
  if lower(btrim(v_my_email)) <> lower(btrim(v_invite.email)) then
    raise exception 'This invitation was sent to a different email address';
  end if;
  if v_existing_daycare is not null
     and v_existing_daycare <> v_invite.daycare_id then
    raise exception 'This account already belongs to another center';
  end if;

  if v_invite.classroom_id is not null then
    select classroom.id
      into v_classroom_id
      from public.classrooms classroom
     where classroom.id = v_invite.classroom_id
       and classroom.daycare_id = v_invite.daycare_id
       and classroom.archived_at is null;
    if v_classroom_id is null then
      raise exception 'The room on this invitation is no longer available';
    end if;
  end if;

  -- Centers created before the role library migration may not have defaults.
  perform public.seed_default_roles(v_invite.daycare_id);
  select center_role.id
    into v_role_id
    from public.center_roles center_role
   where center_role.daycare_id = v_invite.daycare_id
     and center_role.name = public.default_role_name(
       v_invite.role,
       v_invite.job_title,
       v_invite.classroom_id
     )
   limit 1;

  if v_role_id is null then
    raise exception 'The center role on this invitation is not configured';
  end if;

  -- Keep the trusted assignment in one profile update. Splitting center_role_id
  -- into a second update made the RBAC trigger treat it as an unapproved edit.
  update public.profiles
     set role = v_invite.role,
         daycare_id = v_invite.daycare_id,
         classroom_id = case
           when v_invite.role = 'educator' then v_classroom_id
           else null
         end,
         center_role_id = v_role_id
   where id = v_user_id;

  if v_invite.role = 'educator' and v_classroom_id is not null then
    insert into public.educator_classrooms (educator_id, classroom_id)
    values (v_user_id, v_classroom_id)
    on conflict do nothing;
  end if;

  insert into public.staff_members (
    daycare_id,
    profile_id,
    job_title,
    status
  ) values (
    v_invite.daycare_id,
    v_user_id,
    v_invite.job_title,
    'active'
  )
  on conflict (daycare_id, profile_id)
  do update set
    status = 'active',
    ended_on = null,
    job_title = coalesce(excluded.job_title, staff_members.job_title);

  update public.staff_invites
     set accepted_at = now(),
         accepted_by = v_user_id,
         accepted_terms_at = now(),
         accepted_terms_version = left(btrim(p_terms_version), 80)
   where id = v_invite.id
     and accepted_at is null;
  get diagnostics v_updated = row_count;

  if v_updated <> 1 then
    raise exception 'This invitation has already been accepted';
  end if;
end;
$$;

-- Explicit grants avoid PostgreSQL's default PUBLIC execute privilege on
-- security-definer functions. Preview is intentionally anonymous; mutations
-- require an authenticated user and still perform permission checks inside.
revoke all on function public.get_staff_invite(text) from public;
grant execute on function public.get_staff_invite(text) to anon, authenticated, service_role;

revoke all on function public.accept_staff_invite(text, text, boolean) from public, anon;
grant execute on function public.accept_staff_invite(text, text, boolean) to authenticated, service_role;

revoke all on function public.invite_staff(text, text, uuid, text, text, boolean) from public, anon;
grant execute on function public.invite_staff(text, text, uuid, text, text, boolean) to authenticated, service_role;

revoke all on function public.generate_invite_code() from public, anon, authenticated;
grant execute on function public.generate_invite_code() to service_role;

revoke all on function public.enqueue_email_notification(uuid, text, text, text, text, jsonb, text)
  from public, anon;
grant execute on function public.enqueue_email_notification(uuid, text, text, text, text, jsonb, text)
  to authenticated, service_role;
