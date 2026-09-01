-- Parent Mobile Group 14 enrollment-handoff consent regression test.
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
  v_child constant uuid := '30000000-0000-4000-a000-000000000013';
  v_parent constant uuid := '52140000-0000-4000-a000-000000000014';
  v_email constant text := 'group14.enrollment@family.test';
  v_code constant text := 'GROUP14-CONSENT-GATE';
begin
  if not exists (
    select 1
      from pg_publication_tables publication_table
     where publication_table.pubname = 'supabase_realtime'
       and publication_table.schemaname = 'public'
       and publication_table.tablename = 'parent_children'
  ) then
    raise exception 'FAIL: parent family changes are not published to Realtime';
  end if;
  raise notice 'PASS: parent family changes are published to Realtime';

  perform pg_temp.impersonate('postgres');
  update public.enrollments
     set guardian_email = v_email,
         offer_code = v_code,
         stage = 'enrolled',
         offer_status = 'accepted',
         deposit_status = 'paid',
         child_id = v_child,
         parent_account_linked_at = null,
         application_data = '{}'::jsonb,
         onboarding_steps = '{}'::jsonb
   where id = v_enrollment;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change, email_change_token_new, email_change_token_current
  ) values (
    '00000000-0000-0000-0000-000000000000',
    v_parent, 'authenticated', 'authenticated', v_email,
    extensions.crypt('password123', extensions.gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}',
    jsonb_build_object('full_name', 'Group 14 Parent'),
    now(), now(), '', '', '', '', ''
  );

  perform pg_temp.impersonate('authenticated', v_parent);
  perform public.link_parent_enrollment_account(v_code);

  perform pg_temp.impersonate('postgres');
  if not exists (
    select 1
      from public.parent_children link
     where link.parent_id = v_parent
       and link.child_id = v_child
       and link.consent_given_at is null
       and link.consent_declined_at is null
  ) then
    raise exception 'FAIL: enrollment handoff silently granted or declined consent';
  end if;
  raise notice 'PASS: enrollment links the child while leaving care-data consent pending';

  perform pg_temp.impersonate('authenticated', v_parent);
  perform public.set_parent_care_data_consent(v_child, true, 'group14-enrollment-test');

  perform pg_temp.impersonate('postgres');
  if not exists (
    select 1
      from public.parent_children link
     where link.parent_id = v_parent
       and link.child_id = v_child
       and link.consent_given_at is not null
       and link.consent_declined_at is null
       and link.consent_version = 'group14-enrollment-test'
  ) then
    raise exception 'FAIL: the enrollment parent could not complete the audited consent gate';
  end if;
  raise notice 'PASS: the linked parent can complete the audited consent gate';
end;
$$;

rollback;
select 'MOBILE PARENT GROUP 14 ENROLLMENT CONSENT TESTS: ALL PASSED' as result;
