-- A saved transition is a commitment, not a guarantee that later changes leave
-- its destination available. Recheck it without moving or cancelling the child.
alter table public.room_transition_plans
  add column review_issue text,
  add column review_issue_detected_at timestamptz,
  add column review_alert_version integer not null default 0;

create or replace function public._room_transition_plan_review_reason(p_plan_id uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v_plan public.room_transition_plans;
  v_child public.children;
  v_room public.classrooms;
  v_center public.daycares;
  v_projected integer;
  v_today date;
begin
  select * into v_plan from public.room_transition_plans where id = p_plan_id;
  if not found or v_plan.status <> 'planned' then return null; end if;
  select * into v_child from public.children where id = v_plan.child_id;
  select * into v_room from public.classrooms where id = v_plan.to_classroom_id;
  select * into v_center from public.daycares where id = v_plan.daycare_id;
  v_today := (now() at time zone v_center.timezone)::date;

  if v_child.id is null or v_child.archived_at is not null then return 'Child is no longer active'; end if;
  if v_child.classroom_id is distinct from v_plan.from_classroom_id then return 'Starting room has changed'; end if;
  if v_room.id is null or v_room.archived_at is not null then return 'Destination room is unavailable'; end if;
  if v_plan.move_on < v_today then return 'Planned move day has passed'; end if;
  if v_room.opens_on > v_plan.move_on then return 'Destination room is not open on move day'; end if;
  if extract(isodow from v_plan.move_on) > 5 or exists (
    select 1 from public.center_closures cl where cl.daycare_id = v_plan.daycare_id
      and v_plan.move_on between cl.starts_on and cl.ends_on
  ) then return 'Center is closed on move day'; end if;
  if v_room.capacity is null or v_room.capacity < 1 then return 'Destination capacity needs review'; end if;
  if v_child.date_of_birth is null or v_room.min_age_months is null or v_room.max_age_months is null then
    return 'Destination age-band details need review';
  end if;
  if v_plan.move_on < (v_child.date_of_birth + make_interval(months => v_room.min_age_months))::date
    or v_plan.move_on >= (v_child.date_of_birth + make_interval(months => v_room.max_age_months))::date then
    return 'Child is outside the destination age band';
  end if;
  select projected_children into v_projected
    from public._room_transition_capacity(v_room.id, v_child.id, v_plan.move_on);
  if v_projected is null or v_projected >= v_room.capacity then return 'No projected space on move day'; end if;
  if v_plan.transition_week and exists (
    select 1 from public.center_closures cl where cl.daycare_id = v_plan.daycare_id
      and cl.starts_on <= v_plan.transition_ends_on and cl.ends_on >= v_plan.transition_starts_on
  ) then return 'Transition visits overlap a center closure'; end if;
  return null;
end;
$$;
revoke all on function public._room_transition_plan_review_reason(uuid) from public, anon, authenticated;
grant execute on function public._room_transition_plan_review_reason(uuid) to service_role;

create or replace function public.enqueue_room_transition_plan_review_alerts()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_plan record;
  v_reason text;
  v_version integer;
  v_recipient uuid;
  v_payload jsonb;
  v_count integer := 0;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;

  for v_plan in
    select p.id, p.daycare_id, p.child_id, p.to_classroom_id, p.review_issue,
           c.first_name, c.last_name, r.name as room_name
      from public.room_transition_plans p
      join public.children c on c.id = p.child_id
      join public.classrooms r on r.id = p.to_classroom_id
     where p.status = 'planned'
     order by p.id
  loop
    v_reason := public._room_transition_plan_review_reason(v_plan.id);
    if v_reason is not distinct from v_plan.review_issue then continue; end if;
    update public.room_transition_plans
       set review_issue = v_reason,
           review_issue_detected_at = case when v_reason is null then null else now() end,
           review_alert_version = review_alert_version + case when v_reason is null then 0 else 1 end
     where id = v_plan.id
     returning review_alert_version into v_version;
    if v_reason is null then continue; end if;

    v_payload := jsonb_build_object(
      'type', 'room_transition_review', 'screen', 'RoomRatios',
      'childId', v_plan.child_id, 'roomId', v_plan.to_classroom_id,
      'planId', v_plan.id, 'reason', v_reason, 'reviewVersion', v_version,
      'href', '/rooms#room-transitions', 'source', 'Rooms & ratios',
      'action_label', 'Review move'
    );
    for v_recipient in
      select profile.id from public.profiles profile
       where profile.daycare_id = v_plan.daycare_id
         and profile.archived_at is null
         and public.profile_has_permission(profile.id, 'children', 'edit')
    loop
      insert into public.notifications(daycare_id, profile_id, kind, title, body, payload)
        values(v_plan.daycare_id, v_recipient, 'room_transition_review',
          'Room move needs review', v_plan.first_name || ' ' || v_plan.last_name || ': ' || v_reason || '.', v_payload);
      insert into public.notification_outbox(daycare_id, recipient_id, channel, kind, title, body, payload, dedupe_key)
        values(v_plan.daycare_id, v_recipient, 'push', 'room_transition_review',
          'Room move needs review', v_plan.first_name || ' ' || v_plan.last_name || ': ' || v_reason || '.', v_payload,
          'room-transition-review:' || v_plan.id || ':' || v_version || ':' || v_recipient)
        on conflict do nothing;
    end loop;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.enqueue_room_transition_plan_review_alerts() from public, anon, authenticated;
grant execute on function public.enqueue_room_transition_plan_review_alerts() to service_role;

do $$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname = 'dailylog-room-transition-review';
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule('dailylog-room-transition-review', '*/15 * * * *', $cron$
    select set_config('request.jwt.claims', '{"role":"service_role"}', true);
    select public.enqueue_room_transition_plan_review_alerts();
  $cron$);
end;
$$;
