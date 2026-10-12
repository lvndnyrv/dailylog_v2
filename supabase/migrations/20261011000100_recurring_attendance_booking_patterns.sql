-- Recurring child bookings provide a durable planning baseline. A dated
-- child_attendance_bookings row remains the explicit override for one day.
create table public.child_attendance_booking_patterns (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references public.daycares(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  weekdays smallint[] not null,
  arrives_at time not null,
  leaves_at time not null,
  starts_on date not null,
  ends_on date,
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint child_booking_pattern_one_per_child unique (child_id),
  constraint child_booking_pattern_weekdays_check check (
    cardinality(weekdays) between 1 and 7
    and weekdays <@ array[1,2,3,4,5,6,7]::smallint[]
  ),
  constraint child_booking_pattern_times_check check (arrives_at < leaves_at),
  constraint child_booking_pattern_dates_check check (ends_on is null or ends_on >= starts_on)
);

create index child_attendance_booking_patterns_center_idx
  on public.child_attendance_booking_patterns(daycare_id, starts_on, ends_on);

alter table public.child_attendance_booking_patterns enable row level security;

create policy "admins read recurring attendance planning"
  on public.child_attendance_booking_patterns for select to authenticated
  using (
    daycare_id = public.get_my_daycare_id()
    and public.is_admin()
    and public.has_permission('rooms', 'view')
  );

create trigger child_attendance_booking_patterns_updated_at
  before update on public.child_attendance_booking_patterns
  for each row execute function public.update_updated_at();

create trigger audit_child_attendance_booking_patterns
  after insert or update or delete on public.child_attendance_booking_patterns
  for each row execute function public.audit_write();

create function public.save_child_attendance_booking_pattern(
  p_child uuid,
  p_weekdays smallint[],
  p_arrives_at time,
  p_leaves_at time,
  p_starts_on date,
  p_ends_on date default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_center public.daycares;
  v_pattern_id uuid;
  v_weekdays smallint[];
begin
  if not public.is_admin() or not public.has_permission('rooms', 'edit') then
    raise exception 'Room editing permission required';
  end if;

  select daycare.* into v_center
    from public.daycares daycare
   where daycare.id = public.get_my_daycare_id();
  if not found then raise exception 'Center unavailable'; end if;

  if not exists (
    select 1 from public.children child
     where child.id = p_child
       and child.daycare_id = v_center.id
       and child.archived_at is null
  ) then
    raise exception 'Child unavailable';
  end if;

  select array_agg(distinct weekday order by weekday)
    into v_weekdays
    from unnest(coalesce(p_weekdays, '{}'::smallint[])) weekday;

  if cardinality(coalesce(v_weekdays, '{}'::smallint[])) = 0
     or not (v_weekdays <@ array[1,2,3,4,5,6,7]::smallint[]) then
    raise exception 'Choose at least one valid weekday';
  end if;
  if p_arrives_at is null or p_leaves_at is null
     or p_arrives_at >= p_leaves_at
     or p_arrives_at < v_center.opens_at
     or p_leaves_at > v_center.closes_at then
    raise exception 'Booking times must be within center hours, with pickup after arrival';
  end if;
  if p_starts_on is null or (p_ends_on is not null and p_ends_on < p_starts_on) then
    raise exception 'Choose a valid recurring schedule date range';
  end if;

  insert into public.child_attendance_booking_patterns (
    daycare_id, child_id, weekdays, arrives_at, leaves_at,
    starts_on, ends_on, updated_by
  ) values (
    v_center.id, p_child, v_weekdays, p_arrives_at, p_leaves_at,
    p_starts_on, p_ends_on, auth.uid()
  )
  on conflict (child_id) do update set
    weekdays = excluded.weekdays,
    arrives_at = excluded.arrives_at,
    leaves_at = excluded.leaves_at,
    starts_on = excluded.starts_on,
    ends_on = excluded.ends_on,
    updated_by = auth.uid()
  returning id into v_pattern_id;

  return v_pattern_id;
end;
$$;

create function public.delete_child_attendance_booking_pattern(p_child uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() or not public.has_permission('rooms', 'edit') then
    raise exception 'Room editing permission required';
  end if;
  delete from public.child_attendance_booking_patterns pattern
   where pattern.child_id = p_child
     and pattern.daycare_id = public.get_my_daycare_id();
end;
$$;

revoke all on function public.save_child_attendance_booking_pattern(uuid,smallint[],time,time,date,date) from public, anon;
revoke all on function public.delete_child_attendance_booking_pattern(uuid) from public, anon;
grant execute on function public.save_child_attendance_booking_pattern(uuid,smallint[],time,time,date,date) to authenticated;
grant execute on function public.delete_child_attendance_booking_pattern(uuid) to authenticated;

create or replace function public._forecast_children(p_center uuid,p_date date)
returns table(child_id uuid,room_id uuid,arrives_at timestamptz,leaves_at timestamptz,uncertain boolean)
language sql stable security definer set search_path=public as $$
  select child.id, coalesce(move.to_classroom_id, child.classroom_id),
    (p_date + coalesce(booking.arrives_at, pattern.arrives_at, center.opens_at)) at time zone center.timezone,
    (p_date + coalesce(booking.leaves_at, pattern.leaves_at, center.closes_at)) at time zone center.timezone,
    booking.child_id is null and pattern.child_id is null
  from public.children child
  join public.daycares center on center.id = child.daycare_id
  left join public.child_attendance_bookings booking
    on booking.child_id = child.id and booking.booked_on = p_date
  left join public.child_attendance_booking_patterns pattern
    on pattern.child_id = child.id
   and pattern.starts_on <= p_date
   and (pattern.ends_on is null or pattern.ends_on >= p_date)
  left join lateral (
    select transition.to_classroom_id
      from public.room_transition_plans transition
     where transition.child_id = child.id
       and transition.status = 'planned'
       and transition.move_on <= p_date
     order by transition.move_on desc
     limit 1
  ) move on true
  where child.daycare_id = p_center
    and child.archived_at is null
    and coalesce(child.enrolled_on, '-infinity'::date) <= p_date
    and case
      when booking.child_id is not null then booking.expected
      when pattern.child_id is not null then extract(isodow from p_date)::smallint = any(pattern.weekdays)
      else true
    end
    and not exists (
      select 1 from public.child_departures departure
       where departure.child_id = child.id
         and departure.status in ('scheduled', 'completed')
         and departure.last_day < p_date
    )
    and not exists (
      select 1 from public.parent_absence_reports absence
       where absence.child_id = child.id
         and absence.status = 'active'
         and p_date between absence.starts_on and absence.ends_on
    )
    and not exists (
      select 1 from public.attendance_records attendance
       where attendance.child_id = child.id
         and attendance.date = p_date
         and attendance.status = 'absent'
    );
$$;

revoke all on table public.child_attendance_booking_patterns from anon;
