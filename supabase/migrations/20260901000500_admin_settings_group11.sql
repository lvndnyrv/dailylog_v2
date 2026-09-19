-- =============================================================================
-- Admin Group 11 — center facts, policy history and auditable settings.
-- =============================================================================

alter table public.daycares
  add column if not exists licensed_capacity integer,
  add column if not exists license_number text,
  add column if not exists sick_return_hours integer not null default 24,
  add column if not exists photo_consent_required boolean not null default true,
  add column if not exists pickup_id_check_required boolean not null default true,
  add column if not exists require_admin_mfa boolean not null default false,
  add column if not exists default_delegation_days integer not null default 14;

update public.daycares daycare
set licensed_capacity = coalesce((
  select sum(coalesce(room.capacity, 0))::integer
  from public.classrooms room
  where room.daycare_id = daycare.id and room.archived_at is null
), 0)
where licensed_capacity is null;

alter table public.daycares
  alter column licensed_capacity set not null,
  alter column licensed_capacity set default 0,
  drop constraint if exists daycares_licensed_capacity_check,
  drop constraint if exists daycares_sick_return_hours_check,
  drop constraint if exists daycares_default_delegation_days_check;
alter table public.daycares
  add constraint daycares_licensed_capacity_check check (licensed_capacity between 0 and 10000),
  add constraint daycares_sick_return_hours_check check (sick_return_hours between 0 and 168),
  add constraint daycares_default_delegation_days_check check (default_delegation_days between 1 and 365);

create or replace function public.guard_daycare_licensed_capacity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_active_children integer;
begin
  if new.licensed_capacity is distinct from old.licensed_capacity then
    select count(*)::integer into v_active_children
    from public.children child
    where child.daycare_id = new.id and child.archived_at is null;
    if new.licensed_capacity < v_active_children then
      raise exception 'Licensed capacity cannot be below the % active child records.', v_active_children;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_daycare_licensed_capacity on public.daycares;
create trigger guard_daycare_licensed_capacity
  before update of licensed_capacity on public.daycares
  for each row execute function public.guard_daycare_licensed_capacity();

create or replace function public.audit_daycare_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log (
    daycare_id, actor_id, action, entity_type, entity_id, before, after
  ) values (
    new.id, auth.uid(), 'update', 'daycares', new.id, to_jsonb(old), to_jsonb(new)
  );
  return new;
end;
$$;

drop trigger if exists audit_daycare_settings on public.daycares;
create trigger audit_daycare_settings
  after update of name, address, phone, opens_at, closes_at,
    licensed_capacity, license_number, sick_return_hours,
    photo_consent_required, pickup_id_check_required,
    require_admin_mfa, default_delegation_days
  on public.daycares
  for each row
  when (to_jsonb(old) is distinct from to_jsonb(new))
  execute function public.audit_daycare_settings();

drop trigger if exists audit_center_closures on public.center_closures;
create trigger audit_center_closures
  after insert or update or delete on public.center_closures
  for each row execute function public.audit_write();

drop trigger if exists audit_late_pickup_policies on public.late_pickup_policies;
create trigger audit_late_pickup_policies
  after insert or update or delete on public.late_pickup_policies
  for each row execute function public.audit_write();

-- Existing clients need a policy immediately; future edits create a dated
-- version so a pickup can always be reconstructed with the rules used then.
insert into public.late_pickup_policies (
  daycare_id, effective_from, closing_time, grace_minutes,
  fee_per_minute_cents, daily_cap_cents, conversation_after_count, created_by
)
select daycare.id, date '2000-01-01', daycare.closes_at, 5, 100, 4000, 3, daycare.created_by
from public.daycares daycare
where not exists (
  select 1 from public.late_pickup_policies policy where policy.daycare_id = daycare.id
);

create or replace function public.save_late_pickup_policy(
  p_fee_per_minute_cents integer,
  p_grace_minutes integer,
  p_daily_cap_cents integer,
  p_conversation_after_count integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_daycare_id uuid := public.get_my_daycare_id();
  v_effective_from date := public.center_today() + 1;
  v_closing_time time;
  v_policy_id uuid;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Admin access required';
  end if;
  if p_fee_per_minute_cents < 0 or p_fee_per_minute_cents > 10000 then
    raise exception 'Fee per minute must be between $0 and $100';
  end if;
  if p_grace_minutes < 0 or p_grace_minutes > 120 then
    raise exception 'Grace period must be between 0 and 120 minutes';
  end if;
  if p_daily_cap_cents < 0 or p_daily_cap_cents > 100000 then
    raise exception 'Daily cap must be between $0 and $1,000';
  end if;
  if p_conversation_after_count < 1 or p_conversation_after_count > 20 then
    raise exception 'Conversation threshold must be between 1 and 20 pickups';
  end if;

  select daycare.closes_at into v_closing_time
  from public.daycares daycare where daycare.id = v_daycare_id;

  insert into public.late_pickup_policies (
    daycare_id, effective_from, closing_time, grace_minutes,
    fee_per_minute_cents, daily_cap_cents, conversation_after_count, created_by
  ) values (
    v_daycare_id, v_effective_from, v_closing_time, p_grace_minutes,
    p_fee_per_minute_cents, p_daily_cap_cents, p_conversation_after_count, auth.uid()
  )
  on conflict (daycare_id, effective_from) do update set
    closing_time = excluded.closing_time,
    grace_minutes = excluded.grace_minutes,
    fee_per_minute_cents = excluded.fee_per_minute_cents,
    daily_cap_cents = excluded.daily_cap_cents,
    conversation_after_count = excluded.conversation_after_count,
    created_by = auth.uid(),
    created_at = now()
  returning id into v_policy_id;

  return v_policy_id;
end;
$$;

revoke all on function public.save_late_pickup_policy(integer, integer, integer, integer)
  from public, anon;
grant execute on function public.save_late_pickup_policy(integer, integer, integer, integer)
  to authenticated;

comment on function public.save_late_pickup_policy(integer, integer, integer, integer) is
  'Admin Group 11e: saves a versioned late-pickup policy effective the next center day.';

create or replace function public.record_audit_log_export(p_row_count integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Admin access required';
  end if;
  insert into public.audit_log (
    daycare_id, actor_id, action, entity_type, after
  ) values (
    public.get_my_daycare_id(), auth.uid(), 'export', 'audit_log',
    jsonb_build_object('row_count', greatest(coalesce(p_row_count, 0), 0), 'format', 'csv')
  );
end;
$$;

revoke all on function public.record_audit_log_export(integer) from public, anon;
grant execute on function public.record_audit_log_export(integer) to authenticated;
