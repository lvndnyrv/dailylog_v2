-- Rollback-safe educator credential renewal -> director review -> educator
-- correction/approval handoff. No document bytes are copied.
begin;

create or replace function pg_temp.impersonate(p_role text, p_user uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', p_user,
      'role', case when p_role = 'postgres' then 'service_role' else p_role end
    )::text,
    true
  );
  perform set_config('role', p_role, true);
end $$;

do $$
declare
  v_owner uuid := '00000000-0000-4000-a000-000000000001';
  v_educator uuid := '00000000-0000-4000-a000-000000000003';
  v_restricted uuid := '00000000-0000-4000-a000-000000000008';
  v_credential uuid := '62400000-0000-4000-a000-000000000005';
  v_daycare uuid;
  v_staff_member uuid;
  v_role uuid;
  v_submission uuid;
  v_resubmission uuid;
  v_today date;
  v_hub jsonb;
  v_path text;
  v_second_path text;
begin
  perform pg_temp.impersonate('postgres');
  select member.daycare_id, member.id,
         (now() at time zone coalesce(daycare.timezone, 'UTC'))::date
    into v_daycare, v_staff_member, v_today
    from public.staff_members member
    join public.daycares daycare on daycare.id = member.daycare_id
   where member.profile_id = v_educator
     and member.status = 'active'
     and member.archived_at is null;
  if v_staff_member is null then raise exception 'Missing active educator fixture'; end if;

  insert into public.center_roles (daycare_id, name, base_role, permissions)
  values (
    v_daycare,
    'Rollback-only no credential approval',
    'admin',
    '{"staff":{"view":true,"edit":false,"approve":false}}'
  ) returning id into v_role;
  update public.profiles
     set role = 'admin', center_role_id = v_role, archived_at = null
   where id = v_restricted;

  -- Isolate the credential from long-lived demo submissions.
  update public.staff_credential_submissions
     set status = case when status = 'pending' then 'withdrawn' else status end
   where credential_id = v_credential;

  v_path := 'staff-credentials/' || v_daycare || '/' || v_educator ||
    '/handoff/' || gen_random_uuid() || '-renewal.pdf';
  insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
  values (
    'documents', v_path, v_educator, v_educator::text,
    jsonb_build_object('mimetype', 'application/pdf', 'size', 256)
  );

  perform pg_temp.impersonate('authenticated', v_educator);
  v_submission := public.submit_mobile_credential_renewal(
    v_credential,
    'Ontario Safety Institute',
    v_today,
    v_today + 730,
    'HANDOFF-001',
    v_path,
    'renewal.pdf',
    'application/pdf',
    256
  );

  perform pg_temp.impersonate('postgres');
  if not exists (
    select 1 from public.notifications notification
     where notification.profile_id = v_owner
       and notification.kind = 'credential_review'
       and notification.payload ->> 'submissionId' = v_submission::text
       and notification.payload ->> 'href' = '/staff/' || v_staff_member::text
  ) then
    raise exception 'FAIL: reviewer did not receive a routable credential alert';
  end if;
  if exists (
    select 1 from public.notifications notification
     where notification.profile_id = v_restricted
       and notification.kind = 'credential_review'
       and notification.payload ->> 'submissionId' = v_submission::text
  ) then
    raise exception 'FAIL: restricted admin received an unusable review alert';
  end if;

  perform pg_temp.impersonate('authenticated', v_owner);
  perform public.review_staff_credential_submission(
    v_submission,
    'rejected',
    'The certificate number is cut off. Upload the complete page.'
  );

  perform pg_temp.impersonate('authenticated', v_educator);
  v_hub := public.get_mobile_staff_credentials();
  if not exists (
    select 1 from jsonb_array_elements(v_hub -> 'credentials') credential
     where credential ->> 'id' = v_credential::text
       and credential #>> '{latestSubmission,status}' = 'rejected'
       and credential #>> '{latestSubmission,reviewNotes}' like
         'The certificate number is cut off%'
  ) then
    raise exception 'FAIL: educator cannot see the requested correction';
  end if;
  if not exists (
    select 1 from public.notifications notification
     where notification.profile_id = v_educator
       and notification.kind = 'credential'
       and notification.payload ->> 'screen' = 'CredentialDetail'
       and notification.payload ->> 'status' = 'rejected'
       and notification.payload ->> 'submissionId' = v_submission::text
  ) then
    raise exception 'FAIL: rejection did not deep-link the educator to the correction';
  end if;

  perform pg_temp.impersonate('postgres');
  update public.staff_credential_submissions
     set created_at = created_at - interval '1 minute'
   where id = v_submission;
  v_second_path := 'staff-credentials/' || v_daycare || '/' || v_educator ||
    '/handoff/' || gen_random_uuid() || '-corrected.pdf';
  insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
  values (
    'documents', v_second_path, v_educator, v_educator::text,
    jsonb_build_object('mimetype', 'application/pdf', 'size', 300)
  );

  perform pg_temp.impersonate('authenticated', v_educator);
  v_resubmission := public.submit_mobile_credential_renewal(
    v_credential,
    'Ontario Safety Institute',
    v_today,
    v_today + 730,
    'HANDOFF-002',
    v_second_path,
    'corrected-renewal.pdf',
    'application/pdf',
    300
  );

  perform pg_temp.impersonate('authenticated', v_owner);
  perform public.review_staff_credential_submission(
    v_resubmission,
    'approved',
    'Complete certificate verified.'
  );

  perform pg_temp.impersonate('postgres');
  if not exists (
    select 1 from public.staff_credentials credential
     where credential.id = v_credential
       and credential.issuer = 'Ontario Safety Institute'
       and credential.expires_on = v_today + 730
       and credential.credential_number = 'HANDOFF-002'
  ) then
    raise exception 'FAIL: approval did not promote the corrected renewal';
  end if;
  if not exists (
    select 1 from public.notification_outbox outbox
     where outbox.recipient_id = v_educator
       and outbox.kind = 'credential'
       and outbox.payload ->> 'status' = 'approved'
       and outbox.payload ->> 'submissionId' = v_resubmission::text
  ) then
    raise exception 'FAIL: approval did not queue the educator decision push';
  end if;
end $$;

rollback;
select 'PASS: educator renewal, permission-aware admin alert, correction, resubmission, approval and educator decision notification' as result;
