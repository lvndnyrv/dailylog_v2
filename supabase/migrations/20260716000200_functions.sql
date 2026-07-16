-- ============================================================================
-- DailyLog — helper functions, RPCs, triggers (Phase 0)
-- ============================================================================
-- Helpers are `security definer stable` so RLS policies can call them without
-- recursing through the policies on profiles.
--
-- AUDIT RESOLVED (2026-07-16, diffed against the live DB): is_staff,
-- get_daycare_stats, get_daycare_users, admin_set_user_role and
-- get_attendance_range exist NOWHERE live either — the mobile screens calling
-- them error in production today. The definitions below (inferred from call
-- sites) are the first real ones. See DECISIONS.md.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- Identity helpers
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function get_my_role()
returns text
language sql security definer stable
set search_path = public
as $$
  select role from profiles where id = auth.uid()
$$;

create or replace function get_my_daycare_id()
returns uuid
language sql security definer stable
set search_path = public
as $$
  select daycare_id from profiles where id = auth.uid()
$$;

create or replace function get_my_classroom_id()
returns uuid
language sql security definer stable
set search_path = public
as $$
  select classroom_id from profiles where id = auth.uid()
$$;

-- owner_admin and admin are both "admin" for access purposes; owner_admin is
-- additionally the only role that can demote another admin (see admin_set_user_role).
create or replace function is_admin()
returns boolean
language sql security definer stable
set search_path = public
as $$
  select get_my_role() in ('owner_admin', 'admin')
$$;

create or replace function is_staff()
returns boolean
language sql security definer stable
set search_path = public
as $$
  select get_my_role() in ('owner_admin', 'admin', 'educator')
$$;

-- Every classroom an educator is assigned to: the junction table plus the
-- legacy single profiles.classroom_id, so single- and multi-room both work.
create or replace function my_classroom_ids()
returns setof uuid
language sql security definer stable
set search_path = public
as $$
  select classroom_id from educator_classrooms where educator_id = auth.uid()
  union
  select classroom_id from profiles where id = auth.uid() and classroom_id is not null
$$;

create or replace function my_child_ids()
returns setof uuid
language sql security definer stable
set search_path = public
as $$
  select child_id from parent_children where parent_id = auth.uid()
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Access predicates
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function can_access_child(p_child_id uuid)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1
    from children c
    where c.id = p_child_id
      and (
        -- admins: anything in their daycare
        (is_admin() and c.daycare_id = get_my_daycare_id())
        -- educators: children in a classroom they're assigned to
        or (get_my_role() = 'educator' and c.classroom_id in (select my_classroom_ids()))
        -- parents: only linked children
        or (get_my_role() = 'parent' and c.id in (select my_child_ids()))
      )
  )
$$;

create or replace function child_in_my_daycare(p_child_id uuid)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1 from children c
    where c.id = p_child_id and c.daycare_id = get_my_daycare_id()
  )
$$;

create or replace function can_access_log(p_log_id uuid)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1 from daily_logs dl
    where dl.id = p_log_id and can_access_child(dl.child_id)
  )
$$;

-- Educators may only WRITE for classrooms they're assigned to; admins may write
-- anywhere in their daycare. Parents never write logs.
create or replace function can_write_child(p_child_id uuid)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1
    from children c
    where c.id = p_child_id
      and (
        (is_admin() and c.daycare_id = get_my_daycare_id())
        or (get_my_role() = 'educator' and c.classroom_id in (select my_classroom_ids()))
      )
  )
$$;

create or replace function can_write_log(p_log_id uuid)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1 from daily_logs dl
    where dl.id = p_log_id and can_write_child(dl.child_id)
  )
$$;

-- storage.objects policies name child avatars "<child_id>/<file>"
create or replace function storage_child_id(p_name text)
returns uuid
language sql immutable
as $$
  select nullif(split_part(p_name, '/', 1), '')::uuid
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Auth wiring
-- ─────────────────────────────────────────────────────────────────────────────

-- Creates a profile row for every new auth user. Runs as definer because the
-- caller at signup time has no profile yet and so no RLS grant.
create or replace function handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'role', 'parent')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

create or replace function delete_my_account()
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  delete from parent_children where parent_id = auth.uid();
  delete from push_tokens where user_id = auth.uid();
  -- daily_logs.educator_id is ON DELETE SET NULL, so history survives for parents
  delete from profiles where id = auth.uid();
  delete from auth.users where id = auth.uid();
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Codes & invites
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function generate_invite_code()
returns text
language sql volatile
as $$
  -- 8 chars, no ambiguous 0/O/1/I
  select string_agg(
    substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', floor(random() * 32 + 1)::int, 1),
    ''
  )
  from generate_series(1, 8)
$$;

create or replace function link_child_with_code(p_code text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_child_id uuid;
begin
  select child_id into v_child_id
  from child_invite_codes
  where upper(code) = upper(p_code)
    and used_at is null
    and (expires_at is null or expires_at > now());

  if v_child_id is null then
    raise exception 'Invalid or expired code';
  end if;

  insert into parent_children (parent_id, child_id, consent_given_at)
  values (auth.uid(), v_child_id, now())
  on conflict do nothing;

  -- first link adopts the parent into the child's daycare — staff visibility
  -- of parent profiles keys off profiles.daycare_id
  update profiles
     set daycare_id = (select daycare_id from children where id = v_child_id)
   where id = auth.uid() and daycare_id is null;

  update child_invite_codes
     set used_at = now(), used_by = auth.uid()
   where upper(code) = upper(p_code);

  return v_child_id;
end;
$$;

create or replace function check_daycare_signup_code(p_code text)
returns table (daycare_id uuid, daycare_name text, role text)
language sql security definer stable
set search_path = public
as $$
  select d.id, d.name, c.role
  from daycare_signup_codes c
  join daycares d on d.id = c.daycare_id
  where upper(c.code) = upper(p_code)
    and coalesce(c.uses_remaining, 0) > 0
    and (c.expires_at is null or c.expires_at > now())
$$;

create or replace function join_daycare_with_code(p_code text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_daycare_id uuid;
  v_role text;
begin
  select daycare_id, role into v_daycare_id, v_role
  from check_daycare_signup_code(p_code);

  if v_daycare_id is null then
    raise exception 'Invalid or expired code';
  end if;

  update profiles
     set daycare_id = v_daycare_id, role = v_role
   where id = auth.uid();

  update daycare_signup_codes
     set uses_remaining = uses_remaining - 1
   where upper(code) = upper(p_code);

  return v_daycare_id;
end;
$$;

create or replace function invite_staff(
  p_email text,
  p_role text,
  p_classroom_id uuid default null
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

  insert into staff_invites (daycare_id, email, role, classroom_id, code, invited_by, expires_at)
  values (get_my_daycare_id(), lower(p_email), p_role, p_classroom_id, v_code, auth.uid(),
          now() + interval '14 days');

  return v_code;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Admin RPCs (RECONSTRUCTED from call sites)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function get_daycare_stats()
returns json
language sql security definer stable
set search_path = public
as $$
  select json_build_object(
    'children', (select count(*) from children
                  where daycare_id = get_my_daycare_id() and archived_at is null),
    'classrooms', (select count(*) from classrooms
                    where daycare_id = get_my_daycare_id() and archived_at is null),
    'staff', (select count(*) from profiles
               where daycare_id = get_my_daycare_id()
                 and role in ('owner_admin', 'admin', 'educator')),
    'parents', (select count(*) from profiles
                 where daycare_id = get_my_daycare_id() and role = 'parent'),
    'present_today', (select count(*) from attendance_records
                       where daycare_id = get_my_daycare_id()
                         and date = current_date
                         and checked_in_at is not null
                         and checked_out_at is null)
  )
  where is_admin()
$$;

create or replace function get_daycare_users()
returns table (
  id uuid,
  email text,
  full_name text,
  role text,
  classroom_id uuid,
  created_at timestamptz
)
language sql security definer stable
set search_path = public
as $$
  select p.id, p.email, p.full_name, p.role, p.classroom_id, p.created_at
  from profiles p
  where p.daycare_id = get_my_daycare_id()
    and is_admin()
  order by p.role, p.full_name
$$;

create or replace function admin_set_user_role(p_user_id uuid, p_role text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_target_role text;
begin
  if not is_admin() then
    raise exception 'Only admins can change roles';
  end if;

  select role into v_target_role
  from profiles
  where id = p_user_id and daycare_id = get_my_daycare_id();

  if v_target_role is null then
    raise exception 'User not found in your daycare';
  end if;

  -- only an owner_admin may change another admin, or mint a new one
  if (v_target_role in ('owner_admin', 'admin') or p_role in ('owner_admin', 'admin'))
     and get_my_role() <> 'owner_admin' then
    raise exception 'Only the owner can change admin roles';
  end if;

  update profiles set role = p_role where id = p_user_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Read RPCs
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function get_daycare_classrooms()
returns table (id uuid, name text, age_group text, child_count bigint)
language sql security definer stable
set search_path = public
as $$
  select cl.id, cl.name, cl.age_group,
         (select count(*) from children c
           where c.classroom_id = cl.id and c.archived_at is null)
  from classrooms cl
  where cl.daycare_id = get_my_daycare_id()
    and cl.archived_at is null
  order by cl.name
$$;

-- Avoids the roster N+1: one row per child with today's log state.
create or replace function get_classroom_log_status(p_classroom_id uuid, p_date date default current_date)
returns table (
  child_id uuid,
  first_name text,
  last_name text,
  photo_url text,
  log_id uuid,
  sent_to_parents boolean,
  checked_in_at timestamptz,
  checked_out_at timestamptz
)
language sql security definer stable
set search_path = public
as $$
  select c.id, c.first_name, c.last_name, c.photo_url,
         dl.id, coalesce(dl.sent_to_parents, false),
         ar.checked_in_at, ar.checked_out_at
  from children c
  left join daily_logs dl on dl.child_id = c.id and dl.log_date = p_date
  left join attendance_records ar on ar.child_id = c.id and ar.date = p_date
  where c.classroom_id = p_classroom_id
    and c.archived_at is null
    and can_access_child(c.id)
  order by c.first_name
$$;

create or replace function get_attendance_range(
  p_classroom_id uuid,
  p_start date,
  p_end date
)
returns table (
  child_id uuid,
  first_name text,
  last_name text,
  date date,
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  status text
)
language sql security definer stable
set search_path = public
as $$
  select c.id, c.first_name, c.last_name, ar.date,
         ar.checked_in_at, ar.checked_out_at, ar.status
  from attendance_records ar
  join children c on c.id = ar.child_id
  where c.classroom_id = p_classroom_id
    and ar.date between p_start and p_end
    and can_access_child(c.id)
  order by ar.date desc, c.first_name
$$;

create or replace function bulk_set_moods(p_log_ids uuid[], p_moods text[])
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_log_id uuid;
begin
  foreach v_log_id in array p_log_ids loop
    if can_write_log(v_log_id) then
      update daily_logs set moods = p_moods where id = v_log_id;
    end if;
  end loop;
end;
$$;

create or replace function acknowledge_incident(p_incident_id uuid, p_name text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  update incident_reports
     set parent_acknowledged_at = now(),
         parent_acknowledge_name = p_name,
         status = 'acknowledged'
   where id = p_incident_id
     and child_id in (select my_child_ids());

  if not found then
    raise exception 'Incident not found or not yours to acknowledge';
  end if;
end;
$$;

create or replace function mark_messages_read(p_child_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not can_access_child(p_child_id) then
    raise exception 'No access to this child';
  end if;

  update messages
     set read_at = now()
   where child_id = p_child_id
     and sender_id <> auth.uid()
     and read_at is null;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Push token lookups
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function get_parent_push_tokens(p_child_id uuid)
returns table (token text, platform text)
language sql security definer stable
set search_path = public
as $$
  select pt.token, pt.platform
  from push_tokens pt
  join parent_children pc on pc.parent_id = pt.user_id
  where pc.child_id = p_child_id
$$;

create or replace function get_announcement_push_tokens(
  p_daycare_id uuid,
  p_classroom_id uuid default null
)
returns table (token text, platform text)
language sql security definer stable
set search_path = public
as $$
  select distinct pt.token, pt.platform
  from push_tokens pt
  join parent_children pc on pc.parent_id = pt.user_id
  join children c on c.id = pc.child_id
  where c.daycare_id = p_daycare_id
    and (p_classroom_id is null or c.classroom_id = p_classroom_id)
    and c.archived_at is null
$$;
