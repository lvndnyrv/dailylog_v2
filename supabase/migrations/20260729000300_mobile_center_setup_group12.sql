-- ============================================================================
-- DailyLog mobile group 12 — atomic owner center setup
-- ============================================================================
-- The registration wizard is intentionally staged on-device. Nothing is
-- written until its final step, then this function creates the center, owner
-- membership, classrooms, educator invites, and invite-email outbox rows in
-- one transaction.

create or replace function complete_center_setup(
  p_center_name text,
  p_address text,
  p_phone text,
  p_classrooms jsonb default '[]'::jsonb,
  p_educator_emails jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_daycare uuid;
  v_daycare_id uuid;
  v_owner_role_id uuid;
  v_room jsonb;
  v_room_name text;
  v_age_group text;
  v_email_value jsonb;
  v_email text;
  v_code text;
  v_classroom_count int := 0;
  v_invite_count int := 0;
begin
  if auth.uid() is null then
    raise exception 'Sign in before setting up a center';
  end if;

  select daycare_id
    into v_existing_daycare
    from profiles
   where id = auth.uid()
   for update;

  if not found then
    raise exception 'Your profile is not ready yet. Please sign in again';
  end if;

  -- A retried request after a network timeout must not duplicate the center.
  if v_existing_daycare is not null then
    return jsonb_build_object(
      'daycare_id', v_existing_daycare,
      'daycare_name', (
        select name from daycares where id = v_existing_daycare
      ),
      'classroom_count', (
        select count(*) from classrooms
         where daycare_id = v_existing_daycare and archived_at is null
      ),
      'invite_count', (
        select count(*) from staff_invites
         where daycare_id = v_existing_daycare and accepted_at is null
      ),
      'already_completed', true
    );
  end if;

  if nullif(btrim(p_center_name), '') is null
     or length(btrim(p_center_name)) < 2
     or length(btrim(p_center_name)) > 160 then
    raise exception 'Enter a valid center name';
  end if;
  if nullif(btrim(p_address), '') is null or length(btrim(p_address)) > 500 then
    raise exception 'Enter a valid center address';
  end if;
  if nullif(btrim(p_phone), '') is null
     or length(regexp_replace(p_phone, '[^0-9]', '', 'g')) < 7
     or length(btrim(p_phone)) > 40 then
    raise exception 'Enter a valid center phone number';
  end if;
  if jsonb_typeof(coalesce(p_classrooms, '[]'::jsonb)) <> 'array' then
    raise exception 'Classrooms must be a list';
  end if;
  if jsonb_typeof(coalesce(p_educator_emails, '[]'::jsonb)) <> 'array' then
    raise exception 'Educator emails must be a list';
  end if;
  if jsonb_array_length(coalesce(p_classrooms, '[]'::jsonb)) > 20 then
    raise exception 'Add no more than 20 classrooms during setup';
  end if;
  if jsonb_array_length(coalesce(p_educator_emails, '[]'::jsonb)) > 50 then
    raise exception 'Invite no more than 50 educators during setup';
  end if;

  insert into daycares (name, address, phone, created_by)
  values (
    btrim(p_center_name),
    btrim(p_address),
    btrim(p_phone),
    auth.uid()
  )
  returning id into v_daycare_id;

  -- The daycares insert trigger seeds the role library synchronously.
  select id
    into v_owner_role_id
    from center_roles
   where daycare_id = v_daycare_id
     and name = 'Owner admin'
   limit 1;

  update profiles
     set role = 'owner_admin',
         daycare_id = v_daycare_id,
         center_role_id = v_owner_role_id
   where id = auth.uid();

  insert into staff_members (
    daycare_id, profile_id, job_title, employment_type, status
  )
  values (
    v_daycare_id, auth.uid(), 'Director', 'full_time', 'active'
  )
  on conflict (daycare_id, profile_id)
  do update set status = 'active', job_title = 'Director';

  for v_room in
    select value
      from jsonb_array_elements(coalesce(p_classrooms, '[]'::jsonb))
  loop
    if jsonb_typeof(v_room) <> 'object' then
      raise exception 'Each classroom must be an object';
    end if;

    v_room_name := btrim(v_room ->> 'name');
    v_age_group := nullif(btrim(v_room ->> 'age_group'), '');

    if nullif(v_room_name, '') is null or length(v_room_name) > 120 then
      raise exception 'Every classroom needs a valid name';
    end if;
    if exists (
      select 1
        from classrooms
       where daycare_id = v_daycare_id
         and lower(name) = lower(v_room_name)
         and archived_at is null
    ) then
      raise exception 'Classroom names must be unique';
    end if;

    insert into classrooms (daycare_id, name, age_group)
    values (v_daycare_id, v_room_name, v_age_group);
    v_classroom_count := v_classroom_count + 1;
  end loop;

  for v_email_value in
    select value
      from jsonb_array_elements(coalesce(p_educator_emails, '[]'::jsonb))
  loop
    if jsonb_typeof(v_email_value) <> 'string' then
      raise exception 'Each educator email must be text';
    end if;

    v_email := lower(btrim(v_email_value #>> '{}'));
    if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
       or length(v_email) > 320 then
      raise exception 'Enter a valid educator email';
    end if;
    if exists (
      select 1
        from staff_invites
       where daycare_id = v_daycare_id
         and lower(email) = v_email
         and accepted_at is null
    ) then
      continue;
    end if;

    v_code := generate_invite_code();

    insert into staff_invites (
      daycare_id, email, role, code, invited_by, expires_at
    )
    values (
      v_daycare_id, v_email, 'educator', v_code, auth.uid(),
      now() + interval '14 days'
    );

    insert into notification_outbox (
      daycare_id, recipient_email, channel, kind, title, body, payload,
      dedupe_key
    )
    values (
      v_daycare_id,
      v_email,
      'email',
      'staff_invite',
      'You''re invited to DailyLog',
      'Your center invited you to join DailyLog. Open this invitation on your phone: '
        || 'dailylog://invite?code=' || v_code,
      jsonb_build_object(
        'type', 'staff_invite',
        'inviteLink', 'dailylog://invite?code=' || v_code
      ),
      'staff-invite:' || v_code
    );

    v_invite_count := v_invite_count + 1;
  end loop;

  return jsonb_build_object(
    'daycare_id', v_daycare_id,
    'daycare_name', btrim(p_center_name),
    'classroom_count', v_classroom_count,
    'invite_count', v_invite_count,
    'already_completed', false
  );
end;
$$;

revoke all on function complete_center_setup(text, text, text, jsonb, jsonb)
  from public, anon;
grant execute on function complete_center_setup(text, text, text, jsonb, jsonb)
  to authenticated;
