-- Group 24 credential workflow security and state tests.
-- Requires mobile_credentials_group24_demo.sql.
-- The nested block deliberately raises and catches a private SQLSTATE after
-- the assertions pass. PostgreSQL rolls back that subtransaction, so this
-- remains a single prepared statement and never mutates the demo records.
do $group24$
declare
  v_owner uuid := '00000000-0000-4000-a000-000000000001';
  v_maria uuid := '00000000-0000-4000-a000-000000000003';
  v_other_educator uuid := '00000000-0000-4000-a000-000000000004';
  v_food uuid := '62400000-0000-4000-a000-000000000005';
  v_pending uuid := '62420000-0000-4000-a000-000000000002';
  v_hub jsonb;
  v_failed boolean := false;
  v_updated integer;
begin
  begin
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_maria, 'role', 'authenticated')::text,
    true
  );
  v_hub := public.get_mobile_staff_credentials();
  if jsonb_array_length(v_hub -> 'credentials') < 5 then
    raise exception 'FAIL: credential hub is missing seeded rows: %', v_hub;
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_hub -> 'credentials') row
     where row ->> 'id' = '62400000-0000-4000-a000-000000000001'
       and row ->> 'status' = 'expiring'
       and (row ->> 'daysUntilExpiry')::integer = 12
  ) then
    raise exception 'FAIL: expiry warning is not calculated from center time';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_hub -> 'credentials') row
     where row ->> 'id' = '62400000-0000-4000-a000-000000000004'
       and row #>> '{latestSubmission,status}' = 'rejected'
       and nullif(row #>> '{latestSubmission,reviewNotes}', '') is not null
  ) then
    raise exception 'FAIL: rejected renewal did not include its correction note';
  end if;
  raise notice 'PASS: educator hub returns valid, expiring, missing, pending and rejected states';

  -- There is intentionally no direct update policy for educator submissions.
  update public.staff_credential_submissions
     set status = 'approved'
   where id = v_pending;
  get diagnostics v_updated = row_count;
  if v_updated <> 0 then
    raise exception 'FAIL: educator directly approved their own renewal';
  end if;
  raise notice 'PASS: educator cannot directly review a renewal';

  begin
    perform public.review_staff_credential_submission(v_pending, 'approved', null);
  exception when others then
    v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL: educator called the admin review RPC'; end if;
  raise notice 'PASS: review RPC requires staff approval permission';

  v_failed := false;
  perform set_config('role', 'postgres', true);
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_other_educator, 'role', 'authenticated')::text,
    true
  );
  begin
    perform public.withdraw_mobile_credential_submission(v_pending);
  exception when others then
    v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL: unrelated educator withdrew Maria''s renewal'; end if;
  v_hub := public.get_mobile_staff_credentials();
  if v_hub::text like '%62400000-0000-4000-a000-000000000005%' then
    raise exception 'FAIL: unrelated educator saw Maria''s credential';
  end if;
  raise notice 'PASS: educator reads and mutations are owner-scoped';

  perform set_config('role', 'postgres', true);
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text,
    true
  );
  perform public.review_staff_credential_submission(
    v_pending,
    'approved',
    'Document and expiry date verified.'
  );

  perform set_config('role', 'postgres', true);
  if not exists (
    select 1 from public.staff_credentials credential
     where credential.id = v_food
       and credential.expires_on = public.center_today() + 1095
       and credential.document_id = '62410000-0000-4000-a000-000000000002'
  ) then
    raise exception 'FAIL: approval did not promote renewal details to the credential';
  end if;
  if not exists (
    select 1 from public.staff_members member
     where member.profile_id = v_maria
       and member.certifications @> jsonb_build_array(
         jsonb_build_object('item', 'Food Handler Certificate')
       )
  ) then
    raise exception 'FAIL: legacy admin certification register was not synchronized';
  end if;
  if not exists (
    select 1 from public.notifications notification
     where notification.profile_id = v_maria
       and notification.kind = 'credential'
       and notification.payload ->> 'credentialId' = v_food::text
       and notification.payload ->> 'screen' = 'CredentialDetail'
  ) then
    raise exception 'FAIL: approval did not create a deep-linked in-app notification';
  end if;
  if not exists (
    select 1 from public.notification_outbox outbox
     where outbox.recipient_id = v_maria
       and outbox.kind = 'credential'
       and outbox.payload ->> 'credentialId' = v_food::text
  ) then
    raise exception 'FAIL: approval did not queue an educator push notification';
  end if;
  raise notice 'PASS: director approval promotes the renewal, syncs admin data and notifies the educator';

  update public.staff_credentials
     set expires_on = public.center_today() + 14
   where id = '62400000-0000-4000-a000-000000000001';
  perform set_config('role', 'service_role', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('role', 'service_role')::text,
    true
  );
  perform public.enqueue_staff_credential_expiry_reminders();
  perform set_config('role', 'postgres', true);
  if not exists (
    select 1 from public.notification_outbox outbox
     where outbox.recipient_id = v_maria
       and outbox.kind = 'cert_expiry'
       and outbox.payload ->> 'screen' = 'CredentialRenewal'
       and outbox.payload ->> 'credentialId' = '62400000-0000-4000-a000-000000000001'
  ) then
    raise exception 'FAIL: due expiry reminder did not deep-link to the renewal screen';
  end if;
  raise notice 'PASS: scheduled expiry reminder queues the educator deep link';
  raise exception using
    errcode = 'G2400',
    message = 'rollback successful Group 24 test mutations';
  exception when sqlstate 'G2400' then
    raise notice 'MOBILE GROUP 24 TESTS: ALL PASSED';
  end;
end;
$group24$;
