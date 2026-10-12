-- A required credential is incomplete until both its completion record and
-- original document are on file. Keep educator mobile status aligned with the
-- admin staff file, compliance register, inspection pack, and ratio gate.

create or replace function public.get_mobile_staff_credentials()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_member public.staff_members%rowtype;
  v_reviewer_name text;
  v_credentials jsonb := '[]'::jsonb;
  v_today date := public.center_today();
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select member.* into v_member
    from public.staff_members member
   where member.id = public.my_staff_member_id()
     and member.profile_id = auth.uid()
     and member.status = 'active'
     and member.archived_at is null;
  if v_member.id is null then raise exception 'Active staff record required'; end if;

  select profile.full_name into v_reviewer_name
    from public.profiles profile
   where profile.daycare_id = v_member.daycare_id
     and profile.role in ('owner_admin', 'admin')
     and profile.archived_at is null
   order by case when profile.role = 'owner_admin' then 0 else 1 end, profile.created_at
   limit 1;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', credential.id,
      'name', credential.name,
      'issuer', credential.issuer,
      'completedOn', credential.completed_on,
      'expiresOn', credential.expires_on,
      'credentialNumber', credential.credential_number,
      'required', credential.required,
      'ratioQualifying', credential.ratio_qualifying,
      'status', case
        when credential.required
          and (credential.completed_on is null or credential.document_id is null)
          then 'missing'
        when credential.expires_on is not null and credential.expires_on < v_today then 'expired'
        when credential.expires_on is not null and credential.expires_on <= v_today + 30 then 'expiring'
        else 'valid'
      end,
      'daysUntilExpiry', case when credential.expires_on is null then null
        else credential.expires_on - v_today end,
      'document', case when document.id is null then null else jsonb_build_object(
        'id', document.id,
        'title', document.title,
        'storagePath', document.storage_path,
        'mimeType', document.mime_type,
        'sizeBytes', document.size_bytes
      ) end,
      'latestSubmission', case when submission.id is null then null else jsonb_build_object(
        'id', submission.id,
        'status', submission.status,
        'issuer', submission.issuer,
        'completedOn', submission.completed_on,
        'expiresOn', submission.expires_on,
        'credentialNumber', submission.credential_number,
        'reviewNotes', submission.review_notes,
        'reviewedAt', submission.reviewed_at,
        'reviewerName', reviewer.full_name,
        'submittedAt', submission.created_at,
        'document', jsonb_build_object(
          'id', submission_document.id,
          'title', submission_document.title,
          'storagePath', submission_document.storage_path,
          'mimeType', submission_document.mime_type,
          'sizeBytes', submission_document.size_bytes
        )
      ) end
    ) order by
      case
        when submission.status = 'rejected' then 0
        when submission.status = 'pending' then 1
        when credential.required
          and (credential.completed_on is null or credential.document_id is null)
          then 2
        when credential.expires_on is not null and credential.expires_on < v_today then 3
        when credential.expires_on is not null and credential.expires_on <= v_today + 30 then 4
        else 5
      end,
      credential.name
  ), '[]'::jsonb)
    into v_credentials
    from public.staff_credentials credential
    left join public.documents document on document.id = credential.document_id
    left join lateral (
      select candidate.*
        from public.staff_credential_submissions candidate
       where candidate.credential_id = credential.id
       order by candidate.created_at desc
       limit 1
    ) submission on true
    left join public.documents submission_document on submission_document.id = submission.document_id
    left join public.profiles reviewer on reviewer.id = submission.reviewed_by
   where credential.staff_member_id = v_member.id
     and credential.archived_at is null;

  return jsonb_build_object(
    'staffMemberId', v_member.id,
    'reviewerName', coalesce(v_reviewer_name, 'your director'),
    'credentials', v_credentials
  );
end;
$$;

revoke all on function public.get_mobile_staff_credentials()
  from public, anon, authenticated;
grant execute on function public.get_mobile_staff_credentials()
  to authenticated;

notify pgrst, 'reload schema';
