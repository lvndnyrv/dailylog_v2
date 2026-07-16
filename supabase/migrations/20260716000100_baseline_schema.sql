-- ============================================================================
-- DailyLog — baseline schema (Phase 0)
-- ============================================================================
-- Squashed baseline replacing the 15 hand-applied supabase-*.sql files now
-- archived under supabase/legacy/. Reconciles the shipping mobile schema with
-- the entity checklist in design/PHASE_0_FOUNDATION.md.
--
-- Naming: the design docs say "centers" and "rooms"; the shipping schema says
-- "daycares" and "classrooms". PHASE_0_FOUNDATION allows renaming to match what
-- exists, so existing names win and the design names map onto them:
--   centers -> daycares · rooms -> classrooms · guardians -> parent_children
--   incidents -> incident_reports · medication_doses -> medication_logs
-- See DECISIONS.md.
--
-- Convention: snake_case; uuid pks; created_at/updated_at timestamptz; every
-- table carries daycare_id (the CLAUDE.md center_id rule, under local naming).
-- ============================================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────────────────────
-- Core tenancy
-- ─────────────────────────────────────────────────────────────────────────────

create table daycares (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  phone text,
  -- lets the onboarding wizard read back the daycare it just created, before
  -- profiles.daycare_id is set (carried over from phase0-reconciliation)
  created_by uuid default auth.uid(),
  active boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table classrooms (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references daycares(id) on delete cascade,
  name text not null,
  age_group text,
  -- rooms & ratios (design 7a–f)
  min_age_months int,
  max_age_months int,
  capacity int,
  ratio_children_per_educator int,
  archived_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null,
  -- owner_admin added for the design's 4-role model; the three shipping roles
  -- keep their exact spelling so existing rows and policies still match.
  role text not null check (role in ('owner_admin', 'admin', 'educator', 'parent')),
  daycare_id uuid references daycares(id) on delete set null,
  -- primary classroom; educators may span many via educator_classrooms
  classroom_id uuid references classrooms(id) on delete set null,
  phone text default '',
  avatar_url text,
  archived_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Educators ↔ classrooms (many-to-many)
create table educator_classrooms (
  educator_id uuid not null references profiles(id) on delete cascade,
  classroom_id uuid not null references classrooms(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (educator_id, classroom_id)
);

-- Employment record extending profiles (design 4a–4o)
create table staff_members (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references daycares(id) on delete cascade,
  profile_id uuid references profiles(id) on delete cascade,
  job_title text,
  employment_type text check (employment_type in ('full_time', 'part_time', 'casual', 'contract')),
  started_on date,
  ended_on date,
  certifications jsonb default '[]',
  status text not null default 'active' check (status in ('invited', 'active', 'inactive')),
  archived_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (daycare_id, profile_id)
);

create table staff_invites (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references daycares(id) on delete cascade,
  email text not null,
  role text not null check (role in ('owner_admin', 'admin', 'educator')),
  classroom_id uuid references classrooms(id) on delete set null,
  code text not null unique,
  invited_by uuid references profiles(id) on delete set null,
  accepted_at timestamptz,
  accepted_by uuid references profiles(id) on delete set null,
  expires_at timestamptz,
  created_at timestamptz default now()
);

create table daycare_signup_codes (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references daycares(id) on delete cascade,
  code text not null unique,
  role text not null default 'educator' check (role in ('admin', 'educator')),
  uses_remaining int default 1,
  expires_at timestamptz,
  created_at timestamptz default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Children & guardians
-- ─────────────────────────────────────────────────────────────────────────────

create table children (
  id uuid primary key default gen_random_uuid(),
  -- denormalized so every table carries daycare_id; kept in sync by trigger
  daycare_id uuid not null references daycares(id) on delete cascade,
  classroom_id uuid references classrooms(id) on delete set null,
  first_name text not null,
  last_name text not null,
  date_of_birth date,
  photo_url text,
  allergies text[] default '{}',
  medical_notes text,
  emergency_contacts jsonb default '[]',
  -- setup checklist state (design 20a/19a)
  setup_state jsonb default '{}',
  enrolled_on date,
  archived_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- design "guardians": parent ↔ child links
create table parent_children (
  parent_id uuid not null references profiles(id) on delete cascade,
  child_id uuid not null references children(id) on delete cascade,
  relationship text,
  pickup_authorized boolean not null default true,
  is_primary boolean not null default false,
  consent_given_at timestamptz,
  created_at timestamptz default now(),
  primary key (parent_id, child_id)
);

create table child_invite_codes (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references daycares(id) on delete cascade,
  child_id uuid not null references children(id) on delete cascade,
  code text not null unique,
  created_by uuid references profiles(id) on delete set null,
  used_at timestamptz,
  used_by uuid references profiles(id) on delete set null,
  expires_at timestamptz,
  created_at timestamptz default now()
);

-- Enrollment pipeline: inquiry → tour → application → offer → enrolled → withdrawn
create table enrollments (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references daycares(id) on delete cascade,
  child_id uuid references children(id) on delete set null,
  classroom_id uuid references classrooms(id) on delete set null,
  child_first_name text,
  child_last_name text,
  child_date_of_birth date,
  guardian_name text,
  guardian_email text,
  guardian_phone text,
  stage text not null default 'inquiry'
    check (stage in ('inquiry', 'tour', 'application', 'offer', 'enrolled', 'withdrawn')),
  waitlist_position int,
  desired_start_date date,
  source text,
  notes text,
  stage_changed_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Daily logs
-- ─────────────────────────────────────────────────────────────────────────────

create table daily_logs (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references daycares(id) on delete cascade,
  child_id uuid not null references children(id) on delete cascade,
  educator_id uuid references profiles(id) on delete set null,
  log_date date not null default current_date,
  moods text[] default '{}',
  notes text default '',
  comments text default '',
  sent_to_parents boolean default false,
  sent_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (child_id, log_date)
);

create table meal_entries (
  id uuid primary key default gen_random_uuid(),
  daily_log_id uuid not null references daily_logs(id) on delete cascade,
  time time not null,
  food_type text not null,
  amount text not null check (amount in ('all', 'some', 'none')),
  created_at timestamptz default now()
);

create table diaper_entries (
  id uuid primary key default gen_random_uuid(),
  daily_log_id uuid not null references daily_logs(id) on delete cascade,
  time time not null,
  type text not null check (type in ('diaper', 'toilet')),
  wet boolean default false,
  bm boolean default false,
  created_at timestamptz default now()
);

create table sleep_entries (
  id uuid primary key default gen_random_uuid(),
  daily_log_id uuid not null references daily_logs(id) on delete cascade,
  start_time time not null,
  end_time time,
  created_at timestamptz default now()
);

create table activity_entries (
  id uuid primary key default gen_random_uuid(),
  daily_log_id uuid not null references daily_logs(id) on delete cascade,
  activity_name text not null,
  created_at timestamptz default now()
);

create table supply_requests (
  id uuid primary key default gen_random_uuid(),
  daily_log_id uuid not null references daily_logs(id) on delete cascade,
  item_name text not null,
  created_at timestamptz default now()
);

create table photos (
  id uuid primary key default gen_random_uuid(),
  daily_log_id uuid not null references daily_logs(id) on delete cascade,
  storage_path text not null,
  caption text,
  created_at timestamptz default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Attendance
-- ─────────────────────────────────────────────────────────────────────────────

create table attendance_records (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references daycares(id) on delete cascade,
  child_id uuid not null references children(id) on delete cascade,
  date date not null default current_date,
  checked_in_at timestamptz,
  checked_in_by uuid references profiles(id) on delete set null,
  checked_out_at timestamptz,
  checked_out_by uuid references profiles(id) on delete set null,
  -- design 8a–f: kiosk vs educator check-in, absences
  method text check (method in ('educator', 'kiosk', 'parent')),
  status text not null default 'present' check (status in ('present', 'absent', 'late', 'excused')),
  absence_reason text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint attendance_records_child_date_unique unique (child_id, date)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Incidents
-- ─────────────────────────────────────────────────────────────────────────────

create table incident_reports (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references daycares(id) on delete cascade,
  child_id uuid not null references children(id) on delete cascade,
  educator_id uuid references profiles(id) on delete set null,
  classroom_id uuid references classrooms(id) on delete set null,
  occurred_at timestamptz not null default now(),
  location text not null default 'classroom',
  severity text not null default 'minor' check (severity in ('minor', 'moderate', 'serious')),
  injury_type text not null default 'bump',
  body_parts text[] default '{}',
  description text default '',
  first_aid_given text default '',
  witnesses text[] default '{}',
  photo_paths text[] default '{}',
  notes text default '',
  -- 'signed_off' added for the admin sign-off step (design 9b)
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'signed_off', 'acknowledged')),
  signed_off_by uuid references profiles(id) on delete set null,
  signed_off_at timestamptz,
  parent_notified_at timestamptz,
  parent_acknowledged_at timestamptz,
  parent_acknowledge_name text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Medications
-- ─────────────────────────────────────────────────────────────────────────────
-- AUDIT RESOLVED (2026-07-16, diffed against the live DB): these tables never
-- existed anywhere — apps/mobile's MedicationScreen reads/writes them but the
-- live database has no such tables, so that screen errors in production today.
-- The definitions below (reconstructed from the call sites) are therefore the
-- first real ones. The design's separate `medications` catalog is folded into
-- medication_authorizations (the app has no catalog concept).

create table medication_authorizations (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references daycares(id) on delete cascade,
  child_id uuid not null references children(id) on delete cascade,
  parent_id uuid references profiles(id) on delete set null,
  name text not null,
  dosage text not null,
  schedule text,
  notes text,
  active boolean not null default true,
  start_date date default current_date,
  end_date date,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- design "medication_doses"
create table medication_logs (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references daycares(id) on delete cascade,
  authorization_id uuid not null references medication_authorizations(id) on delete cascade,
  child_id uuid not null references children(id) on delete cascade,
  administered_by uuid,
  administered_at timestamptz not null default now(),
  dosage_given text,
  notes text,
  created_at timestamptz default now(),
  -- named explicitly: the app selects via profiles!medication_logs_administered_by_fkey,
  -- so this constraint name is load-bearing, not incidental
  constraint medication_logs_administered_by_fkey
    foreign key (administered_by) references profiles(id) on delete set null
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Consents (design 14a–c parent, 22d)
-- ─────────────────────────────────────────────────────────────────────────────

create table consents (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references daycares(id) on delete cascade,
  child_id uuid not null references children(id) on delete cascade,
  parent_id uuid references profiles(id) on delete set null,
  kind text not null,
  version text not null default '1',
  granted boolean not null default false,
  granted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (child_id, kind, version)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Messaging
-- ─────────────────────────────────────────────────────────────────────────────
-- The shipping app has messages but no conversations table; the admin inbox
-- (5a) needs threads. conversation_id is nullable so existing rows survive the
-- migration and can be backfilled.

create table conversations (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references daycares(id) on delete cascade,
  child_id uuid references children(id) on delete set null,
  subject text,
  kind text not null default 'direct' check (kind in ('direct', 'broadcast')),
  last_message_at timestamptz default now(),
  archived_at timestamptz,
  created_at timestamptz default now()
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references daycares(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete cascade,
  child_id uuid references children(id) on delete cascade,
  sender_id uuid references profiles(id) on delete set null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Announcements
-- ─────────────────────────────────────────────────────────────────────────────

create table announcements (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references daycares(id) on delete cascade,
  classroom_id uuid references classrooms(id) on delete set null,
  author_id uuid references profiles(id) on delete set null,
  title text not null,
  body text not null,
  pinned boolean default false,
  -- design 17b: RSVP-able announcements (events)
  rsvp_enabled boolean not null default false,
  event_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table announcement_rsvps (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references daycares(id) on delete cascade,
  announcement_id uuid not null references announcements(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  child_id uuid references children(id) on delete set null,
  response text not null check (response in ('yes', 'no', 'maybe')),
  guests int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (announcement_id, profile_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Billing — schema only in Phase 0; features land in Phase 4
-- ─────────────────────────────────────────────────────────────────────────────

create table billing_plans (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references daycares(id) on delete cascade,
  name text not null,
  amount_cents int not null,
  currency text not null default 'CAD',
  cadence text not null default 'monthly' check (cadence in ('weekly', 'biweekly', 'monthly')),
  active boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references daycares(id) on delete cascade,
  child_id uuid references children(id) on delete set null,
  billed_to uuid references profiles(id) on delete set null,
  number text,
  status text not null default 'draft'
    check (status in ('draft', 'open', 'paid', 'void', 'overdue')),
  issued_on date,
  due_on date,
  subtotal_cents int not null default 0,
  total_cents int not null default 0,
  currency text not null default 'CAD',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (daycare_id, number)
);

create table invoice_lines (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references daycares(id) on delete cascade,
  invoice_id uuid not null references invoices(id) on delete cascade,
  billing_plan_id uuid references billing_plans(id) on delete set null,
  description text not null,
  quantity numeric not null default 1,
  unit_amount_cents int not null default 0,
  amount_cents int not null default 0,
  created_at timestamptz default now()
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references daycares(id) on delete cascade,
  invoice_id uuid references invoices(id) on delete set null,
  paid_by uuid references profiles(id) on delete set null,
  amount_cents int not null,
  currency text not null default 'CAD',
  method text check (method in ('card', 'bank', 'cash', 'cheque', 'other')),
  status text not null default 'succeeded'
    check (status in ('pending', 'succeeded', 'failed', 'refunded')),
  external_ref text,
  paid_at timestamptz default now(),
  created_at timestamptz default now()
);

create table statements (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references daycares(id) on delete cascade,
  child_id uuid references children(id) on delete set null,
  period_start date not null,
  period_end date not null,
  total_cents int not null default 0,
  storage_path text,
  created_at timestamptz default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Documents, notifications, audit
-- ─────────────────────────────────────────────────────────────────────────────

create table documents (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references daycares(id) on delete cascade,
  child_id uuid references children(id) on delete cascade,
  profile_id uuid references profiles(id) on delete cascade,
  title text not null,
  category text,
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  expires_on date,
  uploaded_by uuid references profiles(id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references daycares(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  -- deep link target, e.g. {"screen":"DailyLog","childId":"..."}
  payload jsonb default '{}',
  read_at timestamptz,
  created_at timestamptz default now()
);

create table push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  token text not null,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz default now(),
  unique (user_id, token)
);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references daycares(id) on delete cascade,
  actor_id uuid references profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before jsonb,
  after jsonb,
  created_at timestamptz default now()
);

create table app_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────────────────────────────────────

create index classrooms_daycare_idx on classrooms (daycare_id);
create index profiles_daycare_idx on profiles (daycare_id);
create index staff_members_daycare_idx on staff_members (daycare_id);
create index children_daycare_idx on children (daycare_id);
create index children_classroom_idx on children (classroom_id) where archived_at is null;
create index parent_children_child_idx on parent_children (child_id);
create index enrollments_daycare_stage_idx on enrollments (daycare_id, stage);
create index daily_logs_child_date_idx on daily_logs (child_id, log_date desc);
create index daily_logs_daycare_date_idx on daily_logs (daycare_id, log_date desc);
create index meal_entries_log_idx on meal_entries (daily_log_id);
create index diaper_entries_log_idx on diaper_entries (daily_log_id);
create index sleep_entries_log_idx on sleep_entries (daily_log_id);
create index activity_entries_log_idx on activity_entries (daily_log_id);
create index supply_requests_log_idx on supply_requests (daily_log_id);
create index photos_log_idx on photos (daily_log_id);
create index attendance_records_child_date_idx on attendance_records (child_id, date);
create index attendance_records_daycare_date_idx on attendance_records (daycare_id, date);
create index incident_reports_child_idx on incident_reports (child_id, occurred_at desc);
create index incident_reports_daycare_status_idx on incident_reports (daycare_id, status);
create index medication_auth_child_idx on medication_authorizations (child_id, active);
create index medication_logs_child_idx on medication_logs (child_id, administered_at desc);
create index consents_child_idx on consents (child_id);
create index conversations_daycare_idx on conversations (daycare_id, last_message_at desc);
create index messages_conversation_idx on messages (conversation_id, created_at desc);
create index messages_child_idx on messages (child_id, created_at desc);
create index announcements_daycare_idx on announcements (daycare_id, created_at desc);
create index announcement_rsvps_announcement_idx on announcement_rsvps (announcement_id);
create index invoices_daycare_status_idx on invoices (daycare_id, status);
create index invoice_lines_invoice_idx on invoice_lines (invoice_id);
create index payments_invoice_idx on payments (invoice_id);
create index documents_daycare_idx on documents (daycare_id);
create index documents_child_idx on documents (child_id);
create index notifications_profile_idx on notifications (profile_id, read_at, created_at desc);
create index audit_log_daycare_idx on audit_log (daycare_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- updated_at triggers
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function update_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'daycares', 'classrooms', 'profiles', 'staff_members', 'children',
    'enrollments', 'daily_logs', 'attendance_records', 'incident_reports',
    'medication_authorizations', 'consents', 'announcements',
    'announcement_rsvps', 'billing_plans', 'invoices', 'documents'
  ]
  loop
    execute format(
      'create trigger %I_updated_at before update on %I
         for each row execute function update_updated_at()',
      tbl, tbl
    );
  end loop;
end $$;

-- Keep children.daycare_id consistent with the classroom it belongs to.
create or replace function children_sync_daycare_id()
returns trigger
language plpgsql
as $$
begin
  if new.classroom_id is not null then
    select daycare_id into new.daycare_id from classrooms where id = new.classroom_id;
  end if;
  return new;
end;
$$;

create trigger children_sync_daycare_id
  before insert or update of classroom_id on children
  for each row execute function children_sync_daycare_id();
