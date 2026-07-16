-- ============================================================================
-- DailyLog — Phase 1 Module A: invite acceptance + self-serve center start
-- ============================================================================
-- Screens 10d (accept invite) and 10e (start a center). Both flows need
-- security-definer RPCs: the invited user has no daycare yet (RLS gives them
-- nothing to read), and profile role/daycare changes are blocked by policy.
-- ============================================================================

-- Invite preview for the 10d card. Anon-callable by design: an invite link is
-- a bearer credential, so a valid unexpired code may reveal who invited you,
-- to which center, and for which role — nothing else, and only while valid.
create or replace function get_staff_invite(p_code text)
returns table (
  email text,
  role text,
  daycare_name text,
  classroom_name text,
  invited_by_name text,
  expires_at timestamptz
)
language sql security definer stable
set search_path = public
as $$
  select i.email, i.role, d.name,
         cl.name,
         p.full_name,
         i.expires_at
  from staff_invites i
  join daycares d on d.id = i.daycare_id
  left join classrooms cl on cl.id = i.classroom_id
  left join profiles p on p.id = i.invited_by
  where upper(i.code) = upper(p_code)
    and i.accepted_at is null
    and (i.expires_at is null or i.expires_at > now())
$$;

-- Called right after auth signup (or sign-in) by the invited user.
create or replace function accept_staff_invite(p_code text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_invite staff_invites%rowtype;
  v_my_email text;
begin
  select * into v_invite
  from staff_invites
  where upper(code) = upper(p_code)
    and accepted_at is null
    and (expires_at is null or expires_at > now());

  if v_invite.id is null then
    raise exception 'Invalid or expired invite';
  end if;

  select email into v_my_email from profiles where id = auth.uid();
  if lower(v_my_email) <> lower(v_invite.email) then
    raise exception 'This invite was sent to a different email address';
  end if;

  update profiles
     set role = v_invite.role,
         daycare_id = v_invite.daycare_id,
         classroom_id = coalesce(v_invite.classroom_id, classroom_id)
   where id = auth.uid();

  if v_invite.role = 'educator' and v_invite.classroom_id is not null then
    insert into educator_classrooms (educator_id, classroom_id)
    values (auth.uid(), v_invite.classroom_id)
    on conflict do nothing;
  end if;

  insert into staff_members (daycare_id, profile_id, status)
  values (v_invite.daycare_id, auth.uid(), 'active')
  on conflict (daycare_id, profile_id)
    do update set status = 'active';

  update staff_invites
     set accepted_at = now(), accepted_by = auth.uid()
   where id = v_invite.id;
end;
$$;

-- Self-serve owner signup (10e): creates the center and promotes the caller
-- to owner_admin. One center per creator — repeat calls return the existing id.
create or replace function start_center(p_center_name text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_daycare_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;

  select daycare_id into v_daycare_id from profiles where id = auth.uid();
  if v_daycare_id is not null then
    return v_daycare_id;
  end if;

  if p_center_name is null or length(trim(p_center_name)) < 2 then
    raise exception 'Center name is required';
  end if;

  insert into daycares (name, created_by)
  values (trim(p_center_name), auth.uid())
  returning id into v_daycare_id;

  update profiles
     set role = 'owner_admin', daycare_id = v_daycare_id
   where id = auth.uid();

  insert into staff_members (daycare_id, profile_id, job_title, status)
  values (v_daycare_id, auth.uid(), 'Director', 'active')
  on conflict (daycare_id, profile_id) do nothing;

  return v_daycare_id;
end;
$$;
