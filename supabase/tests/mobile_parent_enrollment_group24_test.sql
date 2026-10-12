-- Parent Group 24 security and complete workflow tests.
-- Self-contained and rollback-safe.
begin;

create or replace function pg_temp.impersonate(p_role text, p_user_id uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('role', p_role, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id, 'role', p_role)::text,
    true
  );
end;
$$;

do $$
declare
  v_enrollment constant uuid := '41000000-0000-4000-a000-000000000001';
  v_guardian constant uuid := '52240000-0000-4000-a000-000000000001';
  v_wrong_guardian constant uuid := '52240000-0000-4000-a000-000000000002';
  v_email constant text := 'group24.guardian@family.test';
  v_code constant text := 'GROUP24-ROLLBACK-TEST';
  v_offer jsonb;
  v_updated int;
  v_failed boolean := false;
  v_child uuid;
  v_payment uuid;
  v_count int;
begin
  perform pg_temp.impersonate('postgres');
  delete from public.notification_outbox outbox
  where outbox.dedupe_key in (
    select 'parent-enrollment-receipt:' || payment.id
    from public.enrollment_offer_payments payment
    where payment.enrollment_id = v_enrollment
  );
  delete from public.enrollment_offer_payments where enrollment_id = v_enrollment;
  delete from public.enrollment_application_documents where enrollment_id = v_enrollment;
  update public.enrollments
  set child_id = null,
      guardian_email = v_email,
      offer_code = v_code,
      offer_status = 'sent',
      offer_sent_at = now(),
      offer_viewed_at = null,
      offer_expires_at = now() + interval '2 days',
      offer_accepted_at = null,
      offer_declined_at = null,
      offer_decline_reason = null,
      parent_workflow_step = 'offer',
      application_submitted_at = null,
      agreement_signed_at = null,
      agreement_data = '{}'::jsonb,
      deposit_status = 'unpaid',
      deposit_paid_at = null,
      deposit_payment_id = null,
      payment_mode = 'demo',
      parent_account_linked_at = null,
      stage = 'offer',
      application_progress = 0
  where id = v_enrollment;

  perform pg_temp.impersonate('anon');
  update public.enrollments set notes = notes where id = v_enrollment;
  get diagnostics v_updated = row_count;
  if v_updated <> 0 then
    raise exception 'FAIL: anonymous caller directly updated an enrollment row';
  end if;
  raise notice 'PASS: direct anonymous enrollment mutations remain blocked';

  v_offer := public.get_parent_enrollment_offer(v_code);
  if v_offer->>'child_first_name' <> 'Mia'
     or v_offer->>'guardian_email' <> v_email
     or v_offer->>'offer_status' <> 'viewed' then
    raise exception 'FAIL: secure offer preview is incomplete: %', v_offer;
  end if;
  raise notice 'PASS: bearer offer returns only the family workflow payload';

  v_offer := public.review_parent_enrollment_offer(v_code);
  if v_offer->>'workflow_step' <> 'details' then
    raise exception 'FAIL: reviewing the offer did not persist resumable progress';
  end if;
  raise notice 'PASS: offer details resume after the app closes';

  v_failed := false;
  begin
    perform public.continue_parent_enrollment_documents(v_code);
  exception when others then
    v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL: documents were bypassed before offer acceptance'; end if;
  raise notice 'PASS: direct workflow jumps are rejected';

  perform public.decline_parent_enrollment_offer(v_code, 'Plans changed');
  v_offer := public.reopen_parent_enrollment_offer(v_code);
  if v_offer->>'offer_status' <> 'viewed' then
    raise exception 'FAIL: an eligible declined offer did not reopen';
  end if;
  raise notice 'PASS: decline reason and deadline-safe reopen work';

  v_offer := public.accept_parent_enrollment_offer(v_code);
  if v_offer->>'workflow_step' <> 'application' then
    raise exception 'FAIL: accepting did not begin the application';
  end if;

  v_failed := false;
  begin
    perform public.save_parent_enrollment_application(
      v_code,
      jsonb_build_object(
        'child_full_name', 'Mia Baker',
        'child_date_of_birth', (current_date + 1)::text,
        'allergies', '[]'::jsonb,
        'primary_guardian_name', 'Olivia Baker',
        'primary_guardian_email', 'attacker@example.test',
        'primary_guardian_phone', '555-0201',
        'emergency_contact_name', 'Noah Baker',
        'emergency_contact_phone', '555-0202'
      )
    );
  exception when others then
    v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL: invalid or mismatched family application data was accepted'; end if;
  raise notice 'PASS: guardian identity and child data are validated server-side';

  v_offer := public.save_parent_enrollment_application(
    v_code,
    jsonb_build_object(
      'child_full_name', 'Mia Baker',
      'child_date_of_birth', '2025-07-18',
      'allergies', jsonb_build_array('Egg'),
      'primary_guardian_name', 'Olivia Baker',
      'primary_guardian_email', v_email,
      'primary_guardian_phone', '555-0201',
      'co_guardian_name', 'Noah Baker',
      'co_guardian_email', 'noah.baker@family.test',
      'emergency_contact_name', 'Noah Baker',
      'emergency_contact_phone', '555-0202'
    )
  );
  if v_offer->>'workflow_step' <> 'documents' then
    raise exception 'FAIL: complete application did not advance';
  end if;
  raise notice 'PASS: child, guardian, co-guardian and emergency data persist';

  perform pg_temp.impersonate('postgres');
  insert into storage.objects (bucket_id, name, metadata)
  values (
    'documents',
    'enrollment-offers/' || v_code || '/immunization/group24-test.pdf',
    jsonb_build_object('mimetype', 'application/pdf', 'size', 128)
  );
  perform pg_temp.impersonate('anon');
  v_offer := public.save_parent_enrollment_document(
    v_code, 'immunization', 'Mia-immunization.pdf', 'application/pdf', 128,
    'enrollment-offers/' || v_code || '/immunization/group24-test.pdf'
  );
  if jsonb_array_length(v_offer->'documents') <> 1
     or v_offer->'documents'->0->>'kind' <> 'immunization' then
    raise exception 'FAIL: secure enrollment upload was not recorded: %', v_offer->'documents';
  end if;
  raise notice 'PASS: private document upload metadata is validated and persisted';

  perform public.continue_parent_enrollment_documents(v_code);
  v_failed := false;
  begin
    perform public.sign_parent_enrollment_agreement(
      v_code, 'Olivia Baker', true, false, true
    );
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: agreement allowed a missing required acknowledgement';
  end if;
  raise notice 'PASS: both distinct required agreement acknowledgements are enforced';

  v_offer := public.sign_parent_enrollment_agreement(
    v_code, 'Olivia Baker', true, true, true
  );
  if v_offer->>'workflow_step' <> 'deposit' then
    raise exception 'FAIL: signed agreement did not reach deposit';
  end if;

  v_offer := public.decline_parent_enrollment_offer(v_code, 'Timing changed');
  v_failed := false;
  begin
    perform public.complete_demo_parent_enrollment_deposit(v_code, false);
  exception when others then
    v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL: a declined offer was still payable'; end if;
  raise notice 'PASS: declined offers cannot be advanced or paid by direct RPC calls';

  perform public.reopen_parent_enrollment_offer(v_code);
  perform public.save_parent_enrollment_application(
    v_code,
    jsonb_build_object(
      'child_full_name', 'Mia Baker',
      'child_date_of_birth', '2025-07-18',
      'allergies', jsonb_build_array('Egg'),
      'primary_guardian_name', 'Olivia Baker',
      'primary_guardian_email', v_email,
      'primary_guardian_phone', '555-0201',
      'co_guardian_name', 'Noah Baker',
      'co_guardian_email', 'noah.baker@family.test',
      'emergency_contact_name', 'Noah Baker',
      'emergency_contact_phone', '555-0202'
    )
  );
  perform public.continue_parent_enrollment_documents(v_code);
  perform public.sign_parent_enrollment_agreement(v_code, 'Olivia Baker', true, true, true);

  v_offer := public.complete_demo_parent_enrollment_deposit(v_code, false);
  v_payment := (v_offer->'deposit_payment'->>'id')::uuid;
  if (public.complete_demo_parent_enrollment_deposit(v_code, false)->'deposit_payment'->>'id')::uuid <> v_payment then
    raise exception 'FAIL: retry created a different enrollment payment';
  end if;
  v_child := (v_offer->>'child_id')::uuid;
  perform pg_temp.impersonate('postgres');
  if v_offer->>'workflow_step' <> 'enrolled'
     or v_offer->>'deposit_status' <> 'paid'
     or v_offer->'deposit_payment'->>'email_status' <> 'pending'
     or v_offer->'deposit_payment'->>'receipt_number' is null
     or v_child is null
     or not exists (
       select 1 from public.enrollment_offer_payments
       where enrollment_id = v_enrollment and status = 'succeeded' and provider = 'demo'
     ) then
    raise exception 'FAIL: demo settlement did not atomically enroll: %', v_offer;
  end if;
  select count(*) into v_count from public.enrollment_offer_payments
  where enrollment_id = v_enrollment and status = 'succeeded';
  if v_count <> 1 then raise exception 'FAIL: payment retry was not idempotent'; end if;
  select count(*) into v_count from public.notification_outbox outbox
  where outbox.dedupe_key = 'parent-enrollment-receipt:' || v_payment
    and outbox.kind = 'parent_enrollment_receipt'
    and outbox.recipient_email = v_email
    and outbox.body like ('%dailylog://offer?code=' || v_code || '%');
  if v_count <> 1 then raise exception 'FAIL: enrollment receipt email was not queued exactly once'; end if;
  raise notice 'PASS: demo settlement is idempotent and queues a durable receipt';

  perform pg_temp.impersonate('anon');
  v_failed := false;
  begin
    insert into public.notification_outbox (
      daycare_id, recipient_email, channel, kind, title, payload, dedupe_key
    ) values (
      '10000000-0000-4000-a000-000000000001',
      'attacker@example.test', 'email', 'parent_enrollment_receipt', 'Forged receipt',
      jsonb_build_object('paymentId', v_payment, 'enrollmentId', v_enrollment),
      'forged-enrollment-receipt'
    );
  exception when others then
    v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL: anonymous caller forged an enrollment receipt'; end if;
  raise notice 'PASS: only the validated settlement can enqueue its matching receipt';

  perform pg_temp.impersonate('postgres');
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change, email_change_token_new, email_change_token_current
  ) values (
    '00000000-0000-0000-0000-000000000000',
    v_wrong_guardian, 'authenticated', 'authenticated', 'wrong.guardian@family.test',
    extensions.crypt('password123', extensions.gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}',
    jsonb_build_object('full_name', 'Wrong Guardian'),
    now(), now(), '', '', '', '', ''
  );
  perform pg_temp.impersonate('authenticated', v_wrong_guardian);
  v_failed := false;
  begin
    perform public.link_parent_enrollment_account(v_code);
  exception when others then
    v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL: a different email linked the enrolled child'; end if;
  raise notice 'PASS: account handoff remains bound to the offer email';

  perform pg_temp.impersonate('postgres');
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change, email_change_token_new, email_change_token_current
  ) values (
    '00000000-0000-0000-0000-000000000000',
    v_guardian, 'authenticated', 'authenticated', v_email,
    extensions.crypt('password123', extensions.gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}',
    jsonb_build_object('full_name', 'Olivia Baker', 'phone', '555-0201'),
    now(), now(), '', '', '', '', ''
  );

  perform pg_temp.impersonate('authenticated', v_guardian);
  v_offer := public.link_parent_enrollment_account(v_code);
  perform pg_temp.impersonate('postgres');
  if v_offer->>'account_linked' <> 'true'
     or not exists (
       select 1 from public.parent_children
       where parent_id = v_guardian and child_id = v_child and is_primary
     )
     or not exists (
       select 1 from public.family_members where profile_id = v_guardian
     ) then
    raise exception 'FAIL: account handoff did not create household access';
  end if;
  raise notice 'PASS: matching parent account links child and durable household access';
end;
$$;

rollback;
select 'MOBILE PARENT GROUP 24 TESTS: ALL PASSED' as result;
