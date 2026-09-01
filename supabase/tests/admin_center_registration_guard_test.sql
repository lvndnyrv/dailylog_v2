-- Platform-issued owner registration guard tests.
-- Verifies email binding, invalid-code rejection, one-time consumption and
-- atomic center/role/classroom creation. All fixture data is rolled back.
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
  v_user uuid := 'c47e0000-0000-4000-a000-000000000001';
  v_email text := 'registration.guard@dailylog.test';
  v_code text;
  v_center_name text;
  v_result jsonb;
  v_failed boolean := false;
  v_daycare uuid;
  v_count integer;
begin
  perform pg_temp.impersonate('postgres');
  select issued.registration_code
    into v_code
    from public.issue_center_registration_code(
      'Registration Guard Test Center',
      v_email,
      now() + interval '1 day'
    ) issued;

  perform pg_temp.impersonate('anon');
  select preview.center_name
    into v_center_name
    from public.check_center_registration_code(v_code, 'wrong-email@dailylog.test') preview;
  if v_center_name is not null then
    raise exception 'FAIL: registration code preview ignored its email binding';
  end if;

  select preview.center_name
    into v_center_name
    from public.check_center_registration_code(v_code, v_email) preview;
  if v_center_name <> 'Registration Guard Test Center' then
    raise exception 'FAIL: valid registration code did not preview its approved center';
  end if;
  raise notice 'PASS: registration preview is email-bound and reveals no mismatched center';

  perform pg_temp.impersonate('postgres');
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change, email_change_token_new, email_change_token_current
  ) values (
    '00000000-0000-0000-0000-000000000000',
    v_user,
    'authenticated',
    'authenticated',
    v_email,
    extensions.crypt('temporary-registration-test', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Registration Guard"}',
    now(), now(), '', '', '', '', ''
  );

  perform pg_temp.impersonate('authenticated', v_user);
  begin
    perform public.complete_center_setup(
      'Registration Guard Test Center',
      '100 Test Street',
      '416-555-0100',
      '[{"name":"Infant","age_group":"Infant"}]'::jsonb,
      '[]'::jsonb,
      'DL-INVALID-CODE'
    );
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: a random signup completed owner center setup';
  end if;
  raise notice 'PASS: random signups cannot create a daycare owner account';

  v_result := public.complete_center_setup(
    'Registration Guard Test Center',
    '100 Test Street',
    '416-555-0100',
    '[{"name":"Infant","age_group":"Infant"}]'::jsonb,
    '[]'::jsonb,
    v_code
  );
  v_daycare := (v_result ->> 'daycare_id')::uuid;

  perform pg_temp.impersonate('postgres');
  select count(*) into v_count
    from public.profiles profile
    join public.center_roles role on role.id = profile.center_role_id
    join public.staff_members member
      on member.profile_id = profile.id
     and member.daycare_id = profile.daycare_id
   where profile.id = v_user
     and profile.daycare_id = v_daycare
     and profile.role = 'owner_admin'
     and role.name = 'Owner admin'
     and member.status = 'active';
  if v_count <> 1 then
    raise exception 'FAIL: approved setup omitted owner role or employment linkage';
  end if;

  select count(*) into v_count
    from public.classrooms
   where daycare_id = v_daycare
     and name = 'Infant';
  if v_count <> 1 then
    raise exception 'FAIL: approved setup did not create its classroom atomically';
  end if;

  select count(*) into v_count
    from public.center_registration_codes code
   where code.daycare_id = v_daycare
     and code.consumed_by = v_user
     and code.consumed_at is not null;
  if v_count <> 1 then
    raise exception 'FAIL: registration code was not consumed with its owner and center';
  end if;
  raise notice 'PASS: approved setup atomically creates center, owner authority and classroom';

  perform pg_temp.impersonate('anon');
  select preview.center_name
    into v_center_name
    from public.check_center_registration_code(v_code, v_email) preview;
  if v_center_name is not null then
    raise exception 'FAIL: consumed registration code remained previewable';
  end if;
  raise notice 'PASS: center registration codes are single-use';
end;
$$;

rollback;
select 'ADMIN CENTER REGISTRATION GUARD TESTS: ALL PASSED' as result;
