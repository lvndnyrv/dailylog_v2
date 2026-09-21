-- Complete the educator -> administrator coverage response handoff.
-- Responses now deep-link to the affected planning date and are queued for
-- push delivery, so a future decline cannot disappear behind today's forecast.

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
  v_room_name text;
  v_title text;
  v_body text;
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
  select room.name into v_room_name
    from public.classrooms room
   where room.id = v_assignment.classroom_id;

  v_title := 'Coverage invitation ' || p_response;
  v_body := coalesce(v_educator_name, 'An educator') || ' ' || p_response ||
    ' coverage for ' || coalesce(v_room_name, 'a room') ||
    '. Review the plan for remaining gaps.';
  v_payload := jsonb_build_object(
    'screen', 'RoomRatios',
    'roomId', v_assignment.classroom_id,
    'assignmentId', v_assignment.id,
    'date', v_day,
    'href', '/rooms?coverageDate=' || v_day::text ||
      '&coverageAssignment=' || v_assignment.id::text,
    'response', p_response,
    'source', 'Rooms & ratios',
    'action_label', case when p_response = 'declined'
      then 'Arrange replacement'
      else 'Review coverage'
    end
  );

  insert into public.notifications (
    daycare_id, profile_id, kind, title, body, payload
  )
  select
    v_center.id,
    reviewer.id,
    'coverage_response',
    v_title,
    v_body,
    v_payload
  from public.profiles reviewer
  where reviewer.daycare_id = v_center.id
    and reviewer.archived_at is null
    and public.profile_has_permission(reviewer.id, 'rooms', 'edit');

  insert into public.notification_outbox (
    daycare_id, recipient_id, channel, kind, title, body, payload, dedupe_key
  )
  select
    v_center.id,
    reviewer.id,
    'push',
    'coverage_response',
    v_title,
    v_body,
    v_payload,
    'coverage-response:' || v_assignment.id::text || ':' || p_response || ':' || reviewer.id::text
  from public.profiles reviewer
  where reviewer.daycare_id = v_center.id
    and reviewer.archived_at is null
    and public.profile_has_permission(reviewer.id, 'rooms', 'edit')
  on conflict do nothing;
end;
$$;

revoke all on function public.respond_to_room_coverage(uuid, text)
  from public, anon;
grant execute on function public.respond_to_room_coverage(uuid, text)
  to authenticated;

notify pgrst, 'reload schema';
