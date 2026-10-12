-- Parent Group 24 completion regression tests. Rollback-safe.
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
  v_guardian constant uuid := '52240000-0000-4000-a000-000000000024';
  v_code constant text := 'GROUP24-COMPLETION-TEST';
  v_email constant text := 'group24.completion@family.test';
  v_offer jsonb;
  v_child uuid;
  v_first_path text := 'enrollment-offers/GROUP24-COMPLETION-TEST/immunization/first.pdf';
  v_second_path text := 'enrollment-offers/GROUP24-COMPLETION-TEST/immunization/second.pdf';
  v_failed boolean;
  v_cleanup_allowed boolean;
  v_count int;
begin
  perform pg_temp.impersonate('postgres');
  delete from public.enrollment_agreement_signatures where enrollment_id = v_enrollment;
  delete from public.enrollment_application_documents where enrollment_id = v_enrollment;
  delete from public.enrollment_offer_payments where enrollment_id = v_enrollment;
  update public.enrollments
  set child_id = null,
      guardian_email = v_email,
      guardian_name = 'Olivia Baker',
      guardian_phone = '416-555-0201',
      offer_code = v_code,
      offer_status = 'sent',
      offer_sent_at = now(),
      offer_expires_at = now() + interval '2 days',
      offer_accepted_at = null,
      parent_workflow_step = 'offer',
      application_submitted_at = null,
      agreement_signed_at = null,
      agreement_data = '{}'::jsonb,
      deposit_status = 'unpaid',
      deposit_payment_id = null,
      payment_mode = 'demo',
      parent_account_linked_at = null,
      stage = 'offer'
  where id = v_enrollment;

  perform pg_temp.impersonate('anon');
  perform public.accept_parent_enrollment_offer(v_code);
  v_failed := false;
  begin
    perform public.save_parent_enrollment_application(
      v_code,
      jsonb_build_object(
        'child_full_name', 'Mia Baker',
        'child_date_of_birth', '2025-07-18',
        'allergies', jsonb_build_array('Egg'),
        'primary_guardian_name', 'Olivia Baker',
        'primary_guardian_email', v_email,
        'primary_guardian_phone', '12',
        'emergency_contact_name', 'Ava Baker',
        'emergency_contact_phone', 'not-a-phone'
      )
    );
  exception when others then
    v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL: malformed phone numbers were accepted'; end if;
  raise notice 'PASS: family contact numbers are validated server-side';

  v_offer := public.save_parent_enrollment_application(
    v_code,
    jsonb_build_object(
      'child_full_name', 'Mia Baker',
      'child_date_of_birth', '2025-07-18',
      'allergies', jsonb_build_array('Egg'),
      'primary_guardian_name', 'Olivia Baker',
      'primary_guardian_email', v_email,
      'primary_guardian_phone', '416-555-0201',
      'co_guardian_name', 'Noah Baker',
      'co_guardian_email', 'noah.group24@family.test',
      'emergency_contact_name', 'Ava Baker',
      'emergency_contact_phone', '416-555-0202'
    )
  );

  perform pg_temp.impersonate('postgres');
  insert into storage.objects (bucket_id, name, metadata) values
    ('documents', v_first_path, jsonb_build_object('mimetype', 'application/pdf', 'size', 100)),
    ('documents', v_second_path, jsonb_build_object('mimetype', 'application/pdf', 'size', 120));
  perform pg_temp.impersonate('anon');
  perform public.save_parent_enrollment_document(
    v_code, 'immunization', 'first.pdf', 'application/pdf', 100, v_first_path
  );
  v_offer := public.save_parent_enrollment_document(
    v_code, 'immunization', 'second.pdf', 'application/pdf', 120, v_second_path
  );
  if v_offer->>'replaced_storage_path' <> v_first_path then
    raise exception 'FAIL: replacement did not expose only the unreferenced private object for Storage cleanup';
  end if;
  v_failed := false;
  begin
    perform public.can_delete_parent_enrollment_upload(v_first_path);
  exception when insufficient_privilege then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: anonymous caller could invoke the private cleanup predicate';
  end if;
  perform pg_temp.impersonate('service_role');
  select public.can_delete_parent_enrollment_upload(v_first_path)
    and not public.can_delete_parent_enrollment_upload(v_second_path)
  into v_cleanup_allowed;
  if not v_cleanup_allowed then
    raise exception 'FAIL: cleanup worker could not distinguish the replaced private object';
  end if;
  raise notice 'PASS: document replacement permits Storage cleanup only for the previous object';

  perform pg_temp.impersonate('anon');
  perform public.continue_parent_enrollment_documents(v_code);
  perform public.sign_parent_enrollment_agreement(v_code, 'Olivia Baker', true, true, false);
  perform public.sign_parent_enrollment_agreement(v_code, 'Olivia Baker', true, true, true);
  perform pg_temp.impersonate('postgres');
  select count(*) into v_count
  from public.enrollment_agreement_signatures
  where enrollment_id = v_enrollment;
  if v_count <> 2 or not exists (
    select 1 from public.enrollments
    where id = v_enrollment
      and agreement_data->>'signature_id' is not null
      and agreement_data->'terms_snapshot'->>'tuition_cents' is not null
  ) then
    raise exception 'FAIL: signed agreement snapshots were not preserved';
  end if;
  raise notice 'PASS: every signature creates a durable terms snapshot';

  perform pg_temp.impersonate('anon');
  v_offer := public.complete_demo_parent_enrollment_deposit(v_code, false);
  v_child := (v_offer->>'child_id')::uuid;

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
    jsonb_build_object('full_name', 'Olivia Baker'),
    now(), now(), '', '', '', '', ''
  );

  perform pg_temp.impersonate('authenticated', v_guardian);
  v_offer := public.link_parent_enrollment_account(v_code);
  perform pg_temp.impersonate('anon');
  v_failed := false;
  begin
    perform public.get_parent_enrollment_offer(v_code);
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: linked enrollment remained readable through its anonymous bearer link';
  end if;
  perform pg_temp.impersonate('authenticated', v_guardian);
  perform public.get_parent_enrollment_offer(v_code);
  perform pg_temp.impersonate('postgres');
  if v_offer->'co_guardian_invite'->>'email' <> 'noah.group24@family.test'
     or not exists (
       select 1 from public.child_invite_codes invite
       where invite.child_id = v_child
         and invite.created_by = v_guardian
         and invite.email = 'noah.group24@family.test'
         and invite.used_at is null
     ) then
    raise exception 'FAIL: the co-guardian application entry was not handed off';
  end if;
  raise notice 'PASS: account linking prepares the co-guardian invitation exactly once';
  raise notice 'PASS: consumed offer links require the linked family account';
end;
$$;

rollback;
select 'MOBILE PARENT GROUP 24 COMPLETION TESTS: ALL PASSED' as result;
