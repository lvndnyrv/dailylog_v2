-- Reconcile future coverage commitments in the background. Changes are never
-- auto-cancelled: administrators receive a deduplicated review alert instead.
create table public.room_coverage_review_alerts (
  assignment_id uuid primary key references public.room_coverage_assignments(id) on delete cascade,
  daycare_id uuid not null references public.daycares(id) on delete cascade,
  reason text not null,
  occurrence integer not null default 1 check (occurrence > 0),
  first_detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table public.room_coverage_review_alerts enable row level security;
revoke all on table public.room_coverage_review_alerts from public, anon, authenticated;

create function public._coverage_assignment_review_reason(p_assignment uuid)
returns text
language plpgsql stable security definer
set search_path = public
set jit = off
as $$
declare
  a record;
  c public.daycares;
  day date;
  conflict text;
  committed boolean;
begin
  select x.*, p.id profile_id, p.classroom_id home
    into a
    from public.room_coverage_assignments x
    join public.staff_members m on m.id = x.staff_member_id
    join public.profiles p on p.id = m.profile_id
   where x.id = p_assignment;
  if not found or a.status not in ('assigned','accepted') or a.ends_at <= now() then return null; end if;

  select * into c from public.daycares where id = a.daycare_id;
  day := (a.starts_at at time zone c.timezone)::date;
  conflict := public._coverage_conflict_without_forecast(a.staff_member_id, a.classroom_id, a.starts_at, a.ends_at, a.id);
  committed := (a.home is not null and a.home <> a.classroom_id)
    or exists(select 1 from public.educator_classrooms e where e.educator_id = a.profile_id and e.classroom_id <> a.classroom_id)
    or exists(select 1 from public.staff_shifts s where s.staff_member_id = a.staff_member_id and s.status = 'published'
      and s.classroom_id <> a.classroom_id and s.starts_at < a.ends_at and s.ends_at > a.starts_at);

  if exists(select 1 from public.center_closures cl where cl.daycare_id = c.id and day between cl.starts_on and cl.ends_on) then
    return 'Center closure now overlaps this plan';
  elsif (a.starts_at at time zone c.timezone)::time < c.opens_at or (a.ends_at at time zone c.timezone)::time > c.closes_at then
    return 'Coverage is outside current opening hours';
  elsif not public._forecast_staff_eligible(a.staff_member_id, day) then
    return 'Educator eligibility or approved leave changed — review coverage';
  elsif conflict is null or conflict like 'Published shift in another room%' then
    if committed then
      if not public._can_lend_existing_coverage(a.staff_member_id, a.classroom_id, a.starts_at, a.ends_at, a.id) then
        return 'Source room can no longer safely lend this educator for the whole interval';
      end if;
      conflict := null;
    elsif not exists(select 1 from public.staff_shifts s where s.staff_member_id = a.staff_member_id and s.status = 'published'
      and s.starts_at <= a.starts_at and s.ends_at >= a.ends_at) then
      return 'No published shift covers this interval — reconfirm availability';
    elsif exists(select 1 from public.staff_shifts s where s.staff_member_id = a.staff_member_id and s.status = 'published'
      and s.starts_at < a.ends_at and s.ends_at > a.starts_at and s.unpaid_break_minutes > 0
      and (s.planned_break_starts_at is null or extract(epoch from (s.planned_break_ends_at - s.planned_break_starts_at)) / 60 < s.unpaid_break_minutes)) then
      return 'Untimed break — reconfirm availability for this interval';
    end if;
  end if;
  return conflict;
end;
$$;

revoke all on function public._coverage_assignment_review_reason(uuid) from public, anon, authenticated, service_role;

create function public.process_room_coverage_review_alerts()
returns integer
language plpgsql security definer
set search_path = public
set jit = off
as $$
declare
  a record;
  existing public.room_coverage_review_alerts;
  reason_value text;
  alert_count integer := 0;
  next_occurrence integer;
  recipient uuid;
  payload_value jsonb;
  local_day date;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;

  for a in
    select assignment.*, center.timezone, room.name room_name
      from public.room_coverage_assignments assignment
      join public.daycares center on center.id = assignment.daycare_id
      join public.classrooms room on room.id = assignment.classroom_id
     where assignment.status in ('assigned','accepted')
       and assignment.ends_at > now()
       and assignment.starts_at < now() + interval '91 days'
     order by assignment.id
  loop
    reason_value := public._coverage_assignment_review_reason(a.id);
    select * into existing from public.room_coverage_review_alerts where assignment_id = a.id for update;
    if reason_value is null then
      if found and existing.resolved_at is null then
        update public.room_coverage_review_alerts set resolved_at = now(), last_detected_at = now() where assignment_id = a.id;
      end if;
      continue;
    end if;

    if found and existing.resolved_at is null and existing.reason = reason_value then
      update public.room_coverage_review_alerts set last_detected_at = now() where assignment_id = a.id;
      continue;
    end if;

    next_occurrence := case when found then existing.occurrence + 1 else 1 end;
    insert into public.room_coverage_review_alerts(assignment_id, daycare_id, reason, occurrence, resolved_at)
      values(a.id, a.daycare_id, reason_value, next_occurrence, null)
    on conflict (assignment_id) do update set reason = excluded.reason, occurrence = excluded.occurrence,
      first_detected_at = now(), last_detected_at = now(), resolved_at = null;

    local_day := (a.starts_at at time zone a.timezone)::date;
    payload_value := jsonb_build_object('href','/rooms?coverageDate='||local_day||'&assignment='||a.id,
      'screen','RoomRatios','assignmentId',a.id,'roomId',a.classroom_id,'date',local_day,'reason',reason_value);
    for recipient in select id from public.profiles where daycare_id = a.daycare_id
      and role in ('owner_admin','admin') and archived_at is null
    loop
      insert into public.notifications(daycare_id, profile_id, kind, title, body, payload)
        values(a.daycare_id, recipient, 'coverage_review', 'Coverage plan needs review',
          a.room_name||': '||reason_value, payload_value);
      insert into public.notification_outbox(daycare_id, recipient_id, channel, kind, title, body, payload, dedupe_key)
        values(a.daycare_id, recipient, 'push', 'coverage_review', 'Coverage plan needs review',
          a.room_name||': '||reason_value, payload_value,
          'coverage-review:'||a.id||':'||next_occurrence||':'||recipient)
        on conflict do nothing;
    end loop;
    alert_count := alert_count + 1;
  end loop;
  return alert_count;
end;
$$;

revoke all on function public.process_room_coverage_review_alerts() from public, anon, authenticated;
grant execute on function public.process_room_coverage_review_alerts() to service_role;

do $$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname = 'dailylog-coverage-review-alerts';
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule(
    'dailylog-coverage-review-alerts',
    '*/15 * * * *',
    $cron$
      select set_config('request.jwt.claims', '{"role":"service_role"}', true);
      select public.process_room_coverage_review_alerts();
    $cron$
  );
end;
$$;
