-- =============================================================================
-- Center closure operational guards.
--
-- A published closure is more than a family-facing calendar item: the center
-- must not accept a tour or a child check-in on that local calendar day, and a
-- late-pickup fee cannot be created. Existing booked tours are deliberately
-- not cancelled silently; the closure is rejected until the office reschedules
-- or cancels them. Unbooked tour availability is removed automatically.
-- =============================================================================

create or replace function public.guard_center_closure_against_booked_tours()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conflict timestamptz;
  v_timezone text;
begin
  select daycare.timezone into v_timezone
  from public.daycares daycare
  where daycare.id = new.daycare_id;

  select slot.starts_at into v_conflict
  from public.enrollment_tour_slots slot
  where slot.daycare_id = new.daycare_id
    and slot.status = 'booked'
    and (slot.starts_at at time zone coalesce(v_timezone, 'America/Toronto'))::date
      between new.starts_on and new.ends_on
  order by slot.starts_at
  limit 1;

  if v_conflict is not null then
    raise exception 'A family tour is already booked during this closure. Reschedule or cancel the tour first.';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_center_closure_against_booked_tours()
  from public, anon, authenticated;

drop trigger if exists guard_center_closure_against_booked_tours
  on public.center_closures;
create trigger guard_center_closure_against_booked_tours
  before insert or update of starts_on, ends_on on public.center_closures
  for each row execute function public.guard_center_closure_against_booked_tours();

create or replace function public.close_open_tour_slots_for_center_closure()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_timezone text;
begin
  select daycare.timezone into v_timezone
  from public.daycares daycare
  where daycare.id = new.daycare_id;

  update public.enrollment_tour_slots slot
  set status = 'cancelled'
  where slot.daycare_id = new.daycare_id
    and slot.status = 'open'
    and (slot.starts_at at time zone coalesce(v_timezone, 'America/Toronto'))::date
      between new.starts_on and new.ends_on;

  return new;
end;
$$;

revoke all on function public.close_open_tour_slots_for_center_closure()
  from public, anon, authenticated;

drop trigger if exists close_open_tour_slots_for_center_closure
  on public.center_closures;
create trigger close_open_tour_slots_for_center_closure
  after insert or update of starts_on, ends_on on public.center_closures
  for each row execute function public.close_open_tour_slots_for_center_closure();

create or replace function public.guard_tour_slot_on_center_closure()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_local_date date;
  v_timezone text;
begin
  if new.status = 'cancelled' then return new; end if;

  select daycare.timezone into v_timezone
  from public.daycares daycare
  where daycare.id = new.daycare_id;
  v_local_date := (
    new.starts_at at time zone coalesce(v_timezone, 'America/Toronto')
  )::date;

  if exists (
    select 1
    from public.center_closures closure
    where closure.daycare_id = new.daycare_id
      and v_local_date between closure.starts_on and closure.ends_on
  ) then
    raise exception 'Tours cannot be scheduled while the center is closed.';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_tour_slot_on_center_closure()
  from public, anon, authenticated;

drop trigger if exists guard_tour_slot_on_center_closure
  on public.enrollment_tour_slots;
create trigger guard_tour_slot_on_center_closure
  before insert or update of starts_at, daycare_id, status
  on public.enrollment_tour_slots
  for each row execute function public.guard_tour_slot_on_center_closure();

create or replace function public.guard_attendance_on_center_closure()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.checked_in_at is not null and exists (
    select 1
    from public.center_closures closure
    where closure.daycare_id = new.daycare_id
      and new.date between closure.starts_on and closure.ends_on
  ) then
    raise exception 'Check-in is unavailable because the center is closed today.';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_attendance_on_center_closure()
  from public, anon, authenticated;

drop trigger if exists guard_attendance_on_center_closure
  on public.attendance_records;
create trigger guard_attendance_on_center_closure
  before insert or update of daycare_id, date, checked_in_at
  on public.attendance_records
  for each row execute function public.guard_attendance_on_center_closure();

create or replace function public.guard_late_pickup_on_center_closure()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.center_closures closure
    where closure.daycare_id = new.daycare_id
      and new.occurred_on between closure.starts_on and closure.ends_on
  ) then
    raise exception 'Late-pickup fees do not apply on a center closure day.';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_late_pickup_on_center_closure()
  from public, anon, authenticated;

drop trigger if exists guard_late_pickup_on_center_closure
  on public.late_pickup_events;
create trigger guard_late_pickup_on_center_closure
  before insert or update of daycare_id, occurred_on
  on public.late_pickup_events
  for each row execute function public.guard_late_pickup_on_center_closure();
