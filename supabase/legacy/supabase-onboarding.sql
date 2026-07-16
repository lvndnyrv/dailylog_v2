-- ============================================================
-- DailyLog — Onboarding & Invite Codes + App Config
-- ============================================================
-- 1. Daycare invite codes  → educators JOIN an existing daycare
--    instead of creating duplicates.
-- 2. Child invite codes    → parents self-link with a code from
--    the educator (Brightwheel-style).
-- 3. app_config            → force-update / minimum version gate.
-- Run in Supabase SQL Editor. Idempotent.
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. INVITE CODE COLUMNS
-- ─────────────────────────────────────────────

-- Short, human-typable codes (e.g. "K7PM3Q")
create or replace function generate_invite_code()
returns text as $$
  select string_agg(
    substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (random() * 31)::int + 1, 1), ''
  ) from generate_series(1, 6)
$$ language sql volatile;

alter table daycares add column if not exists invite_code text unique;
alter table children add column if not exists invite_code text unique;

-- Backfill codes for existing rows
update daycares set invite_code = generate_invite_code() where invite_code is null;
update children set invite_code = generate_invite_code() where invite_code is null;

-- Auto-generate on insert
create or replace function set_invite_code()
returns trigger as $$
begin
  if new.invite_code is null then
    new.invite_code := generate_invite_code();
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists daycares_invite_code on daycares;
create trigger daycares_invite_code before insert on daycares
  for each row execute function set_invite_code();

drop trigger if exists children_invite_code on children;
create trigger children_invite_code before insert on children
  for each row execute function set_invite_code();

-- ─────────────────────────────────────────────
-- 2. RPC: educator joins an existing daycare by code
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
-- 3. RPC: parent links a child by code
-- ─────────────────────────────────────────────
create or replace function link_child_with_code(p_code text)
returns table(child_id uuid, child_name text)
language plpgsql
security definer set search_path = public
as $$
declare
  v_child children%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_child
  from children
  where upper(invite_code) = upper(trim(p_code))
    and archived_at is null;

  if v_child.id is null then
    raise exception 'Invalid child code. Ask your educator for the correct code.';
  end if;

  insert into parent_children (parent_id, child_id)
  values (auth.uid(), v_child.id)
  on conflict do nothing;

  return query select v_child.id, v_child.first_name;
end;
$$;

-- ─────────────────────────────────────────────
-- 4. RPC: list classrooms of a daycare (for join-flow room pick,
--    before profile.daycare_id is committed client-side)
-- ─────────────────────────────────────────────
create or replace function get_daycare_classrooms(p_daycare_id uuid)
returns table(id uuid, name text, age_group text)
language sql
security definer set search_path = public
stable
as $$
  select c.id, c.name, c.age_group
  from classrooms c
  join profiles p on p.id = auth.uid()
  where c.daycare_id = p_daycare_id
    and p.daycare_id = p_daycare_id  -- caller must already belong
  order by c.name;
$$;

-- ─────────────────────────────────────────────
-- 5. APP CONFIG (force-update gate)
-- ─────────────────────────────────────────────
create table if not exists app_config (
  key text primary key,
  value text not null,
  updated_at timestamptz default now()
);

alter table app_config enable row level security;

drop policy if exists "Anyone can read app config" on app_config;
create policy "Anyone can read app config"
  on app_config for select
  using (true);

-- Seed: minimum supported client version (semver). Update to force upgrades.
insert into app_config (key, value) values ('min_app_version', '1.0.0')
on conflict (key) do nothing;

