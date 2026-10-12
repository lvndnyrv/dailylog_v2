-- Admin Group 12c completion: a background-check requirement on an invite
-- survives acceptance and is enforced by the live room-ratio engine. Until a
-- verified original is on file, the educator may work only as additional
-- supervised staff and is not counted toward licensing coverage.

alter table public.staff_members
  add column if not exists background_check_required boolean not null default false;

create or replace function public.staff_is_ratio_eligible(p_staff_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select
      not member.background_check_required
      or exists (
        select 1
          from public.staff_credentials credential
         where credential.staff_member_id = member.id
           and credential.archived_at is null
           and credential.required
           and lower(credential.name) ~ '(background|criminal record|vulnerable sector)'
           and credential.completed_on is not null
           and credential.document_id is not null
           and (
             credential.expires_on is null
             or credential.expires_on >= (now() at time zone coalesce(center.timezone, 'UTC'))::date
           )
      )
    from public.staff_members member
    join public.daycares center on center.id = member.daycare_id
   where member.id = p_staff_member_id
     and member.status = 'active'
     and member.archived_at is null
  ), false);
$$;

revoke all on function public.staff_is_ratio_eligible(uuid)
  from public, anon, authenticated, service_role;

-- Preserve the requirement for invitations accepted before this migration.
update public.staff_members member
   set background_check_required = true
 where exists (
   select 1
     from public.staff_invites invite
    where invite.daycare_id = member.daycare_id
      and invite.accepted_by = member.profile_id
      and invite.require_background_check
 );

insert into public.staff_credentials (
  daycare_id, staff_member_id, name, required, ratio_qualifying
)
select member.daycare_id, member.id, 'Background check', true, false
  from public.staff_members member
 where member.background_check_required
   and member.archived_at is null
   and not exists (
     select 1
       from public.staff_credentials credential
      where credential.staff_member_id = member.id
        and credential.archived_at is null
        and lower(credential.name) ~ '(background|criminal record|vulnerable sector)'
   )
on conflict do nothing;

create or replace function public.protect_required_background_clearance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_required boolean;
begin
  select background_check_required into v_required
    from public.staff_members
   where id = old.staff_member_id;

  if coalesce(v_required, false)
     and lower(old.name) ~ '(background|criminal record|vulnerable sector)' then
    if tg_op = 'DELETE' then
      raise exception 'This background check is required by the educator invite and cannot be removed';
    end if;
    if new.archived_at is not null
       or not new.required
       or lower(new.name) !~ '(background|criminal record|vulnerable sector)' then
      raise exception 'This background check is required by the educator invite and cannot be removed';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.protect_required_background_clearance()
  from public, anon, authenticated, service_role;

drop trigger if exists protect_required_background_clearance on public.staff_credentials;
create trigger protect_required_background_clearance
  before update or delete on public.staff_credentials
  for each row execute function public.protect_required_background_clearance();

-- Latest invitation acceptance, including role-library assignment and the
-- compliance requirement handoff.
create or replace function public.accept_staff_invite(p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.staff_invites%rowtype;
  v_my_email text;
  v_role_id uuid;
  v_staff_member_id uuid;
begin
  select * into v_invite
    from public.staff_invites
   where upper(code) = upper(p_code)
     and accepted_at is null
     and (expires_at is null or expires_at > now());

  if v_invite.id is null then raise exception 'Invalid or expired invite'; end if;

  select email into v_my_email from public.profiles where id = auth.uid();
  if lower(v_my_email) <> lower(v_invite.email) then
    raise exception 'This invite was sent to a different email address';
  end if;

  update public.profiles
     set role = v_invite.role,
         daycare_id = v_invite.daycare_id,
         classroom_id = coalesce(v_invite.classroom_id, classroom_id)
   where id = auth.uid();

  if v_invite.role = 'educator' and v_invite.classroom_id is not null then
    insert into public.educator_classrooms (educator_id, classroom_id)
    values (auth.uid(), v_invite.classroom_id)
    on conflict do nothing;
  end if;

  insert into public.staff_members (
    daycare_id, profile_id, job_title, status, background_check_required
  ) values (
    v_invite.daycare_id, auth.uid(), v_invite.job_title, 'active',
    v_invite.require_background_check
  )
  on conflict (daycare_id, profile_id) do update
    set status = 'active',
        job_title = coalesce(excluded.job_title, public.staff_members.job_title),
        background_check_required =
          public.staff_members.background_check_required
          or excluded.background_check_required
  returning id into v_staff_member_id;

  if v_invite.require_background_check then
    insert into public.staff_credentials (
      daycare_id, staff_member_id, name, required, ratio_qualifying
    )
    select v_invite.daycare_id, v_staff_member_id, 'Background check', true, false
    where not exists (
      select 1
        from public.staff_credentials credential
       where credential.staff_member_id = v_staff_member_id
         and credential.archived_at is null
         and lower(credential.name) ~ '(background|criminal record|vulnerable sector)'
    )
    on conflict do nothing;
  end if;

  select id into v_role_id
    from public.center_roles
   where daycare_id = v_invite.daycare_id
     and name = public.default_role_name(
       v_invite.role, v_invite.job_title, v_invite.classroom_id
     );
  update public.profiles set center_role_id = v_role_id where id = auth.uid();

  update public.staff_invites
     set accepted_at = now(), accepted_by = auth.uid()
   where id = v_invite.id;
end;
$$;

-- The live ratio count excludes an educator whose required clearance has not
-- been approved. This is intentionally conservative: they remain visible and
-- can work alongside cleared staff, but never satisfy a required ratio slot.
create or replace function public._room_ratio_snapshot(p_classroom_id uuid)
returns table (
  present_count integer,
  staff_count integer,
  required_staff integer,
  max_children_per_staff integer,
  over_by integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_daycare_id uuid;
  v_ratio integer;
  v_tracking boolean;
  v_timezone text;
  v_today date;
  v_present integer;
  v_staff integer;
  v_required integer;
begin
  select classroom.daycare_id,
         greatest(coalesce(classroom.ratio_children_per_educator, 1), 1),
         center.time_tracking_enabled,
         coalesce(center.timezone, 'UTC')
    into v_daycare_id, v_ratio, v_tracking, v_timezone
    from public.classrooms classroom
    join public.daycares center on center.id = classroom.daycare_id
   where classroom.id = p_classroom_id
     and classroom.archived_at is null;

  if v_daycare_id is null then return; end if;
  v_today := (now() at time zone v_timezone)::date;

  select count(*)::integer into v_present
    from public.attendance_records attendance
    join public.children child on child.id = attendance.child_id
   where child.classroom_id = p_classroom_id
     and attendance.date = v_today
     and attendance.checked_in_at is not null
     and attendance.checked_out_at is null
     and attendance.status in ('present', 'late');

  with staff_presence as (
    select
      member.id as staff_member_id,
      profile.id as profile_id,
      coalesce(
        (
          select coverage.classroom_id
            from public.room_coverage_assignments coverage
           where coverage.staff_member_id = member.id
             and coverage.status in ('assigned', 'accepted')
             and coverage.starts_at <= now()
             and coverage.ends_at > now()
           order by coverage.starts_at desc limit 1
        ),
        (
          select entry.classroom_id
            from public.staff_time_entries entry
           where entry.staff_member_id = member.id
             and entry.clocked_out_at is null
           order by entry.clocked_in_at desc limit 1
        ),
        profile.classroom_id,
        (
          select assignment.classroom_id
            from public.educator_classrooms assignment
           where assignment.educator_id = profile.id
           order by assignment.classroom_id limit 1
        )
      ) as effective_classroom_id,
      exists (
        select 1
          from public.staff_time_entries open_entry
         where open_entry.staff_member_id = member.id
           and open_entry.clocked_out_at is null
      ) as is_clocked_in
    from public.staff_members member
    join public.profiles profile on profile.id = member.profile_id
   where member.daycare_id = v_daycare_id
     and member.status = 'active'
     and member.archived_at is null
     and profile.role = 'educator'
     and profile.archived_at is null
     and public.staff_is_ratio_eligible(member.id)
  )
  select count(distinct profile_id)::integer into v_staff
    from staff_presence
   where effective_classroom_id = p_classroom_id
     and (not v_tracking or is_clocked_in);

  v_required := case
    when v_present = 0 then 0
    else ceil(v_present::numeric / v_ratio)::integer
  end;

  return query select
    v_present,
    coalesce(v_staff, 0),
    v_required,
    v_ratio,
    greatest(v_required - coalesce(v_staff, 0), 0);
end;
$$;

create or replace function public.list_available_ratio_floaters(p_classroom_id uuid)
returns table (
  staff_member_id uuid,
  profile_id uuid,
  full_name text,
  current_classroom_id uuid,
  current_classroom_name text,
  availability_note text
)
language sql
stable
security definer
set search_path = public
as $$
  with center as (
    select classroom.daycare_id, daycare.time_tracking_enabled
      from public.classrooms classroom
      join public.daycares daycare on daycare.id = classroom.daycare_id
     where classroom.id = p_classroom_id
       and classroom.daycare_id = public.get_my_daycare_id()
       and classroom.archived_at is null
       and public.is_staff()
  ), candidates as (
    select
      member.id as staff_member_id,
      profile.id as profile_id,
      profile.full_name,
      coalesce(
        (
          select entry.classroom_id
            from public.staff_time_entries entry
           where entry.staff_member_id = member.id
             and entry.clocked_out_at is null
           order by entry.clocked_in_at desc limit 1
        ),
        profile.classroom_id
      ) as current_classroom_id,
      exists (
        select 1
          from public.staff_time_entries entry
         where entry.staff_member_id = member.id
           and entry.clocked_out_at is null
      ) as is_clocked_in,
      center.time_tracking_enabled
    from center
    join public.staff_members member on member.daycare_id = center.daycare_id
    join public.profiles profile on profile.id = member.profile_id
   where member.status = 'active'
     and member.archived_at is null
     and profile.role = 'educator'
     and profile.archived_at is null
     and public.staff_is_ratio_eligible(member.id)
     and not exists (
       select 1
         from public.room_coverage_assignments active_assignment
        where active_assignment.staff_member_id = member.id
          and active_assignment.status in ('assigned', 'accepted')
          and active_assignment.starts_at <= now()
          and active_assignment.ends_at > now()
     )
  ), available as (
    select candidate.*, source.name as current_classroom_name
      from candidates candidate
      left join public.classrooms source on source.id = candidate.current_classroom_id
      left join lateral public._room_ratio_snapshot(candidate.current_classroom_id) source_ratio on true
     where candidate.current_classroom_id is distinct from p_classroom_id
       and (not candidate.time_tracking_enabled or candidate.is_clocked_in)
       and (
         candidate.current_classroom_id is null
         or source_ratio.staff_count - 1 >= source_ratio.required_staff
       )
  )
  select
    available.staff_member_id,
    available.profile_id,
    available.full_name,
    available.current_classroom_id,
    available.current_classroom_name,
    case
      when available.current_classroom_id is null then 'Available · floater pool'
      else 'In ' || available.current_classroom_name || ' · can spare'
    end
  from available
  order by (available.current_classroom_id is null) desc, available.full_name;
$$;
