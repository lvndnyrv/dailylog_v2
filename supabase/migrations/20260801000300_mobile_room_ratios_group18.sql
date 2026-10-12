-- ==========================================================================
-- Mobile Group 18 — live ratio alerts and temporary floater assignments
-- ==========================================================================

create table if not exists public.room_ratio_events (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references public.daycares(id) on delete cascade,
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  started_at timestamptz not null default now(),
  resolved_at timestamptz,
  peak_present integer not null default 0 check (peak_present >= 0),
  minimum_staff integer not null default 0 check (minimum_staff >= 0),
  required_staff integer not null default 0 check (required_staff >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists room_ratio_events_one_active_room_idx
  on public.room_ratio_events (classroom_id)
  where resolved_at is null;

create index if not exists room_ratio_events_center_started_idx
  on public.room_ratio_events (daycare_id, started_at desc);

drop trigger if exists room_ratio_events_updated_at on public.room_ratio_events;
create trigger room_ratio_events_updated_at
  before update on public.room_ratio_events
  for each row execute function public.update_updated_at();

alter table public.room_ratio_events enable row level security;

drop policy if exists "staff read ratio events" on public.room_ratio_events;
create policy "staff read ratio events"
  on public.room_ratio_events for select
  using (public.is_staff() and daycare_id = public.get_my_daycare_id());

drop policy if exists "admins manage ratio events" on public.room_ratio_events;
create policy "admins manage ratio events"
  on public.room_ratio_events for all
  using (public.is_admin() and daycare_id = public.get_my_daycare_id())
  with check (public.is_admin() and daycare_id = public.get_my_daycare_id());

drop trigger if exists audit_room_ratio_events on public.room_ratio_events;
create trigger audit_room_ratio_events
  after insert or update on public.room_ratio_events
  for each row execute function public.audit_write();

-- Internal, tenant-independent calculation used by database triggers. Its
-- execution privilege is revoked from API roles below.
create or replace function public._room_ratio_snapshot(p_classroom_id uuid)
returns table (
  present_count integer,
  staff_count integer,
  required_staff integer,
  max_children_per_staff integer,
  over_by integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_daycare_id uuid;
  v_ratio integer;
  v_tracking boolean;
  v_timezone text;
  v_today date;
  v_present integer;
  v_staff integer;
  v_required integer;
begin
  select c.daycare_id,
         greatest(coalesce(c.ratio_children_per_educator, 1), 1),
         d.time_tracking_enabled,
         coalesce(d.timezone, 'UTC')
    into v_daycare_id, v_ratio, v_tracking, v_timezone
    from public.classrooms c
    join public.daycares d on d.id = c.daycare_id
   where c.id = p_classroom_id
     and c.archived_at is null;

  if v_daycare_id is null then
    return;
  end if;
  v_today := (now() at time zone v_timezone)::date;

  select count(*)::integer
    into v_present
    from public.attendance_records a
    join public.children ch on ch.id = a.child_id
   where ch.classroom_id = p_classroom_id
     and a.date = v_today
     and a.checked_in_at is not null
     and a.checked_out_at is null
     and a.status in ('present', 'late');

  with staff_presence as (
    select
      sm.id as staff_member_id,
      p.id as profile_id,
      coalesce(
        (
          select coverage.classroom_id
            from public.room_coverage_assignments coverage
           where coverage.staff_member_id = sm.id
             and coverage.status in ('assigned', 'accepted')
             and coverage.starts_at <= now()
             and coverage.ends_at > now()
           order by coverage.starts_at desc
           limit 1
        ),
        (
          select entry.classroom_id
            from public.staff_time_entries entry
           where entry.staff_member_id = sm.id
             and entry.clocked_out_at is null
           order by entry.clocked_in_at desc
           limit 1
        ),
        p.classroom_id,
        (
          select ec.classroom_id
            from public.educator_classrooms ec
           where ec.educator_id = p.id
           order by ec.classroom_id
           limit 1
        )
      ) as effective_classroom_id,
      exists (
        select 1
          from public.staff_time_entries open_entry
         where open_entry.staff_member_id = sm.id
           and open_entry.clocked_out_at is null
      ) as is_clocked_in
    from public.staff_members sm
    join public.profiles p on p.id = sm.profile_id
   where sm.daycare_id = v_daycare_id
     and sm.status = 'active'
     and sm.archived_at is null
     and p.role = 'educator'
     and p.archived_at is null
  )
  select count(distinct profile_id)::integer
    into v_staff
    from staff_presence
   where effective_classroom_id = p_classroom_id
     and (not v_tracking or is_clocked_in);

  v_required := case
    when v_present = 0 then 0
    else ceil(v_present::numeric / v_ratio)::integer
  end;

  return query select
    v_present,
    coalesce(v_staff, 0),
    v_required,
    v_ratio,
    greatest(v_required - coalesce(v_staff, 0), 0);
end;
$$;

create or replace function public.get_mobile_room_ratios()
returns table (
  id uuid,
  name text,
  age_group text,
  present_count integer,
  staff_count integer,
  required_staff integer,
  max_children_per_staff integer,
  actual_children_per_staff integer,
  over_by integer,
  is_over_ratio boolean,
  over_since timestamptz,
  alert_after_minutes integer,
  alert_ready boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    room.id,
    room.name,
    room.age_group,
    snapshot.present_count,
    snapshot.staff_count,
    snapshot.required_staff,
    snapshot.max_children_per_staff,
    case
      when snapshot.staff_count = 0 then snapshot.present_count
      else ceil(snapshot.present_count::numeric / snapshot.staff_count)::integer
    end,
    snapshot.over_by,
    snapshot.over_by > 0,
    event.started_at,
    center.ratio_alert_after_minutes,
    snapshot.over_by > 0
      and event.started_at is not null
      and event.started_at <= now() - make_interval(mins => center.ratio_alert_after_minutes)
  from public.classrooms room
  join public.daycares center on center.id = room.daycare_id
  cross join lateral public._room_ratio_snapshot(room.id) snapshot
  left join public.room_ratio_events event
    on event.classroom_id = room.id and event.resolved_at is null
  where room.daycare_id = public.get_my_daycare_id()
    and room.archived_at is null
    and public.is_staff()
  order by (snapshot.over_by > 0) desc, room.min_age_months nulls last, room.name;
$$;

create or replace function public.list_available_ratio_floaters(p_classroom_id uuid)
returns table (
  staff_member_id uuid,
  profile_id uuid,
  full_name text,
  current_classroom_id uuid,
  current_classroom_name text,
  availability_note text
)
language sql
stable
security definer
set search_path = public
as $$
  with center as (
    select c.daycare_id, d.time_tracking_enabled
      from public.classrooms c
      join public.daycares d on d.id = c.daycare_id
     where c.id = p_classroom_id
       and c.daycare_id = public.get_my_daycare_id()
       and c.archived_at is null
       and public.is_staff()
  ), candidates as (
    select
      sm.id as staff_member_id,
      p.id as profile_id,
      p.full_name,
      coalesce(
        (
          select entry.classroom_id
            from public.staff_time_entries entry
           where entry.staff_member_id = sm.id
             and entry.clocked_out_at is null
           order by entry.clocked_in_at desc
           limit 1
        ),
        p.classroom_id
      ) as current_classroom_id,
      exists (
        select 1 from public.staff_time_entries entry
         where entry.staff_member_id = sm.id and entry.clocked_out_at is null
      ) as is_clocked_in,
      center.time_tracking_enabled
    from center
    join public.staff_members sm on sm.daycare_id = center.daycare_id
    join public.profiles p on p.id = sm.profile_id
   where sm.status = 'active'
     and sm.archived_at is null
     and p.role = 'educator'
     and p.archived_at is null
     and not exists (
       select 1
         from public.room_coverage_assignments active_assignment
        where active_assignment.staff_member_id = sm.id
          and active_assignment.status in ('assigned', 'accepted')
          and active_assignment.starts_at <= now()
          and active_assignment.ends_at > now()
     )
  ), available as (
    select candidate.*, source.name as current_classroom_name
      from candidates candidate
      left join public.classrooms source on source.id = candidate.current_classroom_id
      left join lateral public._room_ratio_snapshot(candidate.current_classroom_id) source_ratio on true
     where candidate.current_classroom_id is distinct from p_classroom_id
       and (not candidate.time_tracking_enabled or candidate.is_clocked_in)
       and (
         candidate.current_classroom_id is null
         or source_ratio.staff_count - 1 >= source_ratio.required_staff
       )
  )
  select
    available.staff_member_id,
    available.profile_id,
    available.full_name,
    available.current_classroom_id,
    available.current_classroom_name,
    case
      when available.current_classroom_id is null then 'Available · floater pool'
      else 'In ' || available.current_classroom_name || ' · can spare'
    end
  from available
  order by (available.current_classroom_id is null) desc, available.full_name;
$$;

create or replace function public._refresh_room_ratio_event(
  p_classroom_id uuid,
  p_allow_notification boolean default true
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.classrooms%rowtype;
  v_center public.daycares%rowtype;
  v_snapshot record;
  v_event_id uuid;
  v_new_event boolean := false;
  v_dedupe text;
begin
  if p_classroom_id is null then return; end if;

  select * into v_room
    from public.classrooms
   where id = p_classroom_id and archived_at is null;
  if v_room.id is null then return; end if;

  select * into v_center from public.daycares where id = v_room.daycare_id;
  select * into v_snapshot from public._room_ratio_snapshot(p_classroom_id);
  if v_snapshot is null then return; end if;

  select id into v_event_id
    from public.room_ratio_events
   where classroom_id = p_classroom_id and resolved_at is null
   for update;

  if v_snapshot.over_by > 0 then
    if v_event_id is null then
      insert into public.room_ratio_events (
        daycare_id, classroom_id, peak_present, minimum_staff, required_staff
      ) values (
        v_room.daycare_id, v_room.id, v_snapshot.present_count,
        v_snapshot.staff_count, v_snapshot.required_staff
      ) returning id into v_event_id;
      v_new_event := true;
    else
      update public.room_ratio_events
         set peak_present = greatest(peak_present, v_snapshot.present_count),
             minimum_staff = least(minimum_staff, v_snapshot.staff_count),
             required_staff = greatest(required_staff, v_snapshot.required_staff)
       where id = v_event_id;
    end if;

    if v_new_event and p_allow_notification and auth.uid() is not null then
      v_dedupe := 'ratio-alert:' || v_event_id::text;

      with recipients as (
        select distinct p.id as profile_id
          from public.profiles p
         where p.daycare_id = v_room.daycare_id
           and p.archived_at is null
           and (
             p.role in ('owner_admin', 'admin')
             or (
               p.role = 'educator'
               and (
                 p.classroom_id = v_room.id
                 or exists (
                   select 1 from public.educator_classrooms ec
                    where ec.educator_id = p.id and ec.classroom_id = v_room.id
                 )
                 or (v_center.ratio_notify_floaters and p.classroom_id is null)
               )
             )
           )
      )
      insert into public.notification_outbox (
        daycare_id, recipient_id, channel, kind, title, body, payload,
        dedupe_key, available_at
      )
      select
        v_room.daycare_id,
        recipient.profile_id,
        'push',
        'ratio_alert',
        v_room.name || ' is over ratio',
        v_snapshot.present_count || ' children with ' || v_snapshot.staff_count
          || ' educator(s). ' || v_snapshot.required_staff || ' required.',
        jsonb_build_object(
          'type', 'ratio_alert',
          'screen', 'RoomRatios',
          'roomId', v_room.id,
          'priority', 'high',
          'channelId', 'urgent'
        ),
        v_dedupe,
        now() + make_interval(mins => v_center.ratio_alert_after_minutes)
      from recipients recipient
      on conflict do nothing;

      if v_center.ratio_alert_after_minutes = 0 then
        insert into public.notifications (
          daycare_id, profile_id, kind, title, body, payload
        )
        select
          v_room.daycare_id,
          p.id,
          'ratio_alert',
          v_room.name || ' is over ratio',
          v_snapshot.present_count || ' children with ' || v_snapshot.staff_count
            || ' educator(s). ' || v_snapshot.required_staff || ' required.',
          jsonb_build_object('screen', 'RoomRatios', 'roomId', v_room.id)
        from public.profiles p
        where p.daycare_id = v_room.daycare_id
          and p.archived_at is null
          and p.role in ('owner_admin', 'admin', 'educator');
      end if;
    end if;
  elsif v_event_id is not null then
    update public.room_ratio_events
       set resolved_at = now()
     where id = v_event_id;

    update public.notification_outbox
       set status = 'failed',
           last_error = 'Ratio restored before alert delivery'
     where daycare_id = v_room.daycare_id
       and dedupe_key = 'ratio-alert:' || v_event_id::text
       and status = 'pending';
  end if;
end;
$$;

create or replace function public.assign_ratio_floater(
  p_classroom_id uuid,
  p_staff_member_id uuid,
  p_minutes integer default 120
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room record;
  v_candidate record;
  v_assignment_id uuid;
begin
  if not public.is_staff() then
    raise exception 'Staff access required';
  end if;
  if p_minutes < 30 or p_minutes > 480 then
    raise exception 'Coverage must be between 30 minutes and 8 hours';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_classroom_id::text, 0));
  perform 1 from public.staff_members where id = p_staff_member_id for update;

  select * into v_room
    from public.get_mobile_room_ratios()
   where id = p_classroom_id;
  if v_room.id is null then
    raise exception 'Classroom not found';
  end if;
  if not v_room.is_over_ratio then
    raise exception 'This room is already in ratio';
  end if;

  select * into v_candidate
    from public.list_available_ratio_floaters(p_classroom_id)
   where staff_member_id = p_staff_member_id;
  if v_candidate.staff_member_id is null then
    raise exception 'This educator is no longer available';
  end if;

  -- Serialize removals from the source room, then re-check its ratio. Two
  -- different educators cannot be moved concurrently if that would leave the
  -- source room under-staffed.
  if v_candidate.current_classroom_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(v_candidate.current_classroom_id::text, 0)
    );
    select * into v_candidate
      from public.list_available_ratio_floaters(p_classroom_id)
     where staff_member_id = p_staff_member_id;
    if v_candidate.staff_member_id is null then
      raise exception 'This educator is no longer available';
    end if;
  end if;

  insert into public.room_coverage_assignments (
    daycare_id, classroom_id, staff_member_id, starts_at, ends_at,
    status, notes, created_by
  ) values (
    public.get_my_daycare_id(), p_classroom_id, p_staff_member_id, now(),
    now() + make_interval(mins => p_minutes), 'accepted',
    'Mobile ratio restoration', auth.uid()
  ) returning id into v_assignment_id;

  insert into public.notifications (
    daycare_id, profile_id, kind, title, body, payload
  ) values (
    public.get_my_daycare_id(),
    v_candidate.profile_id,
    'ratio_alert',
    'Coverage assignment',
    'Please move to ' || v_room.name || ' to restore the room ratio.',
    jsonb_build_object(
      'screen', 'RoomRatios',
      'roomId', p_classroom_id,
      'assignmentId', v_assignment_id
    )
  );

  return v_assignment_id;
end;
$$;

create or replace function public.refresh_ratio_after_attendance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_id uuid;
  v_child_id uuid;
begin
  v_child_id := case when tg_op = 'DELETE' then old.child_id else new.child_id end;
  select classroom_id into v_room_id
    from public.children
   where id = v_child_id;
  perform public._refresh_room_ratio_event(v_room_id, auth.uid() is not null);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists attendance_refresh_ratio_event on public.attendance_records;
create trigger attendance_refresh_ratio_event
  after insert or update or delete on public.attendance_records
  for each row execute function public.refresh_ratio_after_attendance();

create or replace function public.refresh_ratio_after_coverage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_primary_room uuid;
  v_staff_member_id uuid;
  v_old_room uuid;
  v_new_room uuid;
begin
  if tg_op <> 'INSERT' then
    v_old_room := old.classroom_id;
    v_staff_member_id := old.staff_member_id;
  end if;
  if tg_op <> 'DELETE' then
    v_new_room := new.classroom_id;
    v_staff_member_id := new.staff_member_id;
  end if;

  select p.classroom_id into v_primary_room
    from public.staff_members sm
    join public.profiles p on p.id = sm.profile_id
   where sm.id = v_staff_member_id;

  perform public._refresh_room_ratio_event(v_old_room, auth.uid() is not null);
  perform public._refresh_room_ratio_event(v_new_room, auth.uid() is not null);
  if v_primary_room is distinct from v_old_room
     and v_primary_room is distinct from v_new_room then
    perform public._refresh_room_ratio_event(v_primary_room, auth.uid() is not null);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists coverage_refresh_ratio_event on public.room_coverage_assignments;
create trigger coverage_refresh_ratio_event
  after insert or update or delete on public.room_coverage_assignments
  for each row execute function public.refresh_ratio_after_coverage();

create or replace function public.refresh_ratio_after_staff_time()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_member_id uuid;
  v_primary_room uuid;
  v_old_room uuid;
  v_new_room uuid;
begin
  if tg_op <> 'INSERT' then
    v_old_room := old.classroom_id;
    v_staff_member_id := old.staff_member_id;
  end if;
  if tg_op <> 'DELETE' then
    v_new_room := new.classroom_id;
    v_staff_member_id := new.staff_member_id;
  end if;

  select p.classroom_id into v_primary_room
    from public.staff_members sm
    join public.profiles p on p.id = sm.profile_id
   where sm.id = v_staff_member_id;

  perform public._refresh_room_ratio_event(v_old_room, auth.uid() is not null);
  perform public._refresh_room_ratio_event(v_new_room, auth.uid() is not null);
  if v_primary_room is distinct from v_old_room
     and v_primary_room is distinct from v_new_room then
    perform public._refresh_room_ratio_event(v_primary_room, auth.uid() is not null);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists staff_time_refresh_ratio_event on public.staff_time_entries;
create trigger staff_time_refresh_ratio_event
  after insert or update or delete on public.staff_time_entries
  for each row execute function public.refresh_ratio_after_staff_time();

revoke all on function public._room_ratio_snapshot(uuid) from public, anon, authenticated;
revoke all on function public._refresh_room_ratio_event(uuid, boolean) from public, anon, authenticated;
revoke all on function public.get_mobile_room_ratios() from public;
revoke all on function public.list_available_ratio_floaters(uuid) from public;
revoke all on function public.assign_ratio_floater(uuid, uuid, integer) from public;

grant execute on function public.get_mobile_room_ratios() to authenticated;
grant execute on function public.list_available_ratio_floaters(uuid) to authenticated;
grant execute on function public.assign_ratio_floater(uuid, uuid, integer) to authenticated;

notify pgrst, 'reload schema';
