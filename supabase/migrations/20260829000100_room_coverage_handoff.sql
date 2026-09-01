-- Admin ↔ educator room-coverage handoff.
-- A time-bound coverage assignment must grant the educator operational room
-- access for its active window, notify them, and never overlap another active
-- assignment for the same person.

create or replace function public.my_classroom_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select assignment.classroom_id
    from public.educator_classrooms assignment
   where assignment.educator_id = auth.uid()
  union
  select profile.classroom_id
    from public.profiles profile
   where profile.id = auth.uid()
     and profile.classroom_id is not null
  union
  select coverage.classroom_id
    from public.room_coverage_assignments coverage
    join public.staff_members staff on staff.id = coverage.staff_member_id
   where staff.profile_id = auth.uid()
     and staff.status = 'active'
     and staff.archived_at is null
     and coverage.status in ('assigned', 'accepted')
     and coverage.starts_at <= now()
     and coverage.ends_at > now()
$$;

create or replace function public.enforce_room_coverage_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room_daycare uuid;
  v_staff_daycare uuid;
  v_staff_active boolean;
begin
  select room.daycare_id
    into v_room_daycare
    from public.classrooms room
   where room.id = new.classroom_id
     and room.archived_at is null;

  select staff.daycare_id,
         staff.status = 'active' and staff.archived_at is null
    into v_staff_daycare, v_staff_active
    from public.staff_members staff
   where staff.id = new.staff_member_id;

  if v_room_daycare is null or v_staff_daycare is null
     or v_room_daycare <> new.daycare_id
     or v_staff_daycare <> new.daycare_id then
    raise exception using
      errcode = '23514',
      message = 'Coverage room and educator must belong to the same center';
  end if;
  if not coalesce(v_staff_active, false) then
    raise exception using
      errcode = '23514',
      message = 'Coverage can only be assigned to an active educator';
  end if;

  if new.status in ('assigned', 'accepted') then
    perform pg_advisory_xact_lock(hashtextextended(new.staff_member_id::text, 0));
    if exists (
      select 1
        from public.room_coverage_assignments existing
       where existing.staff_member_id = new.staff_member_id
         and existing.id <> new.id
         and existing.status in ('assigned', 'accepted')
         and existing.starts_at < new.ends_at
         and existing.ends_at > new.starts_at
    ) then
      raise exception using
        errcode = '23P01',
        message = 'This educator already has room coverage during that time';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_room_coverage_integrity
  on public.room_coverage_assignments;
create trigger enforce_room_coverage_integrity
  before insert or update of daycare_id, classroom_id, staff_member_id,
    starts_at, ends_at, status
  on public.room_coverage_assignments
  for each row execute function public.enforce_room_coverage_integrity();

create or replace function public.notify_room_coverage_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient uuid;
  v_room_name text;
  v_payload jsonb;
begin
  if new.status <> 'assigned' or new.ends_at <= now() then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and old.status = new.status
     and old.classroom_id = new.classroom_id
     and old.starts_at = new.starts_at
     and old.ends_at = new.ends_at then
    return new;
  end if;

  select staff.profile_id into v_recipient
    from public.staff_members staff
   where staff.id = new.staff_member_id;
  select room.name into v_room_name
    from public.classrooms room
   where room.id = new.classroom_id;
  if v_recipient is null then return new; end if;

  v_payload := jsonb_build_object(
    'type', 'coverage_assignment',
    'screen', 'RoomRatios',
    'roomId', new.classroom_id,
    'assignmentId', new.id,
    'startsAt', new.starts_at,
    'endsAt', new.ends_at
  );

  insert into public.notifications (
    daycare_id, profile_id, kind, title, body, payload
  ) values (
    new.daycare_id,
    v_recipient,
    'coverage_assignment',
    'Room coverage assigned',
    'You have been assigned to cover ' || coalesce(v_room_name, 'a classroom') || '.',
    v_payload
  );

  insert into public.notification_outbox (
    daycare_id, recipient_id, channel, kind, title, body, payload,
    dedupe_key
  ) values (
    new.daycare_id,
    v_recipient,
    'push',
    'coverage_assignment',
    'Room coverage assigned',
    'You have been assigned to cover ' || coalesce(v_room_name, 'a classroom') || '.',
    v_payload,
    'coverage-assignment:' || new.id::text
  ) on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists notify_room_coverage_assignment
  on public.room_coverage_assignments;
create trigger notify_room_coverage_assignment
  after insert or update of classroom_id, starts_at, ends_at, status
  on public.room_coverage_assignments
  for each row execute function public.notify_room_coverage_assignment();
