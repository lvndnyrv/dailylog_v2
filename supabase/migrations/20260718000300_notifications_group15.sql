-- ============================================================================
-- Group 15 — admin notification center and per-account delivery preferences
-- ============================================================================

create table notification_preferences (
  profile_id uuid not null references profiles(id) on delete cascade,
  daycare_id uuid not null references daycares(id) on delete cascade,
  kind text not null check (kind in (
    'ratio_alert',
    'incident_report',
    'cert_expiry',
    'overdue_billing',
    'new_device_sign_in',
    'waitlist_enrollment'
  )),
  in_app boolean not null default true,
  push boolean not null default false,
  email boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (profile_id, kind)
);

create table notification_delivery_settings (
  profile_id uuid primary key references profiles(id) on delete cascade,
  daycare_id uuid not null references daycares(id) on delete cascade,
  quiet_hours_enabled boolean not null default true,
  quiet_hours_start time not null default time '22:00',
  quiet_hours_end time not null default time '06:00',
  email_mode text not null default 'daily_digest'
    check (email_mode in ('instant', 'daily_digest', 'off')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger notification_preferences_updated_at
  before update on notification_preferences
  for each row execute function update_updated_at();

create trigger notification_delivery_settings_updated_at
  before update on notification_delivery_settings
  for each row execute function update_updated_at();

alter table notification_preferences enable row level security;
alter table notification_delivery_settings enable row level security;

create policy "users read own notification preferences"
  on notification_preferences for select
  using (profile_id = auth.uid());

create policy "users create own notification preferences"
  on notification_preferences for insert
  with check (
    profile_id = auth.uid()
    and daycare_id = get_my_daycare_id()
  );

create policy "users update own notification preferences"
  on notification_preferences for update
  using (profile_id = auth.uid())
  with check (
    profile_id = auth.uid()
    and daycare_id = get_my_daycare_id()
  );

create policy "users read own notification delivery settings"
  on notification_delivery_settings for select
  using (profile_id = auth.uid());

create policy "users create own notification delivery settings"
  on notification_delivery_settings for insert
  with check (
    profile_id = auth.uid()
    and daycare_id = get_my_daycare_id()
  );

create policy "users update own notification delivery settings"
  on notification_delivery_settings for update
  using (profile_id = auth.uid())
  with check (
    profile_id = auth.uid()
    and daycare_id = get_my_daycare_id()
  );

-- Security and safety alerts cannot be completely muted. Enforce the same
-- constraints shown as locked controls in design 15c even when a client calls
-- the table directly.
create or replace function enforce_required_notification_channels()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.kind = 'ratio_alert' then
    new.in_app := true;
    new.push := true;
  elsif new.kind = 'incident_report' or new.kind = 'new_device_sign_in' then
    new.in_app := true;
  end if;
  return new;
end;
$$;

create trigger enforce_required_notification_channels
  before insert or update on notification_preferences
  for each row execute function enforce_required_notification_channels();

create index notifications_profile_created_idx
  on notifications (profile_id, created_at desc);
