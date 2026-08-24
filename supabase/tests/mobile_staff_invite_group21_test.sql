-- Group 21 staff invite acceptance security and workflow tests.
-- Self-contained and rollback-safe; no demo seed is required.
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
  v_owner uuid := '00000000-0000-4000-a000-000000000001';
  v_invitee uuid := '52110000-0000-4000-a000-000000000001';
  v_daycare uuid := '10000000-0000-4000-a000-000000000001';
  v_room uuid := '20000000-0000-4000-a000-000000000003';
  v_email text := 'group21.invitee@sunnygrove.test';
  v_code text;
  v_preview record;
  v_failed boolean := false;
begin
  if (
    select count(*)
      from pg_proc function
      join pg_namespace namespace on namespace.oid = function.pronamespace
     where namespace.nspname = 'public'
       and function.proname = 'invite_staff'
  ) <> 1 then
    raise exception 'FAIL: invite_staff still has ambiguous overloads';
  end if;
  raise notice 'PASS: invite_staff exposes one canonical RPC';

  perform pg_temp.impersonate('authenticated', v_owner);
  v_code := public.invite_staff(
    v_email,
    'educator',
    v_room,
    'Priya Test',
    'Lead educator',
    true
  );

  perform pg_temp.impersonate('anon');
  select * into v_preview from public.get_staff_invite(v_code);
  if v_preview.email <> v_email
     or v_preview.job_title <> 'Lead educator'
     or v_preview.require_background_check is not true
     or v_preview.classroom_name <> 'Preschool' then
    raise exception 'FAIL: anonymous preview omitted trusted invite details: %', row_to_json(v_preview);
  end if;
  raise notice 'PASS: bearer link previews only the complete pending assignment';

  begin
    perform public.accept_staff_invite(v_code, '2026-08-08', true);
  exception when insufficient_privilege then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: anonymous caller executed accept_staff_invite';
  end if;
  raise notice 'PASS: anonymous callers cannot accept staff invitations';

  perform pg_temp.impersonate('postgres');
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change, email_change_token_new, email_change_token_current
  ) values (
    '00000000-0000-0000-0000-000000000000',
    v_invitee,
    'authenticated',
    'authenticated',
    v_email,
    extensions.crypt('password123', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('full_name', 'Priya Test'),
    now(), now(), '', '', '', '', ''
  );

  v_failed := false;
  perform pg_temp.impersonate('authenticated', v_invitee);
  begin
    perform public.accept_staff_invite(v_code, '2026-08-08', false);
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: terms acceptance was optional';
  end if;
  raise notice 'PASS: acceptance requires the staff terms attestation';

  perform pg_temp.impersonate('authenticated', v_invitee);
  perform public.accept_staff_invite(v_code, '2026-08-08', true);

  perform pg_temp.impersonate('postgres');
  if not exists (
    select 1
      from public.profiles profile
      join public.center_roles center_role on center_role.id = profile.center_role_id
     where profile.id = v_invitee
       and profile.role = 'educator'
       and profile.daycare_id = v_daycare
       and profile.classroom_id = v_room
       and center_role.base_role = 'educator'
       and center_role.daycare_id = v_daycare
  ) then
    raise exception 'FAIL: profile assignment was not completed atomically';
  end if;
  if not exists (
    select 1 from public.staff_members member
     where member.daycare_id = v_daycare
       and member.profile_id = v_invitee
       and member.job_title = 'Lead educator'
       and member.status = 'active'
  ) then
    raise exception 'FAIL: active employment record was not created';
  end if;
  if not exists (
    select 1 from public.educator_classrooms assignment
     where assignment.educator_id = v_invitee
       and assignment.classroom_id = v_room
  ) then
    raise exception 'FAIL: classroom assignment was not created';
  end if;
  if not exists (
    select 1 from public.staff_invites invite
     where invite.code = v_code
       and invite.accepted_by = v_invitee
       and invite.accepted_at is not null
       and invite.accepted_terms_at is not null
       and invite.accepted_terms_version = '2026-08-08'
  ) then
    raise exception 'FAIL: invite consumption or terms audit was not recorded';
  end if;
  raise notice 'PASS: acceptance atomically creates profile, role, room, employment and audit records';

  v_failed := false;
  perform pg_temp.impersonate('authenticated', v_invitee);
  begin
    perform public.accept_staff_invite(v_code, '2026-08-08', true);
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: a consumed invitation was reusable';
  end if;
  raise notice 'PASS: staff invitations are single-use';
end;
$$;

rollback;
select 'MOBILE GROUP 21 TESTS: ALL PASSED' as result;
