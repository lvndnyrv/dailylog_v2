-- ============================================================================
-- Group 2 — enrollment & waitlist design fidelity
-- Adds the operational state behind tours, applications, offers, ranked
-- waitlists, follow-ups, withdrawals and alumni records.
-- ============================================================================

alter table enrollments
  add column if not exists schedule jsonb not null default '{}',
  add column if not exists application_data jsonb not null default '{}',
  add column if not exists documents_status jsonb not null default '{}',
  add column if not exists application_progress int not null default 0,
  add column if not exists tour_at timestamptz,
  add column if not exists tour_host_id uuid references profiles(id) on delete set null,
  add column if not exists tour_outcome text,
  add column if not exists tour_notes text,
  add column if not exists offer_sent_at timestamptz,
  add column if not exists offer_expires_at timestamptz,
  add column if not exists offer_viewed_at timestamptz,
  add column if not exists offer_nudged_at timestamptz,
  add column if not exists offer_status text not null default 'draft',
  add column if not exists offer_deposit_cents int,
  add column if not exists offer_tuition_cents int,
  add column if not exists waitlist_joined_at timestamptz,
  add column if not exists waitlist_priority text not null default 'public',
  add column if not exists waitlist_status text not null default 'not_waitlisted',
  add column if not exists waitlist_last_contact_at timestamptz,
  add column if not exists waitlist_unanswered_checkins int not null default 0,
  add column if not exists closed_reason text,
  add column if not exists closed_at timestamptz,
  add column if not exists keep_on_file boolean not null default true,
  add column if not exists onboarding_steps jsonb not null default '{}';

alter table enrollments drop constraint if exists enrollments_application_progress_check;
alter table enrollments add constraint enrollments_application_progress_check
  check (application_progress between 0 and 100);
alter table enrollments drop constraint if exists enrollments_offer_status_check;
alter table enrollments add constraint enrollments_offer_status_check
  check (offer_status in ('draft', 'sent', 'viewed', 'accepted', 'declined', 'expired', 'withdrawn'));
alter table enrollments drop constraint if exists enrollments_waitlist_priority_check;
alter table enrollments add constraint enrollments_waitlist_priority_check
  check (waitlist_priority in ('sibling', 'staff', 'public'));
alter table enrollments drop constraint if exists enrollments_waitlist_status_check;
alter table enrollments add constraint enrollments_waitlist_status_check
  check (waitlist_status in ('not_waitlisted', 'active', 'offer', 'paused', 'archived'));
alter table enrollments drop constraint if exists enrollments_tour_outcome_check;
alter table enrollments add constraint enrollments_tour_outcome_check
  check (tour_outcome is null or tour_outcome in ('attended', 'no_show', 'rescheduled'));
alter table enrollments drop constraint if exists enrollments_group2_json_check;
alter table enrollments add constraint enrollments_group2_json_check check (
  jsonb_typeof(schedule) = 'object'
  and jsonb_typeof(application_data) = 'object'
  and jsonb_typeof(documents_status) = 'object'
  and jsonb_typeof(onboarding_steps) = 'object'
);

create index if not exists enrollments_waitlist_idx
  on enrollments (daycare_id, classroom_id, waitlist_status, waitlist_priority, waitlist_position);
create index if not exists enrollments_tour_idx
  on enrollments (daycare_id, tour_at) where tour_at is not null;
create index if not exists enrollments_offer_expiry_idx
  on enrollments (daycare_id, offer_expires_at) where offer_status in ('sent', 'viewed');

create table if not exists enrollment_tour_slots (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references daycares(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  classroom_id uuid references classrooms(id) on delete set null,
  host_id uuid references profiles(id) on delete set null,
  enrollment_id uuid references enrollments(id) on delete set null,
  status text not null default 'open' check (status in ('open', 'booked', 'cancelled')),
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (daycare_id, starts_at)
);

create table if not exists enrollment_settings (
  daycare_id uuid primary key references daycares(id) on delete cascade,
  siblings_first boolean not null default true,
  staff_children_next boolean not null default true,
  offer_window_hours int not null default 48 check (offer_window_hours between 12 and 336),
  auto_offer boolean not null default true,
  auto_archive_checkins int not null default 2 check (auto_archive_checkins between 1 and 10),
  inquiry_reply_hours int not null default 24 check (inquiry_reply_hours between 1 and 168),
  updated_at timestamptz not null default now()
);

create table if not exists child_departures (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references daycares(id) on delete cascade,
  child_id uuid not null references children(id) on delete cascade,
  last_day date not null,
  reason text not null,
  notes text,
  offer_spot_automatically boolean not null default true,
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled')),
  scheduled_by uuid references profiles(id) on delete set null default auth.uid(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists child_departures_daycare_idx
  on child_departures (daycare_id, status, last_day);
create unique index if not exists child_departures_one_scheduled_idx
  on child_departures (child_id) where status = 'scheduled';

alter table enrollment_tour_slots enable row level security;
alter table enrollment_settings enable row level security;
alter table child_departures enable row level security;

drop policy if exists "permitted staff read tour slots" on enrollment_tour_slots;
create policy "permitted staff read tour slots" on enrollment_tour_slots for select
  using (has_permission('enrollment', 'view') and daycare_id = get_my_daycare_id());
drop policy if exists "permitted staff manage tour slots" on enrollment_tour_slots;
create policy "permitted staff manage tour slots" on enrollment_tour_slots for all
  using (has_permission('enrollment', 'edit') and daycare_id = get_my_daycare_id())
  with check (has_permission('enrollment', 'edit') and daycare_id = get_my_daycare_id());

drop policy if exists "permitted staff read enrollment settings" on enrollment_settings;
create policy "permitted staff read enrollment settings" on enrollment_settings for select
  using (has_permission('enrollment', 'view') and daycare_id = get_my_daycare_id());
drop policy if exists "permitted staff manage enrollment settings" on enrollment_settings;
create policy "permitted staff manage enrollment settings" on enrollment_settings for all
  using (has_permission('enrollment', 'edit') and daycare_id = get_my_daycare_id())
  with check (has_permission('enrollment', 'edit') and daycare_id = get_my_daycare_id());

drop policy if exists "permitted staff read departures" on child_departures;
create policy "permitted staff read departures" on child_departures for select
  using (has_permission('enrollment', 'view') and daycare_id = get_my_daycare_id());
drop policy if exists "permitted staff manage departures" on child_departures;
create policy "permitted staff manage departures" on child_departures for all
  using (has_permission('enrollment', 'edit') and daycare_id = get_my_daycare_id())
  with check (has_permission('enrollment', 'edit') and daycare_id = get_my_daycare_id());

drop trigger if exists enrollment_tour_slots_updated_at on enrollment_tour_slots;
create trigger enrollment_tour_slots_updated_at before update on enrollment_tour_slots
  for each row execute function update_updated_at();
drop trigger if exists enrollment_settings_updated_at on enrollment_settings;
create trigger enrollment_settings_updated_at before update on enrollment_settings
  for each row execute function update_updated_at();
drop trigger if exists child_departures_updated_at on child_departures;
create trigger child_departures_updated_at before update on child_departures
  for each row execute function update_updated_at();

-- The design promises that every pipeline move and withdrawal is attributable.
drop trigger if exists audit_enrollments on enrollments;
create trigger audit_enrollments after insert or update on enrollments
  for each row execute function audit_write();
drop trigger if exists audit_child_departures on child_departures;
create trigger audit_child_departures after insert or update on child_departures
  for each row execute function audit_write();

insert into enrollment_settings (daycare_id)
select id from daycares
on conflict (daycare_id) do nothing;

-- Safe to run from a scheduled worker (or manually) after a child's last day.
create or replace function process_due_child_departures()
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if not has_permission('enrollment', 'edit') then
    raise exception 'Enrollment edit permission required';
  end if;

  with due as (
    update child_departures d
       set status = 'completed', completed_at = now()
     where d.daycare_id = get_my_daycare_id()
       and d.status = 'scheduled'
       and d.last_day < current_date
    returning d.child_id
  ), archived as (
    update children c
       set archived_at = now()
     where c.id in (select child_id from due)
    returning c.id
  ), closed_pipeline as (
    update enrollments e
       set stage = 'withdrawn', stage_changed_at = now(), closed_at = coalesce(closed_at, now())
     where e.child_id in (select id from archived)
    returning e.id
  )
  select count(*) into v_count from archived;

  return v_count;
end;
$$;

-- Group 2g stores the family-facing days/week choice and queues the promised
-- acknowledgement without granting anonymous users table access.
-- pgcrypto is installed in `extensions`; the original P0 helper only searched
-- `public`, which made every public rate-limited RPC fail at digest().
alter function consume_rate_limit(text, text, int, int)
  set search_path = public, extensions;

-- Enrollment emails previously fell through to the daily-log permission area.
-- Anonymous acknowledgement is still only possible through the definer RPC;
-- notification_outbox has no anonymous insert policy.
create or replace function enforce_notification_enqueue_permission()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare v_area text;
begin
  if auth.role() = 'service_role' or (auth.uid() is null and auth.role() is null) then
    return new;
  end if;
  if auth.role() = 'anon' and new.kind = 'enrollment_inquiry_received' then
    return new;
  end if;
  v_area := case
    when new.kind in (
      'enrollment_inquiry_received', 'tour_confirmation', 'enrollment_application',
      'enrollment_documents', 'waitlist_offer', 'offer_reminder',
      'offer_withdrawn', 'inquiry_closed', 'waitlist_checkin',
      'waitlist_confirmation', 'waitlist_position_changed'
    ) then 'enrollment'
    when new.kind = 'announcement' then 'broadcasts'
    when new.kind = 'incident' then 'incidents'
    when new.kind = 'medication' then 'medications'
    when new.kind in ('invoice', 'payment') then 'billing'
    when new.kind = 'staff_invite' then 'staff'
    when new.kind = 'parent_invite' then 'children'
    else 'daily_logs'
  end;
  if not has_permission(v_area, 'edit') then
    raise exception '% edit permission required', v_area;
  end if;
  return new;
end;
$$;

create or replace function submit_enrollment_inquiry_v2(
  p_daycare_id uuid,
  p_guardian_name text,
  p_guardian_email text,
  p_guardian_phone text,
  p_child_first_name text,
  p_child_date_of_birth date,
  p_classroom_id uuid,
  p_desired_start date,
  p_days_per_week int
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(p_guardian_email));
  v_enrollment uuid;
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
  if p_days_per_week not in (2, 3, 5) then
    raise exception 'Days per week must be 2, 3, or 5';
  end if;
  if p_classroom_id is not null and not exists (
    select 1 from classrooms where id = p_classroom_id
      and daycare_id = p_daycare_id and archived_at is null
  ) then
    raise exception 'Program not found';
  end if;

  insert into enrollments (
    daycare_id, classroom_id, child_first_name, child_date_of_birth,
    guardian_name, guardian_email, guardian_phone, stage, desired_start_date,
    source, schedule
  ) values (
    p_daycare_id, p_classroom_id, btrim(p_child_first_name), p_child_date_of_birth,
    btrim(p_guardian_name), v_email, nullif(btrim(p_guardian_phone), ''),
    'inquiry', p_desired_start, 'website',
    jsonb_build_object('days_per_week', p_days_per_week)
  ) returning id into v_enrollment;

  insert into notification_outbox (
    daycare_id, recipient_email, channel, kind, title, body, payload, dedupe_key
  ) values (
    p_daycare_id, v_email, 'email', 'enrollment_inquiry_received',
    'We received your enrollment inquiry',
    'Thanks for reaching out. The center will reply within one business day with available tour times.',
    jsonb_build_object('enrollment_id', v_enrollment),
    'public-inquiry:' || v_enrollment
  ) on conflict do nothing;

  return v_enrollment;
end;
$$;

revoke all on function submit_enrollment_inquiry_v2(uuid, text, text, text, text, date, uuid, date, int)
  from public;
grant execute on function submit_enrollment_inquiry_v2(uuid, text, text, text, text, date, uuid, date, int)
  to anon, authenticated;
