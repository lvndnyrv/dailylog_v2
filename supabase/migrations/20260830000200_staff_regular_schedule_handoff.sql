-- Admin-maintained regular schedules are the source for educator-visible,
-- published shifts. Saving a pattern materializes the next twelve weeks while
-- preserving manual shift overrides.

create table if not exists public.staff_regular_schedules (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references public.daycares(id) on delete cascade,
  staff_member_id uuid not null references public.staff_members(id) on delete cascade,
  classroom_id uuid references public.classrooms(id) on delete set null,
  weekday smallint not null check (weekday between 1 and 7),
  starts_local time not null,
  ends_local time not null,
  unpaid_break_minutes integer not null default 0
    check (unpaid_break_minutes between 0 and 720),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (staff_member_id, weekday),
  check (ends_local > starts_local),
  check (unpaid_break_minutes < extract(epoch from (ends_local - starts_local)) / 60)
);

create index if not exists staff_regular_schedules_center_idx
  on public.staff_regular_schedules (daycare_id, staff_member_id);

drop trigger if exists staff_regular_schedules_updated_at
  on public.staff_regular_schedules;
create trigger staff_regular_schedules_updated_at
  before update on public.staff_regular_schedules
  for each row execute function public.update_updated_at();

alter table public.staff_regular_schedules enable row level security;

drop policy if exists "staff read own regular schedule"
  on public.staff_regular_schedules;
create policy "staff read own regular schedule"
  on public.staff_regular_schedules for select
  using (
    staff_member_id = public.my_staff_member_id()
    or (
      public.has_permission('staff', 'view')
      and daycare_id = public.get_my_daycare_id()
    )
  );

drop policy if exists "permitted staff manage regular schedules"
  on public.staff_regular_schedules;
create policy "permitted staff manage regular schedules"
  on public.staff_regular_schedules for all
  using (
    public.has_permission('staff', 'edit')
    and daycare_id = public.get_my_daycare_id()
  )
  with check (
    public.has_permission('staff', 'edit')
    and daycare_id = public.get_my_daycare_id()
  );

alter table public.staff_shifts
  add column if not exists regular_schedule_id uuid
    references public.staff_regular_schedules(id) on delete set null;

create index if not exists staff_shifts_regular_schedule_idx
  on public.staff_shifts (regular_schedule_id, starts_at)
  where regular_schedule_id is not null;

create or replace function public.save_staff_regular_schedule(
  p_staff_member_id uuid,
  p_schedule jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_daycare_id uuid;
  v_profile_id uuid;
  v_timezone text;
  v_today date;
  v_generated integer := 0;
begin
  if auth.uid() is null or not public.has_permission('staff', 'edit') then
    raise exception 'Staff edit permission required';
  end if;
  if jsonb_typeof(coalesce(p_schedule, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_schedule, '[]'::jsonb)) > 7 then
    raise exception 'Schedule must contain at most seven days';
  end if;

  select member.daycare_id, member.profile_id, daycare.timezone
    into v_daycare_id, v_profile_id, v_timezone
    from public.staff_members member
    join public.daycares daycare on daycare.id = member.daycare_id
   where member.id = p_staff_member_id
     and member.daycare_id = public.get_my_daycare_id()
     and member.status = 'active'
     and member.archived_at is null;

  if v_daycare_id is null then
    raise exception 'Active staff record not found in this center';
  end if;

  v_today := public.center_today();

  delete from public.staff_shifts shift
   where shift.staff_member_id = p_staff_member_id
     and shift.regular_schedule_id in (
       select schedule.id
         from public.staff_regular_schedules schedule
        where schedule.staff_member_id = p_staff_member_id
     )
     and shift.starts_at >= v_today::timestamp at time zone v_timezone
     and shift.status in ('draft', 'published');

  delete from public.staff_regular_schedules schedule
   where schedule.staff_member_id = p_staff_member_id;

  insert into public.staff_regular_schedules (
    daycare_id,
    staff_member_id,
    classroom_id,
    weekday,
    starts_local,
    ends_local,
    unpaid_break_minutes,
    created_by
  )
  select
    v_daycare_id,
    p_staff_member_id,
    entry.classroom_id,
    entry.weekday,
    entry.starts_local,
    entry.ends_local,
    coalesce(entry.unpaid_break_minutes, 0),
    auth.uid()
  from jsonb_to_recordset(coalesce(p_schedule, '[]'::jsonb)) as entry(
    weekday smallint,
    starts_local time,
    ends_local time,
    unpaid_break_minutes integer,
    classroom_id uuid
  )
  where entry.weekday between 1 and 7;

  if (
    select count(*)
      from public.staff_regular_schedules schedule
     where schedule.staff_member_id = p_staff_member_id
  ) <> jsonb_array_length(coalesce(p_schedule, '[]'::jsonb)) then
    raise exception 'Every enabled schedule day requires valid start and end times';
  end if;

  with candidate_shifts as (
    select
      schedule.id as regular_schedule_id,
      schedule.classroom_id,
      day::date as local_date,
      (day::date + schedule.starts_local) at time zone v_timezone as starts_at,
      (day::date + schedule.ends_local) at time zone v_timezone as ends_at,
      schedule.unpaid_break_minutes
    from public.staff_regular_schedules schedule
    cross join generate_series(v_today, v_today + 83, interval '1 day') day
    where schedule.staff_member_id = p_staff_member_id
      and extract(isodow from day)::smallint = schedule.weekday
  ), inserted as (
    insert into public.staff_shifts (
      daycare_id,
      staff_member_id,
      classroom_id,
      starts_at,
      ends_at,
      unpaid_break_minutes,
      status,
      notes,
      created_by,
      published_at,
      regular_schedule_id
    )
    select
      v_daycare_id,
      p_staff_member_id,
      candidate.classroom_id,
      candidate.starts_at,
      candidate.ends_at,
      candidate.unpaid_break_minutes,
      'published',
      'Regular schedule',
      auth.uid(),
      now(),
      candidate.regular_schedule_id
    from candidate_shifts candidate
    where not exists (
      select 1
        from public.staff_shifts existing
       where existing.staff_member_id = p_staff_member_id
         and existing.status <> 'cancelled'
         and existing.starts_at < candidate.ends_at
         and existing.ends_at > candidate.starts_at
    )
    returning id
  )
  select count(*) into v_generated from inserted;

  if v_profile_id is not null and v_profile_id <> auth.uid() then
    insert into public.notifications (
      daycare_id, profile_id, kind, title, body, payload
    ) values (
      v_daycare_id,
      v_profile_id,
      'schedule_update',
      'Your work schedule was updated',
      'Your regular weekly schedule is ready in My time.',
      jsonb_build_object(
        'type', 'schedule_update',
        'screen', 'MyTime',
        'staffMemberId', p_staff_member_id
      )
    );
  end if;

  return v_generated;
end;
$$;

revoke all on function public.save_staff_regular_schedule(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_staff_regular_schedule(uuid, jsonb)
  to authenticated;

comment on function public.save_staff_regular_schedule(uuid, jsonb) is
  'Replaces one staff member regular weekly pattern and publishes the next twelve weeks without overwriting manual shifts.';

notify pgrst, 'reload schema';
