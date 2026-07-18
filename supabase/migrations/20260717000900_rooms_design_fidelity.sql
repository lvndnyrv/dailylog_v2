-- ============================================================================
-- Rooms & ratios 7a–7f — coverage assignments, alerts, planned transitions,
-- future room openings, and open/close room combinations.
-- ============================================================================

alter table daycares
  add column if not exists ratio_alert_after_minutes int not null default 10
    check (ratio_alert_after_minutes between 0 and 120),
  add column if not exists ratio_notify_floaters boolean not null default true,
  add column if not exists ratio_block_checkins boolean not null default false;

alter table classrooms
  add column if not exists opens_on date,
  add column if not exists nap_start time,
  add column if not exists nap_end time,
  add column if not exists lead_educator_id uuid references profiles(id) on delete set null;

create table if not exists room_coverage_assignments (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references daycares(id) on delete cascade,
  classroom_id uuid not null references classrooms(id) on delete cascade,
  staff_member_id uuid not null references staff_members(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'assigned'
    check (status in ('assigned', 'accepted', 'declined', 'cancelled', 'completed')),
  notes text,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists room_coverage_assignments_center_range_idx
  on room_coverage_assignments (daycare_id, starts_at, ends_at);
create index if not exists room_coverage_assignments_room_range_idx
  on room_coverage_assignments (classroom_id, starts_at, ends_at);

create table if not exists room_transition_plans (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references daycares(id) on delete cascade,
  child_id uuid not null references children(id) on delete cascade,
  from_classroom_id uuid not null references classrooms(id) on delete cascade,
  to_classroom_id uuid not null references classrooms(id) on delete cascade,
  move_on date not null,
  transition_week boolean not null default true,
  status text not null default 'planned'
    check (status in ('planned', 'completed', 'cancelled')),
  notes text,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_classroom_id <> to_classroom_id)
);
create unique index if not exists room_transition_plans_one_active_child_idx
  on room_transition_plans (child_id) where status = 'planned';
create index if not exists room_transition_plans_center_date_idx
  on room_transition_plans (daycare_id, move_on);

create table if not exists room_combinations (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references daycares(id) on delete cascade,
  period text not null check (period in ('morning', 'evening')),
  source_classroom_id uuid references classrooms(id) on delete cascade,
  host_classroom_id uuid references classrooms(id) on delete cascade,
  starts_at time not null,
  ends_at time not null,
  enabled boolean not null default false,
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (daycare_id, period),
  check (starts_at < ends_at),
  check (source_classroom_id is null or host_classroom_id is null or source_classroom_id <> host_classroom_id)
);

create trigger room_coverage_assignments_updated_at
  before update on room_coverage_assignments
  for each row execute function update_updated_at();
create trigger room_transition_plans_updated_at
  before update on room_transition_plans
  for each row execute function update_updated_at();
create trigger room_combinations_updated_at
  before update on room_combinations
  for each row execute function update_updated_at();

alter table room_coverage_assignments enable row level security;
alter table room_transition_plans enable row level security;
alter table room_combinations enable row level security;

create policy "staff read room coverage" on room_coverage_assignments for select
  using (is_staff() and daycare_id = get_my_daycare_id());
create policy "admins manage room coverage" on room_coverage_assignments for all
  using (is_admin() and daycare_id = get_my_daycare_id())
  with check (is_admin() and daycare_id = get_my_daycare_id());

create policy "staff read room transition plans" on room_transition_plans for select
  using (is_staff() and daycare_id = get_my_daycare_id());
create policy "admins manage room transition plans" on room_transition_plans for all
  using (is_admin() and daycare_id = get_my_daycare_id())
  with check (is_admin() and daycare_id = get_my_daycare_id());

create policy "staff read room combinations" on room_combinations for select
  using (is_staff() and daycare_id = get_my_daycare_id());
create policy "admins manage room combinations" on room_combinations for all
  using (is_admin() and daycare_id = get_my_daycare_id())
  with check (is_admin() and daycare_id = get_my_daycare_id());

create trigger audit_room_coverage_assignments
  after insert or update or delete on room_coverage_assignments
  for each row execute function audit_write();
create trigger audit_room_transition_plans
  after insert or update or delete on room_transition_plans
  for each row execute function audit_write();
create trigger audit_room_combinations
  after insert or update or delete on room_combinations
  for each row execute function audit_write();
