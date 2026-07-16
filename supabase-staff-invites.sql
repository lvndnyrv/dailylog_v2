-- ============================================================
-- DailyLog — Staff Invites (admin-controlled educator signup)
-- ============================================================
-- Educators can NO LONGER self-register. Flow:
--   1. Admin creates an invite (email + optional classroom).
--   2. Admin's client sends a magic-link email (signInWithOtp).
--   3. handle_new_user() honors role='educator' ONLY if a matching
--      un-consumed invite exists — and copies daycare/classroom
--      from the invite (authoritative, server-side).
--   4. Forged signUp calls with role='educator' but no invite are
--      silently downgraded to 'parent'.
--
-- Directors (role='admin') may still self-serve sign up: a fresh
-- admin has no daycare_id and controls nothing until they create
-- their own daycare — the standard SaaS trial funnel.
--
-- Run AFTER supabase-onboarding.sql. Idempotent.
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. STAFF INVITES TABLE
-- ─────────────────────────────────────────────
create table if not exists staff_invites (
  id uuid primary key default uuid_generate_v4(),
  email text not null,
  role text not null default 'educator' check (role in ('educator', 'admin')),
  daycare_id uuid not null references daycares(id) on delete cascade,
  classroom_id uuid references classrooms(id) on delete set null,
  invited_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now(),
  consumed_at timestamptz
);

-- One live invite per email (case-insensitive)
create unique index if not exists staff_invites_email_live_idx
  on staff_invites (lower(email)) where consumed_at is null;

alter table staff_invites enable row level security;

drop policy if exists "Admins manage staff invites" on staff_invites;
create policy "Admins manage staff invites"
  on staff_invites for all
  using (get_my_role() = 'admin' and daycare_id = get_my_daycare_id())
  with check (get_my_role() = 'admin' and daycare_id = get_my_daycare_id());

-- ─────────────────────────────────────────────
-- 2. RPC: admin creates (or refreshes) an invite
-- ─────────────────────────────────────────────
create or replace function invite_staff(p_email text, p_role text default 'educator', p_classroom_id uuid default null)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_invite_id uuid;
  v_daycare uuid;
begin
  if get_my_role() <> 'admin' then
    raise exception 'Only admins can invite staff';
  end if;
  v_daycare := get_my_daycare_id();
  if v_daycare is null then
    raise exception 'Create your daycare before inviting staff';
  end if;
  if p_role not in ('educator', 'admin') then
    raise exception 'Invalid role';
  end if;
  if coalesce(trim(p_email), '') = '' then
    raise exception 'Email is required';
  end if;
  if p_classroom_id is not null and not exists (
    select 1 from classrooms where id = p_classroom_id and daycare_id = v_daycare
  ) then
    raise exception 'Classroom not found in your daycare';
  end if;

  -- Refresh any live invite for this email
  delete from staff_invites
  where lower(email) = lower(trim(p_email)) and consumed_at is null;

  insert into staff_invites (email, role, daycare_id, classroom_id, invited_by)
  values (lower(trim(p_email)), p_role, v_daycare, p_classroom_id, auth.uid())
  returning id into v_invite_id;

  return v_invite_id;
end;
$$;

-- ─────────────────────────────────────────────
-- 3. HARDENED handle_new_user — invite-gated educator role
-- ─────────────────────────────────────────────
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_role    text;
  v_name    text;
  v_phone   text;
  v_child   uuid;
  v_invite  staff_invites%rowtype;
begin
  v_role := coalesce(new.raw_user_meta_data->>'role', 'parent');
  if v_role not in ('educator', 'parent', 'admin') then
    v_role := 'parent';
  end if;

  v_name  := coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1));
  v_phone := coalesce(new.raw_user_meta_data->>'phone', '');

  -- Look up a live staff invite for this email
  select * into v_invite
  from staff_invites
  where lower(email) = lower(new.email) and consumed_at is null
  order by created_at desc
  limit 1;

  if v_invite.id is not null then
    -- Invited staff: role/daycare/classroom come from the invite (authoritative)
    insert into profiles (id, email, full_name, role, phone, daycare_id, classroom_id)
    values (new.id, new.email, v_name, v_invite.role, v_phone, v_invite.daycare_id, v_invite.classroom_id)
    on conflict (id) do nothing;

    update staff_invites set consumed_at = now() where id = v_invite.id;

    if v_invite.classroom_id is not null then
      insert into educator_classrooms (educator_id, classroom_id)
      values (new.id, v_invite.classroom_id)
      on conflict do nothing;
    end if;

    return new;
  end if;

  -- No invite: educator self-registration is BLOCKED → downgrade to parent.
  -- (Directors may self-register as admin: they control nothing until
  --  they create their own daycare.)
  if v_role = 'educator' then
    v_role := 'parent';
  end if;

  insert into profiles (id, email, full_name, role, phone)
  values (new.id, new.email, v_name, v_role, v_phone)
  on conflict (id) do nothing;

  -- Auto-link invited parents to their child
  begin
    v_child := nullif(new.raw_user_meta_data->>'pending_child_id', '')::uuid;
  exception when others then
    v_child := null;
  end;

  if v_child is not null and v_role = 'parent' then
    insert into parent_children (parent_id, child_id)
    values (new.id, v_child)
    on conflict do nothing;
  end if;

  return new;
end;
$$;

-- (Trigger on_auth_user_created already points at handle_new_user.)

-- ─────────────────────────────────────────────
-- 4. LOCK DOWN join_daycare_with_code — staff only
--    (prevents parents from attaching themselves to a daycare
--     and reading daycare-wide announcements)
-- ─────────────────────────────────────────────
create or replace function join_daycare_with_code(p_code text)
returns table(daycare_id uuid, daycare_name text)
language plpgsql
security definer set search_path = public
as $$
declare
  v_daycare daycares%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if get_my_role() not in ('educator', 'admin') then
    raise exception 'Only staff accounts can join a daycare by code';
  end if;

  select * into v_daycare
  from daycares
  where upper(invite_code) = upper(trim(p_code));

  if v_daycare.id is null then
    raise exception 'Invalid invite code. Double-check with your daycare admin.';
  end if;

  update profiles set daycare_id = v_daycare.id where id = auth.uid();

  return query select v_daycare.id, v_daycare.name;
end;
$$;

-- ─────────────────────────────────────────────
-- 5. DIRECTOR ONBOARDING — let admins create their daycare
--    (Phase-0 policies were educator-only; the director flow
--     signs up as admin and creates the daycare + first room.)
-- ─────────────────────────────────────────────
drop policy if exists "Educators can create daycares" on daycares;
create policy "Staff can create daycares"
  on daycares for insert
  with check (get_my_role() in ('educator', 'admin') and created_by = auth.uid());

drop policy if exists "Educators can update own daycare" on daycares;
create policy "Staff can update own daycare"
  on daycares for update
  using (
    get_my_role() in ('educator', 'admin')
    and (id = get_my_daycare_id() or created_by = auth.uid())
  );

drop policy if exists "Educators can create classrooms" on classrooms;
create policy "Staff can create classrooms"
  on classrooms for insert
  with check (
    get_my_role() in ('educator', 'admin')
    and (
      daycare_id = get_my_daycare_id()
      or daycare_id in (select id from daycares where created_by = auth.uid())
    )
  );


