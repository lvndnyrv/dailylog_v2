-- ============================================
-- DailyLog — Attendance Records Table
-- ============================================
-- Run this in Supabase SQL Editor to create the attendance_records table.
-- This enables the check-in/check-out tracking on the educator roster.

-- ─────────────────────────────────────────────
-- TABLE: attendance_records
-- ─────────────────────────────────────────────

create table if not exists attendance_records (
  id uuid primary key default uuid_generate_v4(),
  child_id uuid references children(id) on delete cascade not null,
  date date not null default current_date,
  checked_in_at timestamptz,
  checked_in_by uuid references profiles(id) on delete set null,
  checked_out_at timestamptz,
  checked_out_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now(),

  -- One record per child per day
  constraint attendance_records_child_date_unique unique (child_id, date)
);

-- Index for fast lookups by child + date
create index if not exists attendance_records_child_date_idx
  on attendance_records (child_id, date);

-- Index for classroom-wide queries (join through children table)
create index if not exists attendance_records_date_idx
  on attendance_records (date);

-- ─────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────

alter table attendance_records enable row level security;

-- Educators and admins in the same daycare can read attendance
drop policy if exists "Educators read attendance" on attendance_records;
create policy "Educators read attendance"
  on attendance_records for select
  using (can_access_child(child_id));

-- Educators and admins can create attendance records
drop policy if exists "Educators create attendance" on attendance_records;
create policy "Educators create attendance"
  on attendance_records for insert
  with check (can_access_child(child_id));

-- Educators and admins can update attendance (check-in/out times)
drop policy if exists "Educators update attendance" on attendance_records;
create policy "Educators update attendance"
  on attendance_records for update
  using (can_access_child(child_id));

-- Parents can view their child's attendance (read only)
drop policy if exists "Parents read own child attendance" on attendance_records;
create policy "Parents read own child attendance"
  on attendance_records for select
  using (can_access_child(child_id));

