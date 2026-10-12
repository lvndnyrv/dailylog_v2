-- Keep staff invite acceptance on one terms-aware, auditable path. The
-- background-clearance migration previously updated only the legacy
-- one-argument overload, while every current client calls the three-argument
-- RPC. That allowed a clearance-required invite to be accepted without
-- creating its protected credential requirement.

drop function if exists public.accept_staff_invite(text);

create or replace function public.accept_staff_invite(
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
  v_staff_member_id uuid;
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
    status,
    background_check_required
  ) values (
    v_invite.daycare_id,
    v_user_id,
    v_invite.job_title,
    'active',
    coalesce(v_invite.require_background_check, false)
  )
  on conflict (daycare_id, profile_id)
  do update set
    status = 'active',
    ended_on = null,
    job_title = coalesce(excluded.job_title, public.staff_members.job_title),
    background_check_required =
      public.staff_members.background_check_required
      or excluded.background_check_required
  returning id into v_staff_member_id;

  if v_invite.require_background_check then
    insert into public.staff_credentials (
      daycare_id,
      staff_member_id,
      name,
      required,
      ratio_qualifying
    )
    select
      v_invite.daycare_id,
      v_staff_member_id,
      'Background check',
      true,
      false
    where not exists (
      select 1
        from public.staff_credentials credential
       where credential.staff_member_id = v_staff_member_id
         and credential.archived_at is null
         and lower(credential.name) ~ '(background|criminal record|vulnerable sector)'
    );
  end if;

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

  insert into public.audit_log (
    daycare_id,
    actor_id,
    action,
    entity_type,
    entity_id,
    before,
    after
  ) values (
    v_invite.daycare_id,
    v_user_id,
    'staff_invite_accepted',
    'staff_invite',
    v_invite.id,
    jsonb_build_object(
      'email', v_invite.email,
      'role', v_invite.role,
      'classroomId', v_invite.classroom_id,
      'backgroundCheckRequired', v_invite.require_background_check
    ),
    jsonb_build_object(
      'profileId', v_user_id,
      'staffMemberId', v_staff_member_id,
      'termsVersion', left(btrim(p_terms_version), 80),
      'clearancePending', coalesce(v_invite.require_background_check, false)
    )
  );
end;
$$;

revoke all on function public.accept_staff_invite(text, text, boolean)
  from public, anon;
grant execute on function public.accept_staff_invite(text, text, boolean)
  to authenticated, service_role;

comment on function public.accept_staff_invite(text, text, boolean) is
  'Atomically accepts an email-bound staff invite, records terms, creates employment and required clearance records, and audits the join.';
