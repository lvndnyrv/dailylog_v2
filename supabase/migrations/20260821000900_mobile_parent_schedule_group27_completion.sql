-- Parent mobile Group 27 completion: make closure promises and room-transition
-- dates operational, not merely presentational.

-- The Group 27 product contract says closed days are never billed. The admin UI
-- already creates only no-charge closures; narrow the database contract too.
update public.center_closures
set billing_treatment = 'no_charge'
where billing_treatment <> 'no_charge';

alter table public.center_closures
  drop constraint if exists center_closures_billing_treatment_check;
alter table public.center_closures
  add constraint center_closures_billing_treatment_check
  check (billing_treatment = 'no_charge');

create or replace function public.next_center_open_date(
  p_daycare_id uuid,
  p_after_date date
)
returns date
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_candidate date := p_after_date + 1;
  v_checked int := 0;
begin
  if p_daycare_id is null or p_after_date is null then return null; end if;

  loop
    if extract(isodow from v_candidate) between 1 and 5
       and not exists (
         select 1
         from public.center_closures closure
         where closure.daycare_id = p_daycare_id
           and v_candidate between closure.starts_on and closure.ends_on
       ) then
      return v_candidate;
    end if;

    v_candidate := v_candidate + 1;
    v_checked := v_checked + 1;
    if v_checked > 366 then
      raise exception 'No open center date was found in the next year';
    end if;
  end loop;
end;
$$;

revoke all on function public.next_center_open_date(uuid, date)
  from public, anon, authenticated;

create or replace function public.guard_room_transition_plan_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.children child
    where child.id = new.child_id and child.daycare_id = new.daycare_id
  ) then
    raise exception 'The child must belong to the transition center';
  end if;

  if not exists (
    select 1 from public.classrooms room
    where room.id = new.from_classroom_id and room.daycare_id = new.daycare_id
  ) or not exists (
    select 1 from public.classrooms room
    where room.id = new.to_classroom_id and room.daycare_id = new.daycare_id
  ) then
    raise exception 'Both rooms must belong to the transition center';
  end if;

  if new.status = 'planned' then
    if extract(isodow from new.move_on) not between 1 and 5 then
      raise exception 'A room move must be scheduled on an open weekday';
    end if;
    if exists (
      select 1 from public.center_closures closure
      where closure.daycare_id = new.daycare_id
        and new.move_on between closure.starts_on and closure.ends_on
    ) then
      raise exception 'A room move cannot be scheduled while the center is closed';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_room_transition_plan_integrity()
  from public, anon, authenticated;

drop trigger if exists guard_room_transition_plan_integrity
  on public.room_transition_plans;
create trigger guard_room_transition_plan_integrity
  before insert or update of daycare_id, child_id, from_classroom_id,
    to_classroom_id, move_on, status
  on public.room_transition_plans
  for each row execute function public.guard_room_transition_plan_integrity();

create or replace function public.get_parent_schedule_hub()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_daycare public.daycares%rowtype;
  v_today date;
  v_closures jsonb := '[]'::jsonb;
  v_moves jsonb := '[]'::jsonb;
begin
  select * into v_profile
  from public.profiles
  where id = auth.uid() and role = 'parent' and archived_at is null;

  if v_profile.id is null then
    raise exception 'A signed-in parent account is required';
  end if;

  select daycare.* into v_daycare
  from public.daycares daycare
  where daycare.id = coalesce(
    v_profile.daycare_id,
    (select child.daycare_id
       from public.parent_children link
       join public.children child on child.id = link.child_id
      where link.parent_id = auth.uid()
      limit 1)
  );

  if v_daycare.id is null then
    raise exception 'A linked childcare center is required';
  end if;

  v_today := (now() at time zone coalesce(v_daycare.timezone, 'America/Toronto'))::date;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', closure.id,
    'starts_on', closure.starts_on,
    'ends_on', closure.ends_on,
    'reopens_on', public.next_center_open_date(closure.daycare_id, closure.ends_on),
    'reason', closure.reason,
    'family_message', closure.family_message,
    'billing_treatment', closure.billing_treatment,
    'reminder_days_before', closure.reminder_days_before,
    'published_at', closure.published_at
  ) order by closure.starts_on, closure.ends_on, closure.reason), '[]'::jsonb)
  into v_closures
  from public.center_closures closure
  where closure.daycare_id = v_daycare.id
    and closure.family_visible
    and closure.ends_on >= v_today - 30;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', plan.id,
    'child_id', child.id,
    'child_first_name', child.first_name,
    'child_last_name', child.last_name,
    'from_room_id', from_room.id,
    'from_room_name', from_room.name,
    'to_room_id', to_room.id,
    'to_room_name', to_room.name,
    'move_on', plan.move_on,
    'transition_week', plan.transition_week,
    'transition_starts_on', case when plan.transition_week then coalesce(
      plan.transition_starts_on,
      date_trunc('week', plan.move_on::timestamp - interval '7 days')::date
    ) else null end,
    'transition_ends_on', case when plan.transition_week then coalesce(
      plan.transition_ends_on,
      date_trunc('week', plan.move_on::timestamp - interval '7 days')::date + 4
    ) else null end,
    'current_tuition_cents', plan.current_tuition_cents,
    'new_tuition_cents', plan.new_tuition_cents,
    'currency', plan.currency,
    'family_message', plan.family_message,
    'status', plan.status,
    'published_at', plan.published_at
  ) order by plan.move_on, child.first_name), '[]'::jsonb)
  into v_moves
  from public.room_transition_plans plan
  join public.children child on child.id = plan.child_id
  join public.classrooms from_room on from_room.id = plan.from_classroom_id
  join public.classrooms to_room on to_room.id = plan.to_classroom_id
  where plan.daycare_id = v_daycare.id
    and plan.family_visible
    and plan.status in ('planned', 'completed')
    and plan.move_on >= v_today - 30
    and plan.child_id in (select public.my_child_ids());

  return jsonb_build_object(
    'today', v_today,
    'daycare', jsonb_build_object(
      'id', v_daycare.id,
      'name', v_daycare.name,
      'timezone', v_daycare.timezone,
      'opens_at', to_char(v_daycare.opens_at, 'HH24:MI'),
      'closes_at', to_char(v_daycare.closes_at, 'HH24:MI')
    ),
    'closures', v_closures,
    'room_moves', v_moves
  );
end;
$$;

revoke all on function public.get_parent_schedule_hub() from public, anon;
grant execute on function public.get_parent_schedule_hub() to authenticated;
