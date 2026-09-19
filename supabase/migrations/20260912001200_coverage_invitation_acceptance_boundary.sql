-- Pending coverage invitations reserve an educator against double-booking,
-- but do not grant child access or count as live room coverage until accepted.

create or replace function public._room_staff_presence(p_daycare_id uuid)
returns table (
  staff_member_id uuid,
  profile_id uuid,
  full_name text,
  effective_classroom_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select member.id, profile.id, profile.full_name,
    coalesce(
      (select coverage.classroom_id
         from public.room_coverage_assignments coverage
        where coverage.staff_member_id = member.id
          and coverage.status = 'accepted'
          and coverage.starts_at <= now()
          and coverage.ends_at > now()
        order by coverage.starts_at desc, coverage.id
        limit 1),
      (select entry.classroom_id
         from public.staff_time_entries entry
        where entry.staff_member_id = member.id
          and entry.clocked_out_at is null
          and entry.clocked_in_at <= now()
        order by entry.clocked_in_at desc, entry.id
        limit 1),
      profile.classroom_id,
      (select assignment.classroom_id
         from public.educator_classrooms assignment
         join public.classrooms room on room.id = assignment.classroom_id
        where assignment.educator_id = profile.id
          and room.daycare_id = p_daycare_id
          and room.archived_at is null
        order by assignment.classroom_id
        limit 1)
    )
  from public.staff_members member
  join public.profiles profile on profile.id = member.profile_id
  join public.daycares center on center.id = member.daycare_id
  where member.daycare_id = p_daycare_id
    and profile.daycare_id = p_daycare_id
    and member.status = 'active'
    and member.archived_at is null
    and profile.role = 'educator'
    and profile.archived_at is null
    and public.staff_is_ratio_eligible(member.id)
    and not exists (
      select 1 from public.staff_time_off_requests away
       where away.staff_member_id = member.id
         and away.status = 'approved'
         and (now() at time zone coalesce(center.timezone, 'UTC'))::date
             between away.starts_on and away.ends_on
    )
    and (
      not coalesce(center.time_tracking_enabled, false)
      or exists (
        select 1 from public.staff_time_entries entry
         where entry.staff_member_id = member.id
           and entry.clocked_out_at is null
           and entry.clocked_in_at <= now()
      )
    );
$$;

revoke all on function public._room_staff_presence(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.my_classroom_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select assignment.classroom_id as id
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
      join public.staff_members member on member.id = coverage.staff_member_id
     where member.profile_id = auth.uid()
       and member.status = 'active'
       and member.archived_at is null
       and coverage.status = 'accepted'
       and coverage.starts_at <= now()
       and coverage.ends_at > now()
  )
  select id from base
  union
  select partner.id
    from base
    cross join lateral public._active_room_combination(base.id) combination
    cross join lateral unnest(array[
      combination.source_classroom_id,
      combination.host_classroom_id
    ]) partner(id)
   where combination.daycare_id = public.get_my_daycare_id()
     and exists (
       select 1
         from public.staff_members member
         join public.profiles profile on profile.id = member.profile_id
        where profile.id = auth.uid()
          and profile.role = 'educator'
          and profile.archived_at is null
          and member.status = 'active'
          and member.archived_at is null
     );
$$;

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
  if new.status <> 'assigned' or new.ends_at <= now() then return new; end if;
  if tg_op = 'UPDATE'
     and old.status = new.status
     and old.classroom_id = new.classroom_id
     and old.starts_at = new.starts_at
     and old.ends_at = new.ends_at then
    return new;
  end if;

  select member.profile_id into v_recipient
    from public.staff_members member
   where member.id = new.staff_member_id;
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
    'Room coverage invitation',
    'Can you cover ' || coalesce(v_room_name, 'a classroom') ||
      '? Open the invitation to accept or decline.',
    v_payload
  );

  insert into public.notification_outbox (
    daycare_id, recipient_id, channel, kind, title, body, payload, dedupe_key
  ) values (
    new.daycare_id,
    v_recipient,
    'push',
    'coverage_assignment',
    'Room coverage invitation',
    'Can you cover ' || coalesce(v_room_name, 'a classroom') ||
      '? Open the invitation to accept or decline.',
    v_payload,
    'coverage-assignment:' || new.id::text
  ) on conflict do nothing;

  return new;
end;
$$;

create or replace function public.respond_to_room_coverage(
  p_assignment uuid,
  p_response text
)
returns void
language plpgsql
security definer
set search_path = public
set jit = off
as $$
declare
  v_assignment public.room_coverage_assignments%rowtype;
  v_member public.staff_members%rowtype;
  v_center public.daycares%rowtype;
  v_day date;
  v_conflict text;
  v_committed boolean;
  v_payload jsonb;
  v_educator_name text;
begin
  if p_response is null or p_response not in ('accepted', 'declined') then
    raise exception 'Choose accept or decline';
  end if;
  select member.* into v_member
    from public.staff_members member
   where member.profile_id = auth.uid()
     and member.daycare_id = public.get_my_daycare_id()
     and member.status = 'active'
     and member.archived_at is null;
  if v_member.id is null or not exists (
    select 1 from public.profiles profile
     where profile.id = auth.uid()
       and profile.role = 'educator'
       and profile.archived_at is null
  ) then
    raise exception 'Active educator account required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('coverage-plan:' || v_member.daycare_id::text, 0)
  );
  select assignment.* into v_assignment
    from public.room_coverage_assignments assignment
   where assignment.id = p_assignment
     and assignment.staff_member_id = v_member.id
     and assignment.daycare_id = v_member.daycare_id
   for update;
  if not found then raise exception 'Coverage invitation unavailable'; end if;
  if v_assignment.status = p_response then return; end if;
  if v_assignment.status <> 'assigned' or v_assignment.ends_at <= now() then
    raise exception 'This invitation is no longer awaiting a response. Refresh your coverage list';
  end if;

  select center.* into v_center
    from public.daycares center
   where center.id = v_member.daycare_id;
  v_day := (v_assignment.starts_at at time zone v_center.timezone)::date;
  if p_response = 'accepted' then
    if not public._forecast_staff_eligible(v_member.id, v_day) then
      raise exception 'Eligibility or approved leave changed. Ask your administrator to review this coverage';
    end if;
    if exists (
      select 1 from public.center_closures closure
       where closure.daycare_id = v_center.id
         and v_day between closure.starts_on and closure.ends_on
    ) or (v_assignment.starts_at at time zone v_center.timezone)::time < v_center.opens_at
      or (v_assignment.ends_at at time zone v_center.timezone)::time > v_center.closes_at then
      raise exception 'Center hours or closure changed. Ask your administrator to review this coverage';
    end if;
    v_conflict := public._coverage_conflict_without_forecast(
      v_member.id,
      v_assignment.classroom_id,
      v_assignment.starts_at,
      v_assignment.ends_at,
      v_assignment.id
    );
    v_committed := exists (
      select 1 from public.profiles profile
       where profile.id = auth.uid()
         and profile.classroom_id <> v_assignment.classroom_id
    ) or exists (
      select 1 from public.educator_classrooms educator_room
       where educator_room.educator_id = auth.uid()
         and educator_room.classroom_id <> v_assignment.classroom_id
    ) or exists (
      select 1 from public.staff_shifts shift
       where shift.staff_member_id = v_member.id
         and shift.status = 'published'
         and shift.classroom_id <> v_assignment.classroom_id
         and shift.starts_at < v_assignment.ends_at
         and shift.ends_at > v_assignment.starts_at
    );
    if v_conflict is not null
       and v_conflict not like 'Published shift in another room%' then
      raise exception '%', v_conflict;
    end if;
    if v_committed and not public._can_lend_existing_coverage(
      v_member.id,
      v_assignment.classroom_id,
      v_assignment.starts_at,
      v_assignment.ends_at,
      v_assignment.id
    ) then
      raise exception 'Source-room coverage changed. Ask your administrator to review this plan';
    end if;
  end if;

  update public.room_coverage_assignments
     set status = p_response
   where id = v_assignment.id;

  select coalesce(nullif(profile.full_name, ''), 'An educator')
    into v_educator_name
    from public.profiles profile
   where profile.id = auth.uid();
  v_payload := jsonb_build_object(
    'screen', 'RoomRatios',
    'roomId', v_assignment.classroom_id,
    'assignmentId', v_assignment.id,
    'href', '/rooms',
    'response', p_response,
    'source', 'Rooms & ratios',
    'action_label', 'Review coverage'
  );
  insert into public.notifications (
    daycare_id, profile_id, kind, title, body, payload
  )
  select
    v_center.id,
    reviewer.id,
    'coverage_response',
    'Coverage invitation ' || p_response,
    coalesce(v_educator_name, 'An educator') || ' ' || p_response ||
      ' coverage. Review the room plan for remaining gaps.',
    v_payload
  from public.profiles reviewer
  where reviewer.daycare_id = v_center.id
    and public.profile_has_permission(reviewer.id, 'rooms', 'edit');
end;
$$;

revoke all on function public.respond_to_room_coverage(uuid, text)
  from public, anon;
grant execute on function public.respond_to_room_coverage(uuid, text)
  to authenticated;

notify pgrst, 'reload schema';
