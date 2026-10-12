-- Group 21 design fidelity: staff invitation links remain valid for seven days.
create or replace function public.invite_staff(
  p_email text,
  p_role text,
  p_classroom_id uuid default null,
  p_full_name text default null,
  p_job_title text default null,
  p_require_background_check boolean default false
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_daycare_id uuid;
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;
  if not has_permission('staff', 'edit') then
    raise exception 'Staff edit permission required';
  end if;

  v_daycare_id := get_my_daycare_id();
  if v_daycare_id is null then
    raise exception 'Your account is not attached to a center';
  end if;
  if v_email = '' or position('@' in v_email) < 2 then
    raise exception 'Enter a valid email address';
  end if;
  if p_role not in ('owner_admin', 'admin', 'educator') then
    raise exception 'Invalid staff role';
  end if;
  if p_classroom_id is not null and not exists (
    select 1
      from public.classrooms classroom
     where classroom.id = p_classroom_id
       and classroom.daycare_id = v_daycare_id
       and classroom.archived_at is null
  ) then
    raise exception 'The selected room does not belong to this center';
  end if;
  if exists (
    select 1
      from public.profiles profile
     where lower(profile.email) = v_email
       and profile.daycare_id is not null
       and profile.daycare_id <> v_daycare_id
  ) then
    raise exception 'This account already belongs to another center';
  end if;

  update public.staff_invites invite
     set expires_at = least(coalesce(invite.expires_at, now()), now())
   where invite.daycare_id = v_daycare_id
     and lower(invite.email) = v_email
     and invite.accepted_at is null
     and (invite.expires_at is null or invite.expires_at > now());

  v_code := public.generate_invite_code();

  insert into public.staff_invites (
    daycare_id,
    email,
    role,
    classroom_id,
    code,
    full_name,
    job_title,
    require_background_check,
    invited_by,
    expires_at
  ) values (
    v_daycare_id,
    v_email,
    p_role,
    case when p_role = 'educator' then p_classroom_id else null end,
    v_code,
    nullif(btrim(p_full_name), ''),
    nullif(btrim(p_job_title), ''),
    coalesce(p_require_background_check, false),
    auth.uid(),
    now() + interval '7 days'
  );

  return v_code;
end;
$$;

revoke all on function public.invite_staff(text, text, uuid, text, text, boolean)
  from public, anon;
grant execute on function public.invite_staff(text, text, uuid, text, text, boolean)
  to authenticated, service_role;
