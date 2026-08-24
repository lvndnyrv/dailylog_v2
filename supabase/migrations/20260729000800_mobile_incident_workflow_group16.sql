-- ============================================================================
-- Mobile Group 16 — incident capture, sign-off routing, and parent visibility
-- ============================================================================

alter table incident_reports
  add column if not exists injury_side text,
  add column if not exists first_aid_by uuid references profiles(id) on delete set null,
  add column if not exists witness_id uuid references profiles(id) on delete set null,
  add column if not exists submitted_at timestamptz;

alter table incident_reports
  drop constraint if exists incident_reports_injury_side_check;

alter table incident_reports
  add constraint incident_reports_injury_side_check
  check (injury_side is null or injury_side in ('front', 'back'));

create index if not exists incident_reports_classroom_occurred_idx
  on incident_reports (classroom_id, occurred_at desc);

create index if not exists incident_reports_educator_drafts_idx
  on incident_reports (educator_id, updated_at desc)
  where status = 'draft';

create or replace function prepare_incident_workflow()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_child_daycare uuid;
  v_child_classroom uuid;
begin
  select daycare_id, classroom_id
    into v_child_daycare, v_child_classroom
    from children
   where id = new.child_id;

  if v_child_daycare is null then
    raise exception 'Incident child was not found';
  end if;

  -- The client can create a report while offline. Reconstruct tenancy from the
  -- child rather than trusting a stale or missing client value during replay.
  new.daycare_id := v_child_daycare;
  new.classroom_id := coalesce(new.classroom_id, v_child_classroom);

  if new.witness_id is not null then
    if new.witness_id = new.educator_id then
      raise exception 'The reporting educator cannot be their own witness';
    end if;
    if not exists (
      select 1
        from profiles p
       where p.id = new.witness_id
         and p.daycare_id = v_child_daycare
         and p.role in ('owner_admin', 'admin', 'educator')
         and p.archived_at is null
    ) then
      raise exception 'Witness must be active staff at this center';
    end if;
  end if;

  if new.first_aid_by is not null and not exists (
    select 1
      from profiles p
     where p.id = new.first_aid_by
       and p.daycare_id = v_child_daycare
       and p.role in ('owner_admin', 'admin', 'educator')
       and p.archived_at is null
  ) then
    raise exception 'First aid provider must be active staff at this center';
  end if;

  -- Required for every new report that leaves draft. Legacy signed reports are
  -- intentionally not invalidated.
  if new.status = 'submitted'
     and (tg_op = 'INSERT' or old.status is distinct from 'submitted') then
    if new.witness_id is null then
      raise exception 'A staff witness is required before submitting an incident';
    end if;
    new.submitted_at := coalesce(new.submitted_at, now());

    -- Serious reports are visible to families immediately. Routine reports
    -- remain private until a director signs them off.
    if new.severity = 'serious' then
      new.parent_notified_at := coalesce(new.parent_notified_at, now());
    else
      new.parent_notified_at := null;
    end if;
  end if;

  if new.status = 'signed_off'
     and (tg_op = 'INSERT' or old.status is distinct from 'signed_off') then
    new.parent_notified_at := coalesce(new.parent_notified_at, now());
  end if;

  return new;
end;
$$;

drop trigger if exists prepare_incident_workflow on incident_reports;
create trigger prepare_incident_workflow
  before insert or update on incident_reports
  for each row execute function prepare_incident_workflow();

create or replace function route_incident_workflow_notifications()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_child_name text;
  v_parent_title text;
  v_parent_body text;
begin
  -- Data migrations and service maintenance do not manufacture user alerts.
  if auth.uid() is null then
    return new;
  end if;

  select concat_ws(' ', first_name, last_name)
    into v_child_name
    from children
   where id = new.child_id;

  if new.status = 'submitted' and old.status is distinct from 'submitted' then
    -- Notify center directors that a signature is waiting. The inbox row is
    -- only created when its durable outbox row wins the dedupe constraint.
    with queued as (
      insert into notification_outbox (
        daycare_id, recipient_id, channel, kind, title, body, payload, dedupe_key
      )
      select
        new.daycare_id,
        p.id,
        'push',
        'incident',
        'Incident awaiting sign-off',
        v_child_name || ' · ' || new.injury_type,
        jsonb_build_object(
          'screen', 'IncidentHub',
          'incidentId', new.id,
          'childId', new.child_id,
          'severity', new.severity
        ),
        'incident:' || new.id || ':director'
      from profiles p
      where p.daycare_id = new.daycare_id
        and p.role in ('owner_admin', 'admin')
        and p.archived_at is null
      on conflict do nothing
      returning recipient_id
    )
    insert into notifications (daycare_id, profile_id, kind, title, body, payload)
    select
      new.daycare_id,
      recipient_id,
      'incident',
      'Incident awaiting sign-off',
      v_child_name || ' · ' || new.injury_type,
      jsonb_build_object(
        'screen', 'IncidentHub',
        'incidentId', new.id,
        'childId', new.child_id,
        'severity', new.severity
      )
    from queued;

    if new.severity = 'serious' then
      v_parent_title := 'Urgent incident update for ' || v_child_name;
      v_parent_body := new.injury_type || ' · ' || new.location
        || '. The director is reviewing the report now.';

      perform enqueue_child_notification(
        new.child_id,
        'incident',
        v_parent_title,
        v_parent_body,
        jsonb_build_object(
          'screen', 'IncidentDetail',
          'incidentId', new.id,
          'childId', new.child_id,
          'severity', new.severity
        ),
        'incident:' || new.id || ':parent',
        array['push']::text[]
      );
    end if;
  end if;

  if new.status = 'signed_off'
     and old.status is distinct from 'signed_off'
     and new.severity <> 'serious' then
    v_parent_title := 'Incident report ready for ' || v_child_name;
    v_parent_body := new.injury_type || ' · ' || new.location
      || '. Please review and acknowledge the signed report.';

    perform enqueue_child_notification(
      new.child_id,
      'incident',
      v_parent_title,
      v_parent_body,
      jsonb_build_object(
        'screen', 'IncidentDetail',
        'incidentId', new.id,
        'childId', new.child_id,
        'severity', new.severity
      ),
      'incident:' || new.id || ':parent',
      array['push']::text[]
    );
  end if;

  return new;
end;
$$;

drop trigger if exists route_incident_workflow_notifications on incident_reports;
create trigger route_incident_workflow_notifications
  after update of status on incident_reports
  for each row execute function route_incident_workflow_notifications();
