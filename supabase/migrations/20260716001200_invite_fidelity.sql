-- ============================================================================
-- DailyLog — 4f fidelity: invites carry job title + background-check flag
-- ============================================================================
-- The design's "Lead educator" is role=educator with a lead job title, and
-- "Require background check first" is a real flag on the invite (enforcement
-- joins the scheduling feature; the flag is captured and surfaced now).

alter table staff_invites add column if not exists job_title text;
alter table staff_invites add column if not exists require_background_check boolean not null default false;

create or replace function invite_staff(
  p_email text,
  p_role text,
  p_classroom_id uuid default null,
  p_full_name text default null,
  p_job_title text default null,
  p_require_background_check boolean default false
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
                             full_name, job_title, require_background_check,
                             invited_by, expires_at)
  values (get_my_daycare_id(), lower(p_email), p_role, p_classroom_id, v_code,
          nullif(trim(p_full_name), ''), nullif(trim(p_job_title), ''),
          coalesce(p_require_background_check, false),
          auth.uid(), now() + interval '14 days');

  return v_code;
end;
$$;

-- Accepting now carries the job title onto the employment record.
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

  insert into staff_members (daycare_id, profile_id, job_title, status)
  values (v_invite.daycare_id, auth.uid(), v_invite.job_title, 'active')
  on conflict (daycare_id, profile_id)
    do update set status = 'active',
                  job_title = coalesce(excluded.job_title, staff_members.job_title);

  update staff_invites
     set accepted_at = now(), accepted_by = auth.uid()
   where id = v_invite.id;
end;
$$;
