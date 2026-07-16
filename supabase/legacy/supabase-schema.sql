-- ============================================
-- DailyLog — Supabase Database Schema
-- ============================================
-- Run this in Supabase SQL Editor (supabase.com > your project > SQL Editor)
-- This creates all tables, row-level security policies, and helper functions.

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- ============================================
-- TABLES
-- ============================================

-- Daycare center
create table daycares (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  address text,
  phone text,
  created_at timestamptz default now()
);

-- Classroom within a daycare
create table classrooms (
  id uuid primary key default uuid_generate_v4(),
  daycare_id uuid references daycares(id) on delete cascade not null,
  name text not null,
  age_group text, -- e.g. 'Infant', 'Toddler', 'Preschool'
  created_at timestamptz default now()
);

-- User profiles (extends Supabase auth.users)
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null,
  role text not null check (role in ('educator', 'parent', 'admin')),
  daycare_id uuid references daycares(id) on delete set null,
  classroom_id uuid references classrooms(id) on delete set null, -- for educators
  created_at timestamptz default now()
);

-- Children enrolled in the daycare
create table children (
  id uuid primary key default uuid_generate_v4(),
  classroom_id uuid references classrooms(id) on delete cascade not null,
  first_name text not null,
  last_name text not null,
  date_of_birth date,
  created_at timestamptz default now()
);

-- Link parents to children (many-to-many)
create table parent_children (
  parent_id uuid references profiles(id) on delete cascade not null,
  child_id uuid references children(id) on delete cascade not null,
  consent_given_at timestamptz, -- COPPA/PIPEDA consent timestamp
  primary key (parent_id, child_id)
);

-- Daily log (one per child per day)
create table daily_logs (
  id uuid primary key default uuid_generate_v4(),
  child_id uuid references children(id) on delete cascade not null,
  educator_id uuid references profiles(id) on delete set null,
  log_date date not null default current_date,
  moods text[] default '{}', -- array of mood strings
  notes text default '',
  comments text default '', -- comments for parents
  sent_to_parents boolean default false,
  sent_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(child_id, log_date) -- one log per child per day
);

-- Meal entries within a daily log
create table meal_entries (
  id uuid primary key default uuid_generate_v4(),
  daily_log_id uuid references daily_logs(id) on delete cascade not null,
  time time not null,
  food_type text not null,
  amount text not null check (amount in ('all', 'some', 'none')),
  created_at timestamptz default now()
);

-- Diaper/toilet entries within a daily log
create table diaper_entries (
  id uuid primary key default uuid_generate_v4(),
  daily_log_id uuid references daily_logs(id) on delete cascade not null,
  time time not null,
  type text not null check (type in ('diaper', 'toilet')),
  wet boolean default false,
  bm boolean default false, -- bowel movement
  created_at timestamptz default now()
);

-- Sleep entries within a daily log
create table sleep_entries (
  id uuid primary key default uuid_generate_v4(),
  daily_log_id uuid references daily_logs(id) on delete cascade not null,
  start_time time not null,
  end_time time,
  created_at timestamptz default now()
);

-- Activities logged for the day
create table activity_entries (
  id uuid primary key default uuid_generate_v4(),
  daily_log_id uuid references daily_logs(id) on delete cascade not null,
  activity_name text not null,
  created_at timestamptz default now()
);

-- Supply requests (please bring more)
create table supply_requests (
  id uuid primary key default uuid_generate_v4(),
  daily_log_id uuid references daily_logs(id) on delete cascade not null,
  item_name text not null,
  created_at timestamptz default now()
);

-- ============================================
-- AUTO-UPDATE TIMESTAMP
-- ============================================

create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger daily_logs_updated_at
  before update on daily_logs
  for each row execute function update_updated_at();

-- ============================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================

alter table daycares enable row level security;
alter table classrooms enable row level security;
alter table profiles enable row level security;
alter table children enable row level security;
alter table parent_children enable row level security;
alter table daily_logs enable row level security;
alter table meal_entries enable row level security;
alter table diaper_entries enable row level security;
alter table sleep_entries enable row level security;
alter table activity_entries enable row level security;
alter table supply_requests enable row level security;

-- Helper: get current user's profile
create or replace function get_my_role()
returns text as $$
  select role from profiles where id = auth.uid()
$$ language sql security definer stable;

create or replace function get_my_daycare_id()
returns uuid as $$
  select daycare_id from profiles where id = auth.uid()
$$ language sql security definer stable;

create or replace function get_my_classroom_id()
returns uuid as $$
  select classroom_id from profiles where id = auth.uid()
$$ language sql security definer stable;

-- PROFILES: users can read their own profile, admins can read all in their daycare
create policy "Users can view own profile"
  on profiles for select using (id = auth.uid());

create policy "Admins can view profiles in their daycare"
  on profiles for select using (
    get_my_role() = 'admin' and daycare_id = get_my_daycare_id()
  );

create policy "Users can update own profile"
  on profiles for update using (id = auth.uid());

-- DAYCARES: visible to members
create policy "Daycare visible to members"
  on daycares for select using (id = get_my_daycare_id());

-- CLASSROOMS: visible to daycare members
create policy "Classrooms visible to daycare members"
  on classrooms for select using (daycare_id = get_my_daycare_id());

-- CHILDREN: educators see their classroom, parents see their linked children
create policy "Educators see classroom children"
  on children for select using (
    get_my_role() = 'educator' and classroom_id = get_my_classroom_id()
  );

create policy "Parents see linked children"
  on children for select using (
    get_my_role() = 'parent' and id in (
      select child_id from parent_children where parent_id = auth.uid()
    )
  );

create policy "Admins see all children in daycare"
  on children for select using (
    get_my_role() = 'admin' and classroom_id in (
      select id from classrooms where daycare_id = get_my_daycare_id()
    )
  );

-- PARENT_CHILDREN: parents see their own links
create policy "Parents see own links"
  on parent_children for select using (parent_id = auth.uid());

create policy "Parents can update consent"
  on parent_children for update using (parent_id = auth.uid());

-- DAILY LOGS: educators CRUD their classroom, parents read their children
create policy "Educators read classroom logs"
  on daily_logs for select using (
    get_my_role() = 'educator' and child_id in (
      select id from children where classroom_id = get_my_classroom_id()
    )
  );

create policy "Educators create logs"
  on daily_logs for insert with check (
    get_my_role() = 'educator' and child_id in (
      select id from children where classroom_id = get_my_classroom_id()
    )
  );

create policy "Educators update logs"
  on daily_logs for update using (
    get_my_role() = 'educator' and child_id in (
      select id from children where classroom_id = get_my_classroom_id()
    )
  );

create policy "Parents read their children logs"
  on daily_logs for select using (
    get_my_role() = 'parent' and child_id in (
      select child_id from parent_children where parent_id = auth.uid()
    )
  );

-- ENTRY TABLES: same logic — educators CRUD via log ownership, parents read
-- (Using a helper to check log access)

create or replace function can_access_log(log_id uuid)
returns boolean as $$
  select exists(
    select 1 from daily_logs dl
    join children c on c.id = dl.child_id
    where dl.id = log_id
    and (
      (get_my_role() = 'educator' and c.classroom_id = get_my_classroom_id())
      or
      (get_my_role() = 'parent' and c.id in (
        select child_id from parent_children where parent_id = auth.uid()
      ))
    )
  )
$$ language sql security definer stable;

-- Apply to all entry tables
do $$
declare
  tbl text;
begin
  for tbl in select unnest(array[
    'meal_entries', 'diaper_entries', 'sleep_entries',
    'activity_entries', 'supply_requests'
  ]) loop
    execute format('
      create policy "Read entries" on %I for select
        using (can_access_log(daily_log_id));
      create policy "Create entries" on %I for insert
        with check (get_my_role() = ''educator'' and can_access_log(daily_log_id));
      create policy "Update entries" on %I for update
        using (get_my_role() = ''educator'' and can_access_log(daily_log_id));
      create policy "Delete entries" on %I for delete
        using (get_my_role() = ''educator'' and can_access_log(daily_log_id));
    ', tbl, tbl, tbl, tbl);
  end loop;
end $$;

-- ============================================
-- REAL-TIME SUBSCRIPTIONS
-- ============================================
-- Enable real-time for tables parents need to see update live

alter publication supabase_realtime add table daily_logs;
alter publication supabase_realtime add table meal_entries;
alter publication supabase_realtime add table diaper_entries;
alter publication supabase_realtime add table sleep_entries;
alter publication supabase_realtime add table activity_entries;
alter publication supabase_realtime add table supply_requests;

-- ============================================
-- ACCOUNT DELETION (COPPA / PIPEDA / App Store)
-- ============================================
-- Cascade delete: removing a profile removes all linked data

create or replace function delete_my_account()
returns void as $$
begin
  -- Remove parent-child links (cascades consent records)
  delete from parent_children where parent_id = auth.uid();

  -- Remove profile (auth.users cleanup handled by Supabase)
  delete from profiles where id = auth.uid();

  -- Note: if this user is an educator, their daily_logs keep
  -- educator_id as null (ON DELETE SET NULL) so historical
  -- records aren't lost for other parents.
end;
$$ language plpgsql security definer;

-- ============================================
-- SEED DATA (for your pilot daycare)
-- ============================================
-- Uncomment and customize when you're ready to onboard Smart Kid

/*
insert into daycares (id, name, address, phone) values
  ('11111111-1111-1111-1111-111111111111', 'Smart Kid South Newmarket', 'South Newmarket, ON', '905-555-0100');

insert into classrooms (id, daycare_id, name, age_group) values
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Room 1', 'Toddler');

-- Children are added via the app UI or here:
-- insert into children (classroom_id, first_name, last_name, date_of_birth) values
--   ('22222222-2222-2222-2222-222222222222', 'David', 'Smith', '2023-03-15'),
--   ('22222222-2222-2222-2222-222222222222', 'Diana', 'Smith', '2024-01-10');
*/
