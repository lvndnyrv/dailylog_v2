-- Complete the educator -> admin pickup-security handoff. Review alerts and
-- resolution access follow effective attendance approval permissions, and the
-- reporting educator receives an in-app acknowledgement when the alert closes.

drop policy if exists "admins resolve pickup security events"
  on public.pickup_security_events;
create policy "attendance approvers resolve pickup security events"
  on public.pickup_security_events for update
  using (
    daycare_id = public.get_my_daycare_id()
    and public.has_permission('attendance', 'approve')
  )
  with check (
    daycare_id = public.get_my_daycare_id()
    and public.has_permission('attendance', 'approve')
  );

create or replace function public.enforce_pickup_security_resolution()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' or (auth.uid() is null and auth.role() is null) then
    return new;
  end if;

  if new.daycare_id is distinct from old.daycare_id
     or new.child_id is distinct from old.child_id
     or new.attempted_name is distinct from old.attempted_name
     or new.notes is distinct from old.notes
     or new.reported_by is distinct from old.reported_by
     or new.created_at is distinct from old.created_at then
    raise exception 'Pickup security report details cannot be changed';
  end if;
  if old.status <> 'open' or new.status <> 'resolved' then
    raise exception 'Only an open pickup security alert can be resolved';
  end if;
  if not public.has_permission('attendance', 'approve')
     or old.daycare_id <> public.get_my_daycare_id() then
    raise exception 'Attendance approval permission is required';
  end if;

  new.resolved_by := auth.uid();
  new.resolved_at := coalesce(new.resolved_at, now());
  return new;
end;
$$;

drop trigger if exists enforce_pickup_security_resolution
  on public.pickup_security_events;
create trigger enforce_pickup_security_resolution
  before update on public.pickup_security_events
  for each row execute function public.enforce_pickup_security_resolution();

create or replace function public.notify_pickup_security_resolution()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_child_name text;
begin
  if old.status <> 'open' or new.status <> 'resolved' or new.reported_by is null then
    return new;
  end if;

  select child.first_name || ' ' || child.last_name
    into v_child_name
    from public.children child
   where child.id = new.child_id;

  insert into public.notifications (
    daycare_id, profile_id, kind, title, body, payload
  ) values (
    new.daycare_id,
    new.reported_by,
    'pickup_security_resolved',
    'Pickup alert resolved',
    'The pickup safety alert for ' || coalesce(v_child_name, 'this child') ||
      ' was reviewed and closed.',
    jsonb_build_object(
      'type', 'pickup_security_resolved',
      'screen', 'Pickups',
      'childId', new.child_id,
      'eventId', new.id,
      'resolvedBy', new.resolved_by
    )
  );

  return new;
end;
$$;

drop trigger if exists notify_pickup_security_resolution
  on public.pickup_security_events;
create trigger notify_pickup_security_resolution
  after update on public.pickup_security_events
  for each row execute function public.notify_pickup_security_resolution();

create or replace function public.report_unauthorized_pickup(
  p_child_id uuid,
  p_attempted_name text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_daycare_id uuid;
  v_child_name text;
  v_event_id uuid;
  v_payload jsonb;
begin
  if auth.uid() is null or not public.is_staff()
     or not public.has_permission('attendance', 'edit')
     or not public.can_write_child(p_child_id) then
    raise exception 'Attendance edit permission is required';
  end if;
  if length(coalesce(btrim(p_attempted_name), '')) > 120
     or length(coalesce(btrim(p_notes), '')) > 1000 then
    raise exception 'Pickup report is too long';
  end if;

  select child.daycare_id, child.first_name || ' ' || child.last_name
    into v_daycare_id, v_child_name
    from public.children child
   where child.id = p_child_id and child.archived_at is null;
  if v_daycare_id is null or v_daycare_id <> public.get_my_daycare_id() then
    raise exception 'Child not found';
  end if;
  perform public.assert_rate_limit('pickup_security_event', 10, 600, p_child_id::text);

  insert into public.pickup_security_events (
    daycare_id, child_id, attempted_name, notes, reported_by
  ) values (
    v_daycare_id, p_child_id, nullif(btrim(p_attempted_name), ''),
    nullif(btrim(p_notes), ''), auth.uid()
  ) returning id into v_event_id;

  v_payload := jsonb_build_object(
    'type', 'pickup_security',
    'screen', 'Pickups',
    'childId', p_child_id,
    'eventId', v_event_id,
    'href', '/children/' || p_child_id || '#pickup-safety',
    'source', 'Pickup safety',
    'action_label', 'Review alert'
  );

  insert into public.notification_outbox (
    daycare_id, recipient_id, channel, kind, title, body, payload, dedupe_key
  )
  select v_daycare_id, reviewer.id, 'push', 'pickup_security',
         'Pickup authorization alert',
         'An unverified person attempted to pick up ' || v_child_name || '.',
         v_payload,
         'pickup-security:' || v_event_id
    from public.profiles reviewer
   where reviewer.daycare_id = v_daycare_id
     and public.profile_has_permission(reviewer.id, 'attendance', 'approve')
  on conflict do nothing;

  insert into public.notifications (daycare_id, profile_id, kind, title, body, payload)
  select v_daycare_id, reviewer.id, 'pickup_security',
         'Pickup authorization alert',
         'An unverified person attempted to pick up ' || v_child_name || '.',
         v_payload
    from public.profiles reviewer
   where reviewer.daycare_id = v_daycare_id
     and public.profile_has_permission(reviewer.id, 'attendance', 'approve');

  return v_event_id;
end;
$$;

revoke all on function public.enforce_pickup_security_resolution()
  from public, anon, authenticated;
revoke all on function public.notify_pickup_security_resolution()
  from public, anon, authenticated;

comment on function public.enforce_pickup_security_resolution() is
  'Makes pickup-security reports immutable and restricts closure to effective attendance approvers.';
comment on function public.notify_pickup_security_resolution() is
  'Acknowledges pickup-security resolution to the educator who filed the report.';

notify pgrst, 'reload schema';
