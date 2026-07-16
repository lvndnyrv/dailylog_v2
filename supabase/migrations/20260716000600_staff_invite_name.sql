-- ============================================================================
-- DailyLog — Phase 1 Module D fix: staff invites carry the invitee's name
-- ============================================================================
-- 4f collects "Full name"; without it the accepted profile lands nameless in
-- the roster (handle_new_user takes full_name from signup metadata, and the
-- 10d accept flow signs up with the invite's details).

alter table staff_invites add column if not exists full_name text;

create or replace function invite_staff(
  p_email text,
  p_role text,
  p_classroom_id uuid default null,
  p_full_name text default null
)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if not is_admin() then
    raise exception 'Only admins can invite staff';
  end if;

  v_code := generate_invite_code();

  insert into staff_invites (daycare_id, email, role, classroom_id, code,
                             full_name, invited_by, expires_at)
  values (get_my_daycare_id(), lower(p_email), p_role, p_classroom_id, v_code,
          nullif(trim(p_full_name), ''), auth.uid(), now() + interval '14 days');

  return v_code;
end;
$$;

drop function if exists get_staff_invite(text);
create function get_staff_invite(p_code text)
returns table (
  email text,
  full_name text,
  role text,
  daycare_name text,
  classroom_name text,
  invited_by_name text,
  expires_at timestamptz
)
language sql security definer stable
set search_path = public
as $$
  select i.email, i.full_name, i.role, d.name,
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
