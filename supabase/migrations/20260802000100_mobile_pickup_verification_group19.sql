-- ============================================================================
-- Mobile Group 19 — short-lived pickup passes and verified hand-off
-- ============================================================================
-- The existing child_pickups.pin remains the door-kiosk credential. Mobile
-- passes are deliberately separate: opaque, single-use, two-minute credentials
-- whose plaintext is returned once and never stored.

create table if not exists public.pickup_plans (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references public.daycares(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  presenter_profile_id uuid references public.profiles(id) on delete set null,
  pickup_id uuid references public.child_pickups(id) on delete set null,
  presenter_name text not null,
  relationship text,
  scheduled_on date not null,
  scheduled_for timestamptz,
  status text not null default 'expected'
    check (status in ('expected', 'completed', 'cancelled')),
  completed_at timestamptz,
  completed_by uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(presenter_profile_id, pickup_id) <= 1),
  check (
    (status = 'completed' and completed_at is not null)
    or (status <> 'completed' and completed_at is null)
  )
);

create unique index if not exists pickup_plans_one_expected_child_day_idx
  on public.pickup_plans (child_id, scheduled_on)
  where status = 'expected';
create index if not exists pickup_plans_center_day_idx
  on public.pickup_plans (daycare_id, scheduled_on, scheduled_for);

drop trigger if exists pickup_plans_updated_at on public.pickup_plans;
create trigger pickup_plans_updated_at
  before update on public.pickup_plans
  for each row execute function public.update_updated_at();

create table if not exists public.pickup_passes (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references public.daycares(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  presenter_profile_id uuid references public.profiles(id) on delete set null,
  pickup_id uuid references public.child_pickups(id) on delete set null,
  presenter_name text not null,
  relationship text,
  token_hash bytea not null,
  code_hash bytea not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references public.profiles(id) on delete set null,
  revoked_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (num_nonnulls(presenter_profile_id, pickup_id) = 1),
  check (expires_at > created_at),
  check ((used_at is null) = (used_by is null))
);

create unique index if not exists pickup_passes_token_hash_idx
  on public.pickup_passes (token_hash);
create index if not exists pickup_passes_active_code_idx
  on public.pickup_passes (daycare_id, code_hash, expires_at)
  where used_at is null and revoked_at is null;
create index if not exists pickup_passes_child_created_idx
  on public.pickup_passes (child_id, created_at desc);

create table if not exists public.pickup_security_events (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references public.daycares(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  attempted_name text,
  notes text,
  status text not null default 'open' check (status in ('open', 'resolved')),
  reported_by uuid not null references public.profiles(id) on delete restrict,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'resolved' and resolved_at is not null)
    or (status = 'open' and resolved_at is null)
  )
);

create index if not exists pickup_security_events_center_status_idx
  on public.pickup_security_events (daycare_id, status, created_at desc);

drop trigger if exists pickup_security_events_updated_at on public.pickup_security_events;
create trigger pickup_security_events_updated_at
  before update on public.pickup_security_events
  for each row execute function public.update_updated_at();

alter table public.pickup_plans enable row level security;
alter table public.pickup_passes enable row level security;
alter table public.pickup_security_events enable row level security;

drop policy if exists "families and staff read pickup plans" on public.pickup_plans;
create policy "families and staff read pickup plans"
  on public.pickup_plans for select
  using (
    child_id in (select public.my_child_ids())
    or (public.is_staff() and daycare_id = public.get_my_daycare_id())
  );

-- Clients never need pass hashes. All pass access goes through the narrowly
-- scoped security-definer functions below, so pickup_passes has no API policy.

drop policy if exists "staff read pickup security events" on public.pickup_security_events;
create policy "staff read pickup security events"
  on public.pickup_security_events for select
  using (public.is_staff() and daycare_id = public.get_my_daycare_id());

drop policy if exists "admins resolve pickup security events" on public.pickup_security_events;
create policy "admins resolve pickup security events"
  on public.pickup_security_events for update
  using (public.is_admin() and daycare_id = public.get_my_daycare_id())
  with check (public.is_admin() and daycare_id = public.get_my_daycare_id());

drop trigger if exists audit_pickup_plans on public.pickup_plans;
create trigger audit_pickup_plans
  after insert or update on public.pickup_plans
  for each row execute function public.audit_write();

drop trigger if exists audit_pickup_security_events on public.pickup_security_events;
create trigger audit_pickup_security_events
  after insert or update on public.pickup_security_events
  for each row execute function public.audit_write();

-- Preserve the central RBAC mutation guard while allowing only the two
-- parent-facing security-definer RPCs in this migration to manage a linked
-- child's non-account pickup people. Direct parent writes remain blocked by
-- child_pickups RLS.
create or replace function public.enforce_child_admin_mutation()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' or (auth.uid() is null and auth.role() is null) then
    return coalesce(new, old);
  end if;
  if tg_table_name = 'child_invite_codes' then
    if tg_op = 'UPDATE'
       and old.used_at is null and new.used_at is not null and new.used_by = auth.uid() then
      return new;
    end if;
  end if;
  if tg_table_name = 'child_pickups'
     and public.get_my_role() = 'parent'
     and current_setting('dailylog.parent_pickup_rpc', true) = 'allowed' then
    return coalesce(new, old);
  end if;
  if not public.has_permission('children', 'edit') then
    raise exception 'Children edit permission required';
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function public.get_parent_pickup_options(
  p_child_id uuid,
  p_include_removed boolean default true
)
returns table (
  source_type text,
  source_id uuid,
  full_name text,
  relationship text,
  phone text,
  avatar_url text,
  is_primary boolean,
  is_active boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not exists (
    select 1
      from public.parent_children mine
     where mine.parent_id = auth.uid()
       and mine.child_id = p_child_id
       and mine.pickup_authorized
  ) then
    raise exception 'You are not authorized to manage pickup for this child';
  end if;

  return query
    select result.source_type, result.source_id, result.full_name,
           result.relationship, result.phone, result.avatar_url,
           result.is_primary, result.is_active
      from (
        select
          'profile'::text as source_type,
          guardian.id as source_id,
          guardian.full_name,
          link.relationship,
          nullif(guardian.phone, '') as phone,
          guardian.avatar_url,
          link.is_primary,
          link.pickup_authorized and guardian.archived_at is null as is_active
        from public.parent_children link
        join public.profiles guardian on guardian.id = link.parent_id
        where link.child_id = p_child_id

        union all

        select
          'pickup'::text,
          pickup.id,
          pickup.full_name,
          pickup.relationship,
          pickup.phone,
          null::text,
          pickup.is_primary,
          pickup.archived_at is null
        from public.child_pickups pickup
        where pickup.child_id = p_child_id
          and (p_include_removed or pickup.archived_at is null)
          and not exists (
            select 1
              from public.parent_children linked
              join public.profiles linked_profile on linked_profile.id = linked.parent_id
             where linked.child_id = pickup.child_id
               and lower(btrim(linked_profile.full_name)) = lower(btrim(pickup.full_name))
          )
      ) result
     order by result.is_active desc, result.is_primary desc, result.full_name;
end;
$$;

create or replace function public.parent_add_authorized_pickup(
  p_child_id uuid,
  p_full_name text,
  p_relationship text,
  p_phone text default null
)
returns table (
  id uuid,
  full_name text,
  relationship text,
  phone text,
  is_primary boolean,
  is_active boolean
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_daycare_id uuid;
  v_pin text;
  v_row public.child_pickups%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.parent_children mine
     where mine.parent_id = auth.uid()
       and mine.child_id = p_child_id
       and mine.pickup_authorized
  ) then
    raise exception 'You are not authorized to manage pickup for this child';
  end if;
  if nullif(btrim(p_full_name), '') is null or length(btrim(p_full_name)) > 120 then
    raise exception 'A valid full name is required';
  end if;
  if nullif(btrim(p_relationship), '') is null or length(btrim(p_relationship)) > 80 then
    raise exception 'A relationship is required';
  end if;
  if length(coalesce(btrim(p_phone), '')) > 40 then
    raise exception 'Phone number is too long';
  end if;

  select child.daycare_id into v_daycare_id
    from public.children child
   where child.id = p_child_id and child.archived_at is null;
  if v_daycare_id is null then raise exception 'Child not found'; end if;

  perform public.assert_rate_limit('parent_add_pickup', 10, 3600, p_child_id::text);
  perform pg_advisory_xact_lock(hashtext(v_daycare_id::text), 19019);
  perform set_config('dailylog.parent_pickup_rpc', 'allowed', true);

  loop
    v_pin := lpad(floor(random() * 10000)::integer::text, 4, '0');
    exit when not exists (
      select 1 from public.child_pickups existing
       where existing.daycare_id = v_daycare_id
         and existing.pin = v_pin
         and existing.archived_at is null
    );
  end loop;

  insert into public.child_pickups (
    daycare_id, child_id, full_name, relationship, phone, pin, created_by
  ) values (
    v_daycare_id, p_child_id, btrim(p_full_name), btrim(p_relationship),
    nullif(btrim(p_phone), ''), v_pin, auth.uid()
  ) returning * into v_row;

  return query select v_row.id, v_row.full_name, v_row.relationship,
    v_row.phone, v_row.is_primary, true;
end;
$$;

create or replace function public.parent_remove_authorized_pickup(p_pickup_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pickup public.child_pickups%rowtype;
begin
  select * into v_pickup from public.child_pickups where id = p_pickup_id for update;
  if v_pickup.id is null then raise exception 'Authorized pickup not found'; end if;
  if auth.uid() is null or not exists (
    select 1 from public.parent_children mine
     where mine.parent_id = auth.uid()
       and mine.child_id = v_pickup.child_id
       and mine.pickup_authorized
  ) then
    raise exception 'You are not authorized to manage pickup for this child';
  end if;
  if v_pickup.is_primary then raise exception 'The primary pickup cannot be removed'; end if;

  perform set_config('dailylog.parent_pickup_rpc', 'allowed', true);
  update public.child_pickups set archived_at = now() where id = p_pickup_id;
  update public.pickup_passes
     set revoked_at = now()
   where pickup_id = p_pickup_id
     and used_at is null and revoked_at is null;
  update public.pickup_plans
     set status = 'cancelled'
   where pickup_id = p_pickup_id and status = 'expected';
end;
$$;

create or replace function public.create_mobile_pickup_pass(
  p_child_id uuid,
  p_presenter_profile_id uuid default null,
  p_pickup_id uuid default null,
  p_scheduled_for timestamptz default null
)
returns table (
  pass_id uuid,
  qr_payload text,
  manual_code text,
  expires_at timestamptz,
  child_id uuid,
  child_name text,
  room_name text,
  center_name text,
  presenter_name text,
  relationship text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_daycare_id uuid;
  v_timezone text;
  v_today date;
  v_presenter_profile_id uuid;
  v_presenter_name text;
  v_relationship text;
  v_token text;
  v_code text;
  v_token_hash bytea;
  v_code_hash bytea;
  v_pass_id uuid;
  v_expires_at timestamptz := now() + interval '2 minutes';
  v_child_name text;
  v_room_name text;
  v_center_name text;
  v_scheduled_for timestamptz := coalesce(p_scheduled_for, now());
begin
  if auth.uid() is null or not exists (
    select 1 from public.parent_children mine
     where mine.parent_id = auth.uid()
       and mine.child_id = p_child_id
       and mine.pickup_authorized
  ) then
    raise exception 'You are not authorized to create a pickup pass for this child';
  end if;
  if p_presenter_profile_id is not null and p_pickup_id is not null then
    raise exception 'Choose one authorized pickup person';
  end if;

  select child.daycare_id, coalesce(center.timezone, 'UTC'),
         child.first_name || ' ' || child.last_name, room.name, center.name
    into v_daycare_id, v_timezone, v_child_name, v_room_name, v_center_name
    from public.children child
    join public.daycares center on center.id = child.daycare_id
    left join public.classrooms room on room.id = child.classroom_id
   where child.id = p_child_id and child.archived_at is null and center.active;
  if v_daycare_id is null then raise exception 'Child or center not found'; end if;

  v_today := (now() at time zone v_timezone)::date;
  if (v_scheduled_for at time zone v_timezone)::date <> v_today then
    raise exception 'Mobile pickup passes can only be created for today';
  end if;

  v_presenter_profile_id := coalesce(p_presenter_profile_id, case when p_pickup_id is null then auth.uid() end);
  if v_presenter_profile_id is not null then
    select guardian.full_name, link.relationship
      into v_presenter_name, v_relationship
      from public.parent_children link
      join public.profiles guardian on guardian.id = link.parent_id
     where link.child_id = p_child_id
       and link.parent_id = v_presenter_profile_id
       and link.pickup_authorized
       and guardian.archived_at is null;
  else
    select pickup.full_name, pickup.relationship
      into v_presenter_name, v_relationship
      from public.child_pickups pickup
     where pickup.id = p_pickup_id
       and pickup.child_id = p_child_id
       and pickup.archived_at is null;
  end if;
  if v_presenter_name is null then raise exception 'That person is not currently authorized'; end if;

  perform public.assert_rate_limit('mobile_pickup_pass', 60, 3600, p_child_id::text);
  perform pg_advisory_xact_lock(hashtext(v_daycare_id::text), 19020);

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_token_hash := extensions.digest(v_token, 'sha256');
  loop
    v_code := lpad(floor(random() * 1000000)::integer::text, 6, '0');
    v_code_hash := extensions.digest(v_code, 'sha256');
    exit when not exists (
      select 1 from public.pickup_passes existing
       where existing.daycare_id = v_daycare_id
         and existing.code_hash = v_code_hash
         and existing.used_at is null
         and existing.revoked_at is null
         and existing.expires_at > now()
    );
  end loop;

  update public.pickup_passes existing
     set revoked_at = now()
   where existing.child_id = p_child_id
     and existing.created_by = auth.uid()
     and existing.used_at is null
     and existing.revoked_at is null;

  delete from public.pickup_passes expired
   where expired.daycare_id = v_daycare_id
     and expired.expires_at < now() - interval '30 days';

  insert into public.pickup_passes (
    daycare_id, child_id, presenter_profile_id, pickup_id,
    presenter_name, relationship, token_hash, code_hash,
    expires_at, created_by
  ) values (
    v_daycare_id, p_child_id, v_presenter_profile_id, p_pickup_id,
    v_presenter_name, v_relationship, v_token_hash, v_code_hash,
    v_expires_at, auth.uid()
  ) returning id into v_pass_id;

  insert into public.pickup_plans (
    daycare_id, child_id, presenter_profile_id, pickup_id,
    presenter_name, relationship, scheduled_on, scheduled_for, created_by
  ) values (
    v_daycare_id, p_child_id, v_presenter_profile_id, p_pickup_id,
    v_presenter_name, v_relationship, v_today, v_scheduled_for, auth.uid()
  )
  on conflict (child_id, scheduled_on) where status = 'expected'
  do update set
    presenter_profile_id = excluded.presenter_profile_id,
    pickup_id = excluded.pickup_id,
    presenter_name = excluded.presenter_name,
    relationship = excluded.relationship,
    scheduled_for = excluded.scheduled_for,
    created_by = excluded.created_by;

  return query select
    v_pass_id,
    'dailylog-pickup://v1/' || v_token,
    v_code,
    v_expires_at,
    p_child_id,
    v_child_name,
    v_room_name,
    v_center_name,
    v_presenter_name,
    v_relationship;
end;
$$;

create or replace function public.get_mobile_today_pickups(p_classroom_id uuid)
returns table (
  child_id uuid,
  child_name text,
  photo_url text,
  room_name text,
  presenter_name text,
  relationship text,
  scheduled_for timestamptz,
  pickup_status text,
  checked_out_at timestamptz,
  primary_guardian_name text,
  primary_guardian_phone text,
  has_active_pass boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_daycare_id uuid;
  v_timezone text;
  v_today date;
begin
  select room.daycare_id, coalesce(center.timezone, 'UTC')
    into v_daycare_id, v_timezone
    from public.classrooms room
    join public.daycares center on center.id = room.daycare_id
   where room.id = p_classroom_id and room.archived_at is null;

  if v_daycare_id is null
     or v_daycare_id <> public.get_my_daycare_id()
     or not public.is_staff()
     or not public.has_permission('attendance', 'view') then
    raise exception 'You cannot view pickups for this classroom';
  end if;
  if not public.is_admin() and p_classroom_id not in (select public.my_classroom_ids()) then
    raise exception 'You are not assigned to this classroom';
  end if;

  v_today := (now() at time zone v_timezone)::date;
  return query
    select
      child.id,
      child.first_name || ' ' || child.last_name,
      child.photo_url,
      room.name,
      coalesce(plan.presenter_name, guardian.full_name, 'Pickup not set'),
      coalesce(plan.relationship, guardian_link.relationship),
      plan.scheduled_for,
      case when attendance.checked_out_at is not null then 'completed' else 'expected' end,
      attendance.checked_out_at,
      guardian.full_name,
      nullif(guardian.phone, ''),
      exists (
        select 1 from public.pickup_passes pass
         where pass.child_id = child.id
           and pass.used_at is null and pass.revoked_at is null
           and pass.expires_at > now()
      )
    from public.children child
    join public.classrooms room on room.id = child.classroom_id
    join public.attendance_records attendance
      on attendance.child_id = child.id and attendance.date = v_today
    left join lateral (
      select pickup_plan.*
        from public.pickup_plans pickup_plan
       where pickup_plan.child_id = child.id
         and pickup_plan.scheduled_on = v_today
         and pickup_plan.status in ('expected', 'completed')
       order by (pickup_plan.status = 'expected') desc, pickup_plan.created_at desc
       limit 1
    ) plan on true
    left join lateral (
      select link.*
        from public.parent_children link
       where link.child_id = child.id and link.pickup_authorized
       order by link.is_primary desc, link.created_at
       limit 1
    ) guardian_link on true
    left join public.profiles guardian on guardian.id = guardian_link.parent_id
    where child.classroom_id = p_classroom_id
      and child.archived_at is null
      and attendance.checked_in_at is not null
      and attendance.status in ('present', 'late')
    order by (attendance.checked_out_at is not null), plan.scheduled_for nulls last,
             child.first_name, child.last_name;
end;
$$;

create or replace function public.verify_mobile_pickup_pass(
  p_token text default null,
  p_code text default null,
  p_expected_child_id uuid default null
)
returns table (
  pass_id uuid,
  child_id uuid,
  child_name text,
  photo_url text,
  room_name text,
  presenter_name text,
  relationship text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_daycare_id uuid := public.get_my_daycare_id();
  v_token text;
  v_match public.pickup_passes%rowtype;
  v_matches integer;
  v_timezone text;
  v_today date;
begin
  if auth.uid() is null or not public.is_staff() or not public.has_permission('attendance', 'edit') then
    raise exception 'Attendance edit permission is required';
  end if;
  if nullif(btrim(p_token), '') is null and coalesce(btrim(p_code), '') !~ '^[0-9]{6}$' then
    raise exception 'Scan a pass or enter its 6-digit code';
  end if;
  perform public.assert_rate_limit('mobile_pickup_verify', 20, 60, v_daycare_id::text);

  if nullif(btrim(p_token), '') is not null then
    v_token := regexp_replace(btrim(p_token), '^dailylog-pickup://v1/', '');
    select pass.* into v_match
      from public.pickup_passes pass
     where pass.daycare_id = v_daycare_id
       and pass.token_hash = extensions.digest(v_token, 'sha256')
       and pass.used_at is null and pass.revoked_at is null
       and pass.expires_at > now()
     limit 1;
  else
    select count(*)::integer into v_matches
      from public.pickup_passes pass
     where pass.daycare_id = v_daycare_id
       and pass.code_hash = extensions.digest(btrim(p_code), 'sha256')
       and pass.used_at is null and pass.revoked_at is null
       and pass.expires_at > now();
    if v_matches > 1 then raise exception 'Code is ambiguous. Scan the QR pass instead'; end if;
    select pass.* into v_match
      from public.pickup_passes pass
     where pass.daycare_id = v_daycare_id
       and pass.code_hash = extensions.digest(btrim(p_code), 'sha256')
       and pass.used_at is null and pass.revoked_at is null
       and pass.expires_at > now()
     limit 1;
  end if;

  if v_match.id is null then raise exception 'Pass is invalid, expired, or already used'; end if;
  if p_expected_child_id is not null and v_match.child_id <> p_expected_child_id then
    raise exception 'This pass belongs to a different child';
  end if;
  if not public.can_write_child(v_match.child_id) then
    raise exception 'This child is outside your assigned classroom';
  end if;
  if v_match.presenter_profile_id is not null and not exists (
    select 1 from public.parent_children link
     join public.profiles guardian on guardian.id = link.parent_id
     where link.child_id = v_match.child_id
       and link.parent_id = v_match.presenter_profile_id
       and link.pickup_authorized and guardian.archived_at is null
  ) then
    raise exception 'This person is no longer authorized';
  end if;
  if v_match.pickup_id is not null and not exists (
    select 1 from public.child_pickups pickup
     where pickup.id = v_match.pickup_id
       and pickup.child_id = v_match.child_id
       and pickup.archived_at is null
  ) then
    raise exception 'This person is no longer authorized';
  end if;

  select coalesce(center.timezone, 'UTC') into v_timezone
    from public.daycares center where center.id = v_daycare_id;
  v_today := (now() at time zone v_timezone)::date;
  if not exists (
    select 1 from public.attendance_records attendance
     where attendance.child_id = v_match.child_id
       and attendance.date = v_today
       and attendance.checked_in_at is not null
       and attendance.checked_out_at is null
       and attendance.status in ('present', 'late')
  ) then
    raise exception 'This child is not currently checked in';
  end if;

  return query
    select v_match.id, child.id,
      child.first_name || ' ' || child.last_name,
      child.photo_url, room.name, v_match.presenter_name,
      v_match.relationship, v_match.expires_at
    from public.children child
    left join public.classrooms room on room.id = child.classroom_id
    where child.id = v_match.child_id;
end;
$$;

create or replace function public.complete_mobile_pickup(p_pass_id uuid)
returns table (
  child_id uuid,
  child_name text,
  presenter_name text,
  relationship text,
  checked_out_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_pass public.pickup_passes%rowtype;
  v_attendance_id uuid;
  v_checked_out_at timestamptz := now();
  v_child_name text;
  v_timezone text;
  v_today date;
begin
  if auth.uid() is null or not public.is_staff() or not public.has_permission('attendance', 'edit') then
    raise exception 'Attendance edit permission is required';
  end if;

  select * into v_pass from public.pickup_passes where id = p_pass_id for update;
  if v_pass.id is null
     or v_pass.daycare_id <> public.get_my_daycare_id()
     or v_pass.used_at is not null
     or v_pass.revoked_at is not null
     or v_pass.expires_at <= now() then
    raise exception 'Pass is invalid, expired, or already used';
  end if;
  if not public.can_write_child(v_pass.child_id) then
    raise exception 'This child is outside your assigned classroom';
  end if;
  if v_pass.presenter_profile_id is not null and not exists (
    select 1 from public.parent_children link
     join public.profiles guardian on guardian.id = link.parent_id
     where link.child_id = v_pass.child_id
       and link.parent_id = v_pass.presenter_profile_id
       and link.pickup_authorized and guardian.archived_at is null
  ) then
    raise exception 'This person is no longer authorized';
  end if;
  if v_pass.pickup_id is not null and not exists (
    select 1 from public.child_pickups pickup
     where pickup.id = v_pass.pickup_id
       and pickup.child_id = v_pass.child_id
       and pickup.archived_at is null
  ) then
    raise exception 'This person is no longer authorized';
  end if;

  select coalesce(center.timezone, 'UTC') into v_timezone
    from public.daycares center where center.id = v_pass.daycare_id;
  v_today := (now() at time zone v_timezone)::date;

  select attendance.id into v_attendance_id
    from public.attendance_records attendance
   where attendance.child_id = v_pass.child_id
     and attendance.date = v_today
     and attendance.checked_in_at is not null
     and attendance.checked_out_at is null
     and attendance.status in ('present', 'late')
   for update;
  if v_attendance_id is null then raise exception 'This child is not currently checked in'; end if;

  update public.attendance_records
     set checked_out_at = v_checked_out_at,
         checked_out_by = auth.uid(),
         picked_up_by = v_pass.presenter_name,
         method = 'educator'
   where id = v_attendance_id;

  update public.pickup_passes
     set used_at = v_checked_out_at, used_by = auth.uid()
   where id = v_pass.id;

  update public.pickup_plans
     set status = 'completed', completed_at = v_checked_out_at,
         completed_by = auth.uid()
   where child_id = v_pass.child_id
     and scheduled_on = v_today
     and status = 'expected';

  select child.first_name || ' ' || child.last_name into v_child_name
    from public.children child where child.id = v_pass.child_id;

  perform public.enqueue_child_notification(
    v_pass.child_id,
    'pickup_complete',
    v_child_name || ' was checked out',
    'Released to ' || v_pass.presenter_name || ' at ' ||
      to_char(v_checked_out_at at time zone v_timezone, 'FMHH12:MI AM') || '.',
    jsonb_build_object(
      'type', 'pickup_complete', 'screen', 'ParentHome',
      'childId', v_pass.child_id, 'passId', v_pass.id
    ),
    'pickup-complete:' || v_pass.id,
    array['push']::text[]
  );

  return query select v_pass.child_id, v_child_name, v_pass.presenter_name,
    v_pass.relationship, v_checked_out_at;
end;
$$;

create or replace function public.report_unauthorized_pickup(
  p_child_id uuid,
  p_attempted_name text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_daycare_id uuid;
  v_child_name text;
  v_event_id uuid;
begin
  if auth.uid() is null or not public.is_staff()
     or not public.has_permission('attendance', 'edit')
     or not public.can_write_child(p_child_id) then
    raise exception 'Attendance edit permission is required';
  end if;
  if length(coalesce(btrim(p_attempted_name), '')) > 120
     or length(coalesce(btrim(p_notes), '')) > 1000 then
    raise exception 'Pickup report is too long';
  end if;

  select child.daycare_id, child.first_name || ' ' || child.last_name
    into v_daycare_id, v_child_name
    from public.children child where child.id = p_child_id and child.archived_at is null;
  if v_daycare_id is null or v_daycare_id <> public.get_my_daycare_id() then
    raise exception 'Child not found';
  end if;
  perform public.assert_rate_limit('pickup_security_event', 10, 600, p_child_id::text);

  insert into public.pickup_security_events (
    daycare_id, child_id, attempted_name, notes, reported_by
  ) values (
    v_daycare_id, p_child_id, nullif(btrim(p_attempted_name), ''),
    nullif(btrim(p_notes), ''), auth.uid()
  ) returning id into v_event_id;

  insert into public.notification_outbox (
    daycare_id, recipient_id, channel, kind, title, body, payload, dedupe_key
  )
  select v_daycare_id, admin.id, 'push', 'pickup_security',
         'Pickup authorization alert',
         'An unverified person attempted to pick up ' || v_child_name || '.',
         jsonb_build_object(
           'type', 'pickup_security', 'screen', 'Pickups',
           'childId', p_child_id, 'eventId', v_event_id
         ),
         'pickup-security:' || v_event_id
    from public.profiles admin
   where admin.daycare_id = v_daycare_id
     and admin.role in ('owner_admin', 'admin')
     and admin.archived_at is null
  on conflict do nothing;

  insert into public.notifications (daycare_id, profile_id, kind, title, body, payload)
  select v_daycare_id, admin.id, 'pickup_security',
         'Pickup authorization alert',
         'An unverified person attempted to pick up ' || v_child_name || '.',
         jsonb_build_object(
           'type', 'pickup_security', 'screen', 'Pickups',
           'childId', p_child_id, 'eventId', v_event_id
         )
    from public.profiles admin
   where admin.daycare_id = v_daycare_id
     and admin.role in ('owner_admin', 'admin')
     and admin.archived_at is null;

  return v_event_id;
end;
$$;

revoke all on function public.get_parent_pickup_options(uuid, boolean) from public, anon;
revoke all on function public.parent_add_authorized_pickup(uuid, text, text, text) from public, anon;
revoke all on function public.parent_remove_authorized_pickup(uuid) from public, anon;
revoke all on function public.create_mobile_pickup_pass(uuid, uuid, uuid, timestamptz) from public, anon;
revoke all on function public.get_mobile_today_pickups(uuid) from public, anon;
revoke all on function public.verify_mobile_pickup_pass(text, text, uuid) from public, anon;
revoke all on function public.complete_mobile_pickup(uuid) from public, anon;
revoke all on function public.report_unauthorized_pickup(uuid, text, text) from public, anon;

grant execute on function public.get_parent_pickup_options(uuid, boolean) to authenticated;
grant execute on function public.parent_add_authorized_pickup(uuid, text, text, text) to authenticated;
grant execute on function public.parent_remove_authorized_pickup(uuid) to authenticated;
grant execute on function public.create_mobile_pickup_pass(uuid, uuid, uuid, timestamptz) to authenticated;
grant execute on function public.get_mobile_today_pickups(uuid) to authenticated;
grant execute on function public.verify_mobile_pickup_pass(text, text, uuid) to authenticated;
grant execute on function public.complete_mobile_pickup(uuid) to authenticated;
grant execute on function public.report_unauthorized_pickup(uuid, text, text) to authenticated;
