-- ============================================================
-- DailyLog — Daycare Activation Codes (sales-led center creation)
-- ============================================================
-- Directors can no longer freely create centers. Flow:
--   1. Your ops team sells a subscription and generates an
--      activation code (see §4 operator helper below).
--   2. Director enters the code on the "Set up your center" signup.
--   3. handle_new_user() honors role='admin' ONLY with a valid,
--      unused, unexpired code — and consumes it (one code = one center).
--   4. Forged signUp calls with role='admin' but no valid code are
--      silently downgraded to 'parent'.
--
-- Combined with supabase-staff-invites.sql this means:
--   parent   → public self-signup (free)
--   educator → admin email invite only
--   admin    → paid activation code only
--
-- Run AFTER supabase-staff-invites.sql. Idempotent.
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. ACTIVATION CODES TABLE
--    No RLS policies for app users on purpose: only the service
--    role / SQL editor manages codes. The RPC + trigger below are
--    SECURITY DEFINER so they can read it.
-- ─────────────────────────────────────────────
create table if not exists daycare_signup_codes (
  id uuid primary key default uuid_generate_v4(),
  code text unique not null,
  note text,                          -- e.g. "Smart Kid Newmarket — invoice #1042"
  created_at timestamptz default now(),
  expires_at timestamptz,             -- optional (null = never expires)
  used_at timestamptz,
  used_by uuid references profiles(id) on delete set null
);

alter table daycare_signup_codes enable row level security;
-- (no policies → invisible to authenticated/anon; service role bypasses RLS)

-- ─────────────────────────────────────────────
-- 2. PUBLIC RPC: pre-validate a code at signup (boolean only)
--    Callable before auth exists so the form can show inline errors.
-- ─────────────────────────────────────────────
create or replace function check_daycare_signup_code(p_code text)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists(
    select 1 from daycare_signup_codes
    where upper(code) = upper(trim(p_code))
      and used_at is null
      and (expires_at is null or expires_at > now())
  );
$$;

-- ─────────────────────────────────────────────
-- 3. HARDENED handle_new_user — code-gated admin role
--    (extends the staff-invite version: educator needs an invite,
--     admin needs an activation code, everyone else is a parent)
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
  v_code    daycare_signup_codes%rowtype;
begin
  v_role := coalesce(new.raw_user_meta_data->>'role', 'parent');
  if v_role not in ('educator', 'parent', 'admin') then
    v_role := 'parent';
  end if;

  v_name  := coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1));
  v_phone := coalesce(new.raw_user_meta_data->>'phone', '');

  -- ── Staff invite path (educators, or admin seats invited by an admin) ──
  select * into v_invite
  from staff_invites
  where lower(email) = lower(new.email) and consumed_at is null
  order by created_at desc
  limit 1;

  if v_invite.id is not null then
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

  -- ── Director path: role='admin' requires a valid activation code ──
  if v_role = 'admin' then
    select * into v_code
    from daycare_signup_codes
    where upper(code) = upper(trim(coalesce(new.raw_user_meta_data->>'activation_code', '')))
      and used_at is null
      and (expires_at is null or expires_at > now());

    if v_code.id is null then
      v_role := 'parent';  -- no valid code → downgrade
    end if;
  end if;

  -- ── Educator without invite → downgrade ──
  if v_role = 'educator' then
    v_role := 'parent';
  end if;

  insert into profiles (id, email, full_name, role, phone)
  values (new.id, new.email, v_name, v_role, v_phone)
  on conflict (id) do nothing;

  -- Consume the activation code AFTER profile creation (FK on used_by)
  if v_role = 'admin' and v_code.id is not null then
    update daycare_signup_codes
    set used_at = now(), used_by = new.id
    where id = v_code.id;
  end if;

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

-- ─────────────────────────────────────────────
-- 4. OPERATOR HELPER — generate codes from the SQL editor
--    (run with service role; returns the plaintext codes to hand
--     to the customer after payment)
--
--    Example:
--      select * from create_daycare_signup_codes(1, 'Smart Kid Newmarket — invoice #1042', now() + interval '30 days');
-- ─────────────────────────────────────────────
create or replace function create_daycare_signup_codes(
  p_count int default 1,
  p_note text default null,
  p_expires_at timestamptz default null
)
returns table(code text)
language plpgsql
as $$
declare
  i int;
  v_code text;
begin
  for i in 1..greatest(p_count, 1) loop
    -- 8-char human-typable code (no 0/O/1/I ambiguity)
    v_code := (
      select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (random() * 31)::int + 1, 1), '')
      from generate_series(1, 8)
    );
    insert into daycare_signup_codes (code, note, expires_at)
    values (v_code, p_note, p_expires_at);
    code := v_code;
    return next;
  end loop;
end;
$$;

-- Keep this helper away from app users (SQL editor / service role only)
revoke execute on function create_daycare_signup_codes(int, text, timestamptz) from public, anon, authenticated;

-- ─────────────────────────────────────────────
-- 5. TIGHTEN DAYCARE CREATION — activated admins only, one center
--    per admin (educators lost their legacy create path; their
--    onboarding no longer offers it and invites pre-link them)
-- ─────────────────────────────────────────────
-- Drop both old and newer names so this migration can be rerun safely.
drop policy if exists "Educators can create daycares" on daycares;
drop policy if exists "Staff can create daycares" on daycares;
create policy "Activated admins can create their daycare"
  on daycares for insert
  with check (
    get_my_role() = 'admin'
    and created_by = auth.uid()
    and get_my_daycare_id() is null   -- one center per admin account
  );

-- Keep update/create policies idempotent if staff-invites migration already ran.
drop policy if exists "Educators can update own daycare" on daycares;
drop policy if exists "Staff can update own daycare" on daycares;
create policy "Staff can update own daycare"
  on daycares for update
  using (
    get_my_role() in ('educator', 'admin')
    and (id = get_my_daycare_id() or created_by = auth.uid())
  );

drop policy if exists "Educators can create classrooms" on classrooms;
drop policy if exists "Staff can create classrooms" on classrooms;
create policy "Staff can create classrooms"
  on classrooms for insert
  with check (
    get_my_role() in ('educator', 'admin')
    and (
      daycare_id = get_my_daycare_id()
      or daycare_id in (select id from daycares where created_by = auth.uid())
    )
  );
