-- ============================================================================
-- P0 — server-side rate limits for public and brute-forceable RPCs
-- ============================================================================

create table rate_limit_windows (
  scope text not null,
  subject_hash text not null,
  window_started_at timestamptz not null,
  hits int not null default 1 check (hits > 0),
  updated_at timestamptz not null default now(),
  primary key (scope, subject_hash, window_started_at)
);

create index rate_limit_windows_cleanup_idx on rate_limit_windows (window_started_at);
alter table rate_limit_windows enable row level security;
-- No client policies. Only security-definer RPCs may consume counters.

create or replace function request_fingerprint()
returns text
language sql stable
set search_path = public, extensions
as $$
  select encode(digest(
    coalesce(auth.uid()::text, '') || '|' ||
    split_part(coalesce(
      current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for',
      current_setting('request.headers', true)::jsonb ->> 'x-real-ip',
      'unknown'
    ), ',', 1) || '|' ||
    coalesce(current_setting('request.headers', true)::jsonb ->> 'user-agent', 'unknown'),
    'sha256'
  ), 'hex')
$$;

create or replace function consume_rate_limit(
  p_scope text,
  p_subject text,
  p_limit int,
  p_window_seconds int
)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  v_window timestamptz;
  v_hits int;
  v_hash text;
begin
  if nullif(btrim(p_scope), '') is null or nullif(p_subject, '') is null
     or p_limit not between 1 and 1000 or p_window_seconds not between 10 and 86400 then
    raise exception 'Invalid rate limit configuration';
  end if;
  v_window := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );
  v_hash := encode(digest(p_subject, 'sha256'), 'hex');

  insert into rate_limit_windows (scope, subject_hash, window_started_at, hits)
  values (left(p_scope, 80), v_hash, v_window, 1)
  on conflict (scope, subject_hash, window_started_at)
  do update set hits = rate_limit_windows.hits + 1, updated_at = now()
  returning hits into v_hits;

  -- Opportunistic bounded-lifetime cleanup; counters contain no raw IP/email.
  delete from rate_limit_windows where window_started_at < now() - interval '2 days';
  return v_hits <= p_limit;
end;
$$;

create or replace function assert_rate_limit(
  p_scope text,
  p_limit int,
  p_window_seconds int,
  p_subject_suffix text default ''
)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not consume_rate_limit(
    p_scope,
    request_fingerprint() || ':' || coalesce(p_subject_suffix, ''),
    p_limit,
    p_window_seconds
  ) then
    raise exception 'Too many attempts. Please try again later.' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function get_staff_invite(p_code text)
returns table (
  email text, full_name text, role text, daycare_name text,
  classroom_name text, invited_by_name text, expires_at timestamptz
)
language plpgsql security definer
set search_path = public
as $$
begin
  perform assert_rate_limit('staff_invite_preview', 20, 600);
  return query
    select i.email, i.full_name, i.role, d.name, cl.name, p.full_name, i.expires_at
      from staff_invites i
      join daycares d on d.id = i.daycare_id
      left join classrooms cl on cl.id = i.classroom_id
      left join profiles p on p.id = i.invited_by
     where upper(i.code) = upper(btrim(p_code))
       and i.accepted_at is null
       and (i.expires_at is null or i.expires_at > now());
end;
$$;

create or replace function check_daycare_signup_code(p_code text)
returns table (daycare_id uuid, daycare_name text, role text)
language plpgsql security definer
set search_path = public
as $$
begin
  perform assert_rate_limit('center_join_code_preview', 20, 600);
  return query
    select d.id, d.name, c.role
      from daycare_signup_codes c
      join daycares d on d.id = c.daycare_id
     where upper(c.code) = upper(btrim(p_code))
       and coalesce(c.uses_remaining, 0) > 0
       and (c.expires_at is null or c.expires_at > now());
end;
$$;

create or replace function join_daycare_with_code(p_code text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_code daycare_signup_codes%rowtype;
  v_role_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  perform assert_rate_limit('center_join_code_redeem', 10, 900);

  select * into v_code from daycare_signup_codes
   where upper(code) = upper(btrim(p_code))
     and coalesce(uses_remaining, 0) > 0
     and (expires_at is null or expires_at > now())
   for update;
  if v_code.id is null then raise exception 'Invalid or expired code'; end if;

  select id into v_role_id from center_roles
   where daycare_id = v_code.daycare_id
     and name = default_role_name(v_code.role, null, null)
   limit 1;

  update profiles
     set daycare_id = v_code.daycare_id, role = v_code.role, center_role_id = v_role_id
   where id = auth.uid() and daycare_id is null;
  if not found then raise exception 'Profile is already attached to a center'; end if;

  insert into staff_members (daycare_id, profile_id, job_title, status)
  values (v_code.daycare_id, auth.uid(), initcap(replace(v_code.role, '_', ' ')), 'active')
  on conflict (daycare_id, profile_id) do update set status = 'active';

  update daycare_signup_codes set uses_remaining = uses_remaining - 1 where id = v_code.id;
  return v_code.daycare_id;
end;
$$;

create or replace function link_child_with_code(p_code text)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_invite child_invite_codes%rowtype;
  v_email text;
begin
  if auth.uid() is null or get_my_role() <> 'parent' then
    raise exception 'A signed-in parent account is required';
  end if;
  perform assert_rate_limit('child_invite_redeem', 10, 900);

  select * into v_invite from child_invite_codes
   where upper(code) = upper(btrim(p_code))
     and used_at is null and (expires_at is null or expires_at > now())
   for update;
  if v_invite.id is null then raise exception 'Invalid or expired code'; end if;

  select email into v_email from profiles where id = auth.uid();
  if v_invite.email is not null and lower(v_invite.email) <> lower(v_email) then
    raise exception 'This invite was sent to a different email address';
  end if;

  insert into parent_children (parent_id, child_id, relationship, consent_given_at)
  values (auth.uid(), v_invite.child_id, v_invite.relationship, now())
  on conflict (parent_id, child_id) do update
    set relationship = coalesce(excluded.relationship, parent_children.relationship);

  update profiles set daycare_id = (
    select daycare_id from children where id = v_invite.child_id
  ) where id = auth.uid() and daycare_id is null;

  update child_invite_codes
     set used_at = now(), used_by = auth.uid()
   where id = v_invite.id;
  return v_invite.child_id;
end;
$$;

create or replace function kiosk_lookup_pin(p_pin text)
returns table (
  pickup_name text, child_id uuid, first_name text, last_name text,
  room_name text, checked_in_at timestamptz, checked_out_at timestamptz
)
language plpgsql security definer
set search_path = public
as $$
begin
  if not has_permission('attendance', 'edit') then raise exception 'Attendance permission required'; end if;
  perform assert_rate_limit('kiosk_pin_lookup', 30, 60, get_my_daycare_id()::text);
  return query
    select cp.full_name, c.id, c.first_name, c.last_name, cl.name,
           ar.checked_in_at, ar.checked_out_at
      from child_pickups cp
      join children c on c.id = cp.child_id and c.archived_at is null
      left join classrooms cl on cl.id = c.classroom_id
      left join attendance_records ar on ar.child_id = c.id and ar.date = center_today()
     where cp.pin = btrim(p_pin) and cp.archived_at is null
       and cp.daycare_id = get_my_daycare_id();
end;
$$;

create or replace function kiosk_check(p_child_id uuid, p_pin text)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_pickup child_pickups%rowtype;
  v_record attendance_records%rowtype;
  v_today date := center_today();
begin
  if not has_permission('attendance', 'edit') then raise exception 'Attendance permission required'; end if;
  perform assert_rate_limit('kiosk_pin_redeem', 30, 60, get_my_daycare_id()::text);

  select * into v_pickup from child_pickups
   where pin = btrim(p_pin) and child_id = p_child_id and archived_at is null
     and daycare_id = get_my_daycare_id();
  if v_pickup.id is null then raise exception 'PIN does not match this child'; end if;

  select * into v_record from attendance_records
   where child_id = p_child_id and date = v_today;
  if v_record.id is null or v_record.checked_in_at is null then
    insert into attendance_records (
      daycare_id, child_id, date, checked_in_at, method, status, dropped_off_by
    ) values (
      v_pickup.daycare_id, p_child_id, v_today, now(), 'kiosk', 'present', v_pickup.full_name
    ) on conflict (child_id, date) do update
      set checked_in_at = now(), method = 'kiosk', status = 'present',
          dropped_off_by = v_pickup.full_name, checked_out_at = null, checked_out_by = null;
    return 'checked_in';
  end if;
  if v_record.checked_out_at is null then
    update attendance_records set checked_out_at = now(), picked_up_by = v_pickup.full_name,
      method = 'kiosk' where id = v_record.id;
    return 'checked_out';
  end if;
  update attendance_records set checked_in_at = now(), checked_out_at = null,
    dropped_off_by = v_pickup.full_name, method = 'kiosk' where id = v_record.id;
  return 'checked_in';
end;
$$;

create or replace function submit_enrollment_inquiry(
  p_daycare_id uuid,
  p_guardian_name text,
  p_guardian_email text,
  p_guardian_phone text,
  p_child_first_name text,
  p_child_date_of_birth date,
  p_classroom_id uuid default null,
  p_desired_start date default null
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_email text := lower(btrim(p_guardian_email));
begin
  perform assert_rate_limit('enrollment_inquiry', 5, 3600, p_daycare_id::text);
  if not exists (select 1 from daycares where id = p_daycare_id and active) then
    raise exception 'Unknown center';
  end if;
  if nullif(btrim(p_guardian_name), '') is null or nullif(v_email, '') is null
     or nullif(btrim(p_child_first_name), '') is null then
    raise exception 'Guardian name, email, and child name are required';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'A valid email is required';
  end if;
  if length(p_guardian_name) > 160 or length(v_email) > 320
     or length(p_child_first_name) > 100 or length(coalesce(p_guardian_phone, '')) > 40 then
    raise exception 'Inquiry field is too long';
  end if;
  if p_classroom_id is not null and not exists (
    select 1 from classrooms where id = p_classroom_id
      and daycare_id = p_daycare_id and archived_at is null
  ) then raise exception 'Program not found'; end if;

  insert into enrollments (
    daycare_id, classroom_id, child_first_name, child_date_of_birth,
    guardian_name, guardian_email, guardian_phone, stage, desired_start_date, source
  ) values (
    p_daycare_id, p_classroom_id, btrim(p_child_first_name), p_child_date_of_birth,
    btrim(p_guardian_name), v_email, nullif(btrim(p_guardian_phone), ''),
    'inquiry', p_desired_start, 'website'
  );
end;
$$;

revoke all on function request_fingerprint() from public, anon, authenticated;
revoke all on function consume_rate_limit(text, text, int, int) from public, anon, authenticated;
revoke all on function assert_rate_limit(text, int, int, text) from public, anon, authenticated;
