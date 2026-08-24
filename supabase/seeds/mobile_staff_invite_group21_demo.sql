-- Group 21 demo invite. Open it in the mobile simulator with:
--   xcrun simctl openurl booted 'dailylog://invite?code=DLG21PRI'
-- Sign in/accept with password "password123". The .test account is deliberately
-- non-deliverable and safe for local/dev use.

do $$
declare
  v_user_id uuid := '52120000-0000-4000-a000-000000000001';
  v_email text := 'priya.invited@sunnygrove.test';
begin
  if not exists (select 1 from auth.users where id = v_user_id) then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token,
      email_change, email_change_token_new, email_change_token_current
    ) values (
      '00000000-0000-0000-0000-000000000000',
      v_user_id,
      'authenticated',
      'authenticated',
      v_email,
      extensions.crypt('password123', extensions.gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}',
      '{"full_name":"Priya Desai"}',
      now(), now(), '', '', '', '', ''
    );
  else
    update auth.users
       set encrypted_password = extensions.crypt('password123', extensions.gen_salt('bf')),
           email_confirmed_at = coalesce(email_confirmed_at, now()),
           raw_user_meta_data = '{"full_name":"Priya Desai"}',
           updated_at = now()
     where id = v_user_id;
  end if;

  if not exists (
    select 1 from auth.identities
     where user_id = v_user_id and provider = 'email'
  ) then
    insert into auth.identities (
      id, user_id, identity_data, provider, provider_id,
      last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(),
      v_user_id,
      jsonb_build_object('sub', v_user_id::text, 'email', v_email, 'email_verified', true),
      'email',
      v_user_id::text,
      now(), now(), now()
    );
  end if;

  delete from public.educator_classrooms where educator_id = v_user_id;
  delete from public.staff_members where profile_id = v_user_id;

  insert into public.profiles (id, email, full_name, role)
  values (v_user_id, v_email, 'Priya Desai', 'parent')
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    role = 'parent',
    daycare_id = null,
    classroom_id = null,
    center_role_id = null,
    phone = '';
end;
$$;

delete from public.staff_invites
 where id = '52100000-0000-4000-a000-000000000001'
    or code = 'DLG21PRI';

insert into public.staff_invites (
  id,
  daycare_id,
  email,
  role,
  classroom_id,
  code,
  full_name,
  job_title,
  require_background_check,
  invited_by,
  expires_at,
  created_at
) values (
  '52100000-0000-4000-a000-000000000001',
  '10000000-0000-4000-a000-000000000001',
  'priya.invited@sunnygrove.test',
  'educator',
  '20000000-0000-4000-a000-000000000003',
  'DLG21PRI',
  'Priya Desai',
  'Lead educator',
  true,
  '00000000-0000-4000-a000-000000000001',
  now() + interval '7 days',
  now()
);
