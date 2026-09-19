-- Detect stale room-coverage commitments without silently cancelling them.
-- Each newly detected issue is surfaced once to the educator and permitted
-- administrators; clearing and later recurring creates a new alert version.

alter table public.room_coverage_assignments
  add column if not exists review_issue text,
  add column if not exists review_issue_detected_at timestamptz,
  add column if not exists review_alert_version integer not null default 0;

alter table public.room_coverage_assignments
  drop constraint if exists room_coverage_review_alert_version_check;
alter table public.room_coverage_assignments
  add constraint room_coverage_review_alert_version_check
  check (review_alert_version >= 0);

create or replace function public._room_coverage_review_reason(p_assignment uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
set jit = off
as $$
declare
  v_assignment record;
  v_day date;
  v_conflict text;
  v_committed boolean;
begin
  select assignment.*, profile.id as profile_id,
         profile.classroom_id as home_classroom_id,
         center.timezone, center.opens_at, center.closes_at
    into v_assignment
    from public.room_coverage_assignments assignment
    join public.staff_members member on member.id = assignment.staff_member_id
    join public.profiles profile on profile.id = member.profile_id
    join public.daycares center on center.id = assignment.daycare_id
   where assignment.id = p_assignment;

  if v_assignment.id is null
     or v_assignment.status not in ('assigned', 'accepted', 'declined')
     or v_assignment.ends_at <= now() then
    return null;
  end if;

  v_day := (v_assignment.starts_at at time zone v_assignment.timezone)::date;
  v_conflict := public._coverage_conflict_without_forecast(
    v_assignment.staff_member_id,
    v_assignment.classroom_id,
    v_assignment.starts_at,
    v_assignment.ends_at,
    v_assignment.id
  );
  v_committed := (
    v_assignment.home_classroom_id is not null
    and v_assignment.home_classroom_id <> v_assignment.classroom_id
  ) or exists (
    select 1 from public.educator_classrooms educator_room
     where educator_room.educator_id = v_assignment.profile_id
       and educator_room.classroom_id <> v_assignment.classroom_id
  ) or exists (
    select 1 from public.staff_shifts shift
     where shift.staff_member_id = v_assignment.staff_member_id
       and shift.status = 'published'
       and shift.classroom_id <> v_assignment.classroom_id
       and shift.starts_at < v_assignment.ends_at
       and shift.ends_at > v_assignment.starts_at
  );

  if v_assignment.status = 'declined' then
    return 'Educator declined — arrange replacement coverage';
  elsif exists (
    select 1 from public.center_closures closure
     where closure.daycare_id = v_assignment.daycare_id
       and v_day between closure.starts_on and closure.ends_on
  ) then
    return 'Center closure now overlaps this plan';
  elsif (v_assignment.starts_at at time zone v_assignment.timezone)::time < v_assignment.opens_at
     or (v_assignment.ends_at at time zone v_assignment.timezone)::time > v_assignment.closes_at then
    return 'Coverage is outside current opening hours';
  elsif not public._forecast_staff_eligible(v_assignment.staff_member_id, v_day) then
    return 'Educator eligibility or approved leave changed — review coverage';
  elsif v_conflict is null or v_conflict like 'Published shift in another room%' then
    if v_committed then
      if public._can_lend_existing_coverage(
        v_assignment.staff_member_id,
        v_assignment.classroom_id,
        v_assignment.starts_at,
        v_assignment.ends_at,
        v_assignment.id
      ) then
        v_conflict := null;
      else
        v_conflict := 'Source room can no longer safely lend this educator for the whole interval';
      end if;
    elsif not exists (
      select 1 from public.staff_shifts shift
       where shift.staff_member_id = v_assignment.staff_member_id
         and shift.status = 'published'
         and shift.starts_at <= v_assignment.starts_at
         and shift.ends_at >= v_assignment.ends_at
    ) then
      v_conflict := 'No published shift covers this interval — reconfirm availability';
    elsif exists (
      select 1 from public.staff_shifts shift
       where shift.staff_member_id = v_assignment.staff_member_id
         and shift.status = 'published'
         and shift.starts_at < v_assignment.ends_at
         and shift.ends_at > v_assignment.starts_at
         and shift.unpaid_break_minutes > 0
         and (
           shift.planned_break_starts_at is null
           or extract(epoch from (shift.planned_break_ends_at - shift.planned_break_starts_at)) / 60
              < shift.unpaid_break_minutes
         )
    ) then
      v_conflict := 'Untimed break — reconfirm availability for this interval';
    end if;
  end if;

  return v_conflict;
end;
$$;

revoke all on function public._room_coverage_review_reason(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.enqueue_room_coverage_review_alerts()
returns integer
language plpgsql
security definer
set search_path = public
set jit = off
as $$
declare
  v_assignment record;
  v_recipient record;
  v_reason text;
  v_version integer;
  v_payload jsonb;
  v_count integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required';
  end if;

  for v_assignment in
    select assignment.id, assignment.daycare_id, assignment.classroom_id,
           assignment.review_issue, member.profile_id, profile.full_name,
           room.name as room_name
      from public.room_coverage_assignments assignment
      join public.staff_members member on member.id = assignment.staff_member_id
      join public.profiles profile on profile.id = member.profile_id
      join public.classrooms room on room.id = assignment.classroom_id
     where assignment.status in ('assigned', 'accepted')
       and assignment.ends_at > now()
       and assignment.starts_at < now() + interval '91 days'
     order by assignment.starts_at, assignment.id
  loop
    v_reason := public._room_coverage_review_reason(v_assignment.id);

    if v_reason is null then
      if v_assignment.review_issue is not null then
        update public.room_coverage_assignments
           set review_issue = null,
               review_issue_detected_at = null
         where id = v_assignment.id;
      end if;
      continue;
    end if;

    if v_assignment.review_issue is not distinct from v_reason then
      continue;
    end if;

    update public.room_coverage_assignments
       set review_issue = v_reason,
           review_issue_detected_at = now(),
           review_alert_version = review_alert_version + 1
     where id = v_assignment.id
     returning review_alert_version into v_version;

    v_payload := jsonb_build_object(
      'type', 'coverage_review',
      'screen', 'RoomRatios',
      'roomId', v_assignment.classroom_id,
      'assignmentId', v_assignment.id,
      'reason', v_reason,
      'reviewVersion', v_version,
      'href', '/rooms',
      'source', 'Rooms & ratios',
      'action_label', 'Review coverage'
    );

    for v_recipient in
      select profile.id, profile.role
        from public.profiles profile
       where profile.id = v_assignment.profile_id
         and profile.archived_at is null
      union
      select profile.id, profile.role
        from public.profiles profile
       where profile.daycare_id = v_assignment.daycare_id
         and profile.archived_at is null
         and public.profile_has_permission(profile.id, 'rooms', 'edit')
    loop
      insert into public.notifications (
        daycare_id, profile_id, kind, title, body, payload
      ) values (
        v_assignment.daycare_id,
        v_recipient.id,
        'coverage_review',
        case when v_recipient.id = v_assignment.profile_id
          then 'Your room coverage needs review'
          else 'Coverage plan needs review'
        end,
        coalesce(v_assignment.room_name, 'A room') || ': ' || v_reason || '.',
        v_payload
      );

      insert into public.notification_outbox (
        daycare_id, recipient_id, channel, kind, title, body, payload, dedupe_key
      ) values (
        v_assignment.daycare_id,
        v_recipient.id,
        'push',
        'coverage_review',
        case when v_recipient.id = v_assignment.profile_id
          then 'Your room coverage needs review'
          else 'Coverage plan needs review'
        end,
        coalesce(v_assignment.room_name, 'A room') || ': ' || v_reason || '.',
        v_payload,
        'coverage-review:' || v_assignment.id || ':' || v_version || ':' || v_recipient.id
      ) on conflict do nothing;
    end loop;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.enqueue_room_coverage_review_alerts()
  from public, anon, authenticated;
grant execute on function public.enqueue_room_coverage_review_alerts()
  to service_role;

do $$
declare
  v_job bigint;
begin
  select jobid into v_job
  from cron.job
  where jobname = 'dailylog-coverage-review';
  if v_job is not null then perform cron.unschedule(v_job); end if;

  perform cron.schedule(
    'dailylog-coverage-review',
    '*/10 * * * *',
    $cron$
      select set_config('request.jwt.claims', '{"role":"service_role"}', true);
      select public.enqueue_room_coverage_review_alerts();
    $cron$
  );
end;
$$;

notify pgrst, 'reload schema';
