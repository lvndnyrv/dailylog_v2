-- Route credential-renewal alerts only to active people who can actually
-- approve staff records. The original Group 24 implementation notified every
-- admin-role profile, including custom admin roles that explicitly removed
-- staff approval.

create or replace function public.profile_has_permission(
  p_profile_id uuid,
  p_area text,
  p_action text default 'view'
)
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_profile_role text;
  v_daycare_id uuid;
  v_permissions jsonb;
  v_value text;
begin
  if p_area = 'rooms' then p_area := 'daily_logs'; end if;
  if p_area not in (
    'daily_logs', 'attendance', 'medications', 'incidents', 'children',
    'enrollment', 'broadcasts', 'billing', 'reports', 'staff'
  ) or p_action not in ('view', 'edit', 'approve') then
    return false;
  end if;

  select profile.role, profile.daycare_id, role.permissions
    into v_profile_role, v_daycare_id, v_permissions
    from public.profiles profile
    left join public.center_roles role
      on role.id = profile.center_role_id
     and role.daycare_id = profile.daycare_id
   where profile.id = p_profile_id
     and profile.archived_at is null;

  if v_profile_role is null then return false; end if;
  if v_profile_role = 'owner_admin' then return true; end if;

  if exists (
    select 1
      from public.staff_delegations delegation
     where delegation.delegate_profile_id = p_profile_id
       and delegation.daycare_id = v_daycare_id
       and delegation.starts_at <= now()
       and delegation.ends_at > now()
       and delegation.revoked_at is null
       and (
         (delegation.access_level = 'full_admin' and p_area <> 'billing')
         or p_area = any(delegation.areas)
         or ('compliance' = any(delegation.areas)
             and p_area in ('medications', 'incidents'))
       )
  ) then
    return true;
  end if;

  v_value := v_permissions #>> array[p_area, p_action];
  if v_value in ('true', 'false') then return v_value::boolean; end if;
  if v_profile_role = 'admin' then return true; end if;
  if v_profile_role = 'educator' then
    if p_action = 'view' then
      return p_area in (
        'daily_logs', 'attendance', 'medications', 'incidents', 'children',
        'broadcasts'
      );
    elsif p_action = 'edit' then
      return p_area in ('daily_logs', 'attendance', 'medications', 'incidents');
    end if;
  end if;
  return false;
end;
$$;

revoke all on function public.profile_has_permission(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.profile_has_permission(uuid, text, text)
  to service_role;

create or replace function public.submit_mobile_credential_renewal(
  p_credential_id uuid,
  p_issuer text,
  p_completed_on date,
  p_expires_on date,
  p_credential_number text,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_size_bytes bigint
)
returns uuid
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_member public.staff_members%rowtype;
  v_credential public.staff_credentials%rowtype;
  v_document_id uuid;
  v_submission_id uuid;
  v_prefix text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  v_member.id := public.my_staff_member_id();
  select * into v_member from public.staff_members where id = v_member.id;
  if v_member.id is null or v_member.profile_id <> auth.uid() then
    raise exception 'Active staff record required';
  end if;

  select * into v_credential
    from public.staff_credentials credential
   where credential.id = p_credential_id
     and credential.staff_member_id = v_member.id
     and credential.daycare_id = v_member.daycare_id;
  if v_credential.id is null then raise exception 'Credential not found'; end if;

  perform public.assert_rate_limit(
    'mobile_credential_submit', 10, 3600, p_credential_id::text
  );

  if nullif(btrim(p_issuer), '') is null or length(btrim(p_issuer)) > 120 then
    raise exception 'Enter the organization that issued the credential';
  end if;
  if p_completed_on is null or p_completed_on > public.center_today() + 1 then
    raise exception 'Enter a valid completion date';
  end if;
  if p_expires_on is null or p_expires_on <= p_completed_on then
    raise exception 'The expiry must be after the completion date';
  end if;
  if p_mime_type not in (
    'application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif'
  ) then
    raise exception 'Upload a PDF, JPG, PNG or HEIC document';
  end if;
  if p_size_bytes is null or p_size_bytes < 1 or p_size_bytes > 10485760 then
    raise exception 'The document must be 10 MB or smaller';
  end if;
  if nullif(btrim(p_file_name), '') is null or length(p_file_name) > 180 then
    raise exception 'The selected file name is invalid';
  end if;

  v_prefix := 'staff-credentials/' || v_member.daycare_id::text || '/' ||
    auth.uid()::text || '/';
  if left(p_storage_path, length(v_prefix)) <> v_prefix
     or p_storage_path like '%..%' then
    raise exception 'The document path is invalid';
  end if;
  if not exists (
    select 1 from storage.objects object
     where object.bucket_id = 'documents' and object.name = p_storage_path
  ) then
    raise exception 'The document upload did not finish. Please try again';
  end if;
  if exists (
    select 1 from public.staff_credential_submissions submission
     where submission.credential_id = p_credential_id
       and submission.status = 'pending'
  ) then
    raise exception 'A renewal is already awaiting verification';
  end if;

  insert into public.documents (
    daycare_id, profile_id, title, category, storage_path, mime_type,
    size_bytes, expires_on, uploaded_by
  ) values (
    v_member.daycare_id, auth.uid(), p_file_name, 'staff_credential_renewal',
    p_storage_path, p_mime_type, p_size_bytes, p_expires_on, auth.uid()
  ) returning id into v_document_id;

  insert into public.staff_credential_submissions (
    daycare_id, staff_member_id, credential_id, document_id, submitted_by,
    issuer, completed_on, expires_on, credential_number
  ) values (
    v_member.daycare_id, v_member.id, v_credential.id, v_document_id, auth.uid(),
    btrim(p_issuer), p_completed_on, p_expires_on,
    nullif(btrim(coalesce(p_credential_number, '')), '')
  ) returning id into v_submission_id;

  insert into public.notifications (
    daycare_id, profile_id, kind, title, body, payload
  )
  select
    v_member.daycare_id,
    reviewer.id,
    'credential_review',
    'Credential renewal needs review',
    submitter.full_name || ' submitted a ' || v_credential.name || ' renewal.',
    jsonb_build_object(
      'type', 'credential_review',
      'submissionId', v_submission_id,
      'staffMemberId', v_member.id,
      'screen', 'StaffCredentialReview',
      'category', 'compliance',
      'source', 'Compliance',
      'href', '/staff/' || v_member.id::text,
      'action_label', 'Review renewal',
      'severity', 'warning'
    )
  from public.profiles reviewer
  join public.profiles submitter on submitter.id = auth.uid()
  where reviewer.daycare_id = v_member.daycare_id
    and public.profile_has_permission(reviewer.id, 'staff', 'approve');

  return v_submission_id;
end;
$$;

revoke all on function public.submit_mobile_credential_renewal(
  uuid, text, date, date, text, text, text, text, bigint
) from public, anon;
grant execute on function public.submit_mobile_credential_renewal(
  uuid, text, date, date, text, text, text, text, bigint
) to authenticated;

comment on function public.profile_has_permission(uuid, text, text) is
  'Evaluates the effective center-role and active delegation permissions for another active profile.';

notify pgrst, 'reload schema';
