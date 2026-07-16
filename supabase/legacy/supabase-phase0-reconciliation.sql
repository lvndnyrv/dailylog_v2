-- ============================================================
-- DailyLog — Phase 0 Reconciliation Migration
-- ============================================================
-- Fixes audit findings 3.2 (schema drift), 3.3 (missing RLS write
-- policies), 3.5 (soft delete), 3.6 (server-side profiles for OTP
-- invites), 3.7 (account deletion), 4.3 (multi-classroom RLS),
-- 4.4 (roster N+1 via RPC).
--
-- Run this in the Supabase SQL Editor AFTER:
--   1. supabase-schema.sql
--   2. supabase-week3.sql
--   3. supabase-incidents.sql
--   4. supabase-add-child-photo.sql
-- Safe to re-run (idempotent guards throughout).
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. MISSING COLUMNS
-- ─────────────────────────────────────────────

-- profiles.phone — used by signup, EditProfile, ManageScreen, call-parent
alter table profiles add column if not exists phone text default '';

-- children.archived_at — soft delete (replaces destructive cascade delete)
alter table children add column if not exists archived_at timestamptz;

-- daycares.created_by — lets the onboarding wizard read back the daycare
-- it just created (before profiles.daycare_id is set)
alter table daycares add column if not exists created_by uuid default auth.uid();

-- ─────────────────────────────────────────────
-- 2. MISSING TABLE: educator_classrooms (multi-classroom junction)
-- ─────────────────────────────────────────────

create table if not exists educator_classrooms (
  educator_id uuid references profiles(id) on delete cascade not null,
  classroom_id uuid references classrooms(id) on delete cascade not null,
  created_at timestamptz default now(),
  primary key (educator_id, classroom_id)
);

alter table educator_classrooms enable row level security;

drop policy if exists "Educators manage own classroom links" on educator_classrooms;
create policy "Educators manage own classroom links"
  on educator_classrooms for all
  using (educator_id = auth.uid())
  with check (educator_id = auth.uid());

-- ─────────────────────────────────────────────
-- 3. HELPER: can the current user access this child?
-- ─────────────────────────────────────────────

create or replace function can_access_child(p_child_id uuid)
returns boolean as $$
  select exists(
    select 1 from children c
    where c.id = p_child_id
    and (
      (get_my_role() = 'educator' and c.classroom_id in (
        select id from classrooms where daycare_id = get_my_daycare_id()
      ))
      or
      (get_my_role() = 'parent' and c.id in (
        select child_id from parent_children where parent_id = auth.uid()
      ))
    )
  )
$$ language sql security definer stable;

-- ─────────────────────────────────────────────
-- 4. MISSING TABLE: messages (parent ↔ educator chat)
-- ─────────────────────────────────────────────

create table if not exists messages (
  id uuid primary key default uuid_generate_v4(),
  child_id uuid references children(id) on delete cascade not null,
  sender_id uuid references profiles(id) on delete set null,
  body text not null,
  read_at timestamptz, -- reserved for Phase 3 educator inbox
  created_at timestamptz default now()
);

create index if not exists messages_child_created_idx on messages (child_id, created_at);

alter table messages enable row level security;

drop policy if exists "Chat participants read messages" on messages;
create policy "Chat participants read messages"
  on messages for select using (can_access_child(child_id));

drop policy if exists "Chat participants send messages" on messages;
create policy "Chat participants send messages"
  on messages for insert
  with check (sender_id = auth.uid() and can_access_child(child_id));

drop policy if exists "Chat participants mark read" on messages;
create policy "Chat participants mark read"
  on messages for update using (can_access_child(child_id));

do $$ begin
  alter publication supabase_realtime add table messages;
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────
-- 5. MISSING TABLE: photos (+ daily-log-photos bucket)
-- ─────────────────────────────────────────────

create table if not exists photos (
  id uuid primary key default uuid_generate_v4(),
  daily_log_id uuid references daily_logs(id) on delete cascade not null,
  uploader_id uuid references profiles(id) on delete set null,
  storage_path text not null,
  created_at timestamptz default now()
);

create index if not exists photos_log_idx on photos (daily_log_id);

alter table photos enable row level security;

drop policy if exists "Read log photos" on photos;
create policy "Read log photos"
  on photos for select using (can_access_log(daily_log_id));

drop policy if exists "Educators add log photos" on photos;
create policy "Educators add log photos"
  on photos for insert
  with check (get_my_role() = 'educator' and can_access_log(daily_log_id));

drop policy if exists "Educators delete log photos" on photos;
create policy "Educators delete log photos"
  on photos for delete
  using (get_my_role() = 'educator' and can_access_log(daily_log_id));

do $$ begin
  alter publication supabase_realtime add table photos;
exception when duplicate_object then null; end $$;

insert into storage.buckets (id, name, public)
values ('daily-log-photos', 'daily-log-photos', false)
on conflict (id) do nothing;

-- Storage path convention: {childId}/{logId}/{timestamp}.jpg
drop policy if exists "Educators upload daily log photos" on storage.objects;
create policy "Educators upload daily log photos"
  on storage.objects for insert
  with check (bucket_id = 'daily-log-photos' and get_my_role() = 'educator');

drop policy if exists "Educators delete daily log photos" on storage.objects;
create policy "Educators delete daily log photos"
  on storage.objects for delete
  using (bucket_id = 'daily-log-photos' and get_my_role() = 'educator');

drop policy if exists "Linked users view daily log photos" on storage.objects;
create policy "Linked users view daily log photos"
  on storage.objects for select
  using (
    bucket_id = 'daily-log-photos'
    and (
      get_my_role() = 'educator'
      or exists (
        select 1 from parent_children pc
        where pc.parent_id = auth.uid()
        and pc.child_id::text = (storage.foldername(name))[1]
      )
    )
  );

-- ─────────────────────────────────────────────
-- 6. RLS WRITE POLICIES for core flows
--    (signup, onboarding, add child, invite parent)
-- ─────────────────────────────────────────────

-- PROFILES: users may create their own row (fallback path; the
-- auth trigger in §7 is the primary path)
drop policy if exists "Users can insert own profile" on profiles;
create policy "Users can insert own profile"
  on profiles for insert with check (id = auth.uid());

-- DAYCARES: educators create; creators & members can read; members update
drop policy if exists "Educators can create daycares" on daycares;
create policy "Educators can create daycares"
  on daycares for insert
  with check (get_my_role() = 'educator' and created_by = auth.uid());

drop policy if exists "Creators can view their daycare" on daycares;
create policy "Creators can view their daycare"
  on daycares for select using (created_by = auth.uid());

drop policy if exists "Educators can update own daycare" on daycares;
create policy "Educators can update own daycare"
  on daycares for update
  using (get_my_role() = 'educator' and (id = get_my_daycare_id() or created_by = auth.uid()));

-- CLASSROOMS: educators of the daycare create/update/delete;
-- creators can read during the onboarding window
drop policy if exists "Educators can create classrooms" on classrooms;
create policy "Educators can create classrooms"
  on classrooms for insert
  with check (
    get_my_role() = 'educator'
    and (
      daycare_id = get_my_daycare_id()
      or daycare_id in (select id from daycares where created_by = auth.uid())
    )
  );

drop policy if exists "Daycare creators can view classrooms" on classrooms;
create policy "Daycare creators can view classrooms"
  on classrooms for select
  using (daycare_id in (select id from daycares where created_by = auth.uid()));

drop policy if exists "Educators can update classrooms" on classrooms;
create policy "Educators can update classrooms"
  on classrooms for update
  using (get_my_role() = 'educator' and daycare_id = get_my_daycare_id());

drop policy if exists "Educators can delete classrooms" on classrooms;
create policy "Educators can delete classrooms"
  on classrooms for delete
  using (get_my_role() = 'educator' and daycare_id = get_my_daycare_id());

-- CHILDREN: daycare-wide educator read/insert/update
-- (fixes multi-classroom mismatch: switching rooms, moving children)
drop policy if exists "Daycare educators see children" on children;
create policy "Daycare educators see children"
  on children for select
  using (
    get_my_role() = 'educator'
    and classroom_id in (select id from classrooms where daycare_id = get_my_daycare_id())
  );

drop policy if exists "Educators can add children" on children;
create policy "Educators can add children"
  on children for insert
  with check (
    get_my_role() = 'educator'
    and classroom_id in (select id from classrooms where daycare_id = get_my_daycare_id())
  );

drop policy if exists "Educators can update children" on children;
create policy "Educators can update children"
  on children for update
  using (
    get_my_role() = 'educator'
    and classroom_id in (select id from classrooms where daycare_id = get_my_daycare_id())
  );

-- PARENT_CHILDREN: educators link/unlink parents for their daycare's children
drop policy if exists "Educators can link parents" on parent_children;
create policy "Educators can link parents"
  on parent_children for insert
  with check (
    get_my_role() = 'educator'
    and child_id in (
      select c.id from children c
      join classrooms cl on cl.id = c.classroom_id
      where cl.daycare_id = get_my_daycare_id()
    )
  );

drop policy if exists "Educators can unlink parents" on parent_children;
create policy "Educators can unlink parents"
  on parent_children for delete
  using (
    get_my_role() = 'educator'
    and child_id in (
      select c.id from children c
      join classrooms cl on cl.id = c.classroom_id
      where cl.daycare_id = get_my_daycare_id()
    )
  );

drop policy if exists "Parents can unlink themselves" on parent_children;
create policy "Parents can unlink themselves"
  on parent_children for delete using (parent_id = auth.uid());

-- DAILY LOGS: daycare-wide educator access (multi-classroom fix)
drop policy if exists "Daycare educators read logs" on daily_logs;
create policy "Daycare educators read logs"
  on daily_logs for select
  using (
    get_my_role() = 'educator'
    and child_id in (
      select c.id from children c
      join classrooms cl on cl.id = c.classroom_id
      where cl.daycare_id = get_my_daycare_id()
    )
  );

drop policy if exists "Daycare educators create logs" on daily_logs;
create policy "Daycare educators create logs"
  on daily_logs for insert
  with check (
    get_my_role() = 'educator'
    and child_id in (
      select c.id from children c
      join classrooms cl on cl.id = c.classroom_id
      where cl.daycare_id = get_my_daycare_id()
    )
  );

drop policy if exists "Daycare educators update logs" on daily_logs;
create policy "Daycare educators update logs"
  on daily_logs for update
  using (
    get_my_role() = 'educator'
    and child_id in (
      select c.id from children c
      join classrooms cl on cl.id = c.classroom_id
      where cl.daycare_id = get_my_daycare_id()
    )
  );

-- ─────────────────────────────────────────────
-- 7. SERVER-SIDE PROFILE CREATION (auth trigger)
--    Fixes OTP-invited parents (no profile row) and processes
--    pending_child_id metadata to auto-link parent → child.
-- ─────────────────────────────────────────────

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_role  text;
  v_name  text;
  v_phone text;
  v_child uuid;
begin
  v_role := coalesce(new.raw_user_meta_data->>'role', 'parent');
  if v_role not in ('educator', 'parent', 'admin') then
    v_role := 'parent';
  end if;

  v_name  := coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1));
  v_phone := coalesce(new.raw_user_meta_data->>'phone', '');

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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ─────────────────────────────────────────────
-- 8. FIX delete_my_account — also remove the auth.users row so
--    deleted users cannot log back into a profile-less account
-- ─────────────────────────────────────────────

create or replace function delete_my_account()
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  delete from parent_children where parent_id = uid;
  delete from profiles where id = uid;
  delete from auth.users where id = uid;
end;
$$;

-- ─────────────────────────────────────────────
-- 9. ROSTER STATUS RPC — kills the 3-queries-per-child N+1.
--    SECURITY INVOKER so all RLS policies still apply.
-- ─────────────────────────────────────────────

create or replace function get_classroom_log_status(p_classroom_id uuid, p_date date)
returns table (
  child_id uuid,
  log_id uuid,
  sent boolean,
  moods text[],
  entry_count bigint
)
language sql
stable
as $$
  select
    c.id as child_id,
    dl.id as log_id,
    coalesce(dl.sent_to_parents, false) as sent,
    dl.moods,
    coalesce((select count(*) from meal_entries m where m.daily_log_id = dl.id), 0)
    + coalesce((select count(*) from diaper_entries d where d.daily_log_id = dl.id), 0)
    + coalesce((select count(*) from activity_entries a where a.daily_log_id = dl.id), 0)
    as entry_count
  from children c
  left join daily_logs dl on dl.child_id = c.id and dl.log_date = p_date
  where c.classroom_id = p_classroom_id
    and c.archived_at is null;
$$;

-- ─────────────────────────────────────────────
-- 10. BACKFILL — seed educator_classrooms from existing profiles
-- ─────────────────────────────────────────────

insert into educator_classrooms (educator_id, classroom_id)
select id, classroom_id from profiles
where role = 'educator' and classroom_id is not null
on conflict do nothing;

