-- Parent Mobile Group 20 — durable incident receipt, signed acknowledgment,
-- confirmation evidence, staff feedback, and a standing family history.

alter table public.incident_reports
  add column if not exists parent_acknowledged_by uuid
    references public.profiles(id) on delete set null;

create table if not exists public.incident_acknowledgments (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references public.daycares(id) on delete cascade,
  incident_id uuid not null unique references public.incident_reports(id) on delete restrict,
  child_id uuid not null references public.children(id) on delete restrict,
  parent_id uuid not null references public.profiles(id) on delete restrict,
  signed_name text not null,
  statement_version text not null default 'parent-incident-v1',
  statement_text text not null,
  acknowledged_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (length(btrim(signed_name)) between 2 and 120)
);

create index if not exists incident_acknowledgments_parent_idx
  on public.incident_acknowledgments (parent_id, acknowledged_at desc);
create index if not exists incident_acknowledgments_daycare_idx
  on public.incident_acknowledgments (daycare_id, acknowledged_at desc);

alter table public.incident_acknowledgments enable row level security;

drop policy if exists "families read linked incident acknowledgments"
  on public.incident_acknowledgments;
create policy "families read linked incident acknowledgments"
  on public.incident_acknowledgments for select
  using (child_id in (select public.my_child_ids()));

drop policy if exists "staff read center incident acknowledgments"
  on public.incident_acknowledgments;
create policy "staff read center incident acknowledgments"
  on public.incident_acknowledgments for select
  using (
    public.is_staff()
    and daycare_id = public.get_my_daycare_id()
    and public.has_permission('incidents', 'view')
  );

create or replace function public.get_parent_incident_hub(p_child_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_child public.children%rowtype;
  v_daycare public.daycares%rowtype;
begin
  if auth.uid() is null or public.get_my_role() <> 'parent'
     or p_child_id not in (select public.my_child_ids()) then
    raise exception 'This child is not linked to your family';
  end if;

  select * into v_child
    from public.children child
   where child.id = p_child_id and child.archived_at is null;
  if v_child.id is null then raise exception 'This child is unavailable'; end if;
  select * into v_daycare from public.daycares where id = v_child.daycare_id;

  return jsonb_build_object(
    'daycare', jsonb_build_object('id', v_daycare.id, 'name', v_daycare.name),
    'child', jsonb_build_object(
      'id', v_child.id,
      'first_name', v_child.first_name,
      'last_name', v_child.last_name,
      'photo_url', v_child.photo_url,
      'classroom_id', v_child.classroom_id,
      'classroom_name', (
        select classroom.name from public.classrooms classroom
         where classroom.id = v_child.classroom_id
      )
    ),
    'reports', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', incident.id,
          'child_id', incident.child_id,
          'occurred_at', incident.occurred_at,
          'location', incident.location,
          'severity', incident.severity,
          'injury_type', incident.injury_type,
          'injury_side', incident.injury_side,
          'body_parts', coalesce(to_jsonb(incident.body_parts), '[]'::jsonb),
          'description', incident.description,
          'first_aid_given', incident.first_aid_given,
          'witnesses', coalesce(to_jsonb(incident.witnesses), '[]'::jsonb),
          'notes', incident.notes,
          'photo_paths', coalesce(to_jsonb(incident.photo_paths), '[]'::jsonb),
          'status', incident.status,
          'submitted_at', incident.submitted_at,
          'signed_off_at', incident.signed_off_at,
          'parent_notified_at', incident.parent_notified_at,
          'parent_acknowledged_at', incident.parent_acknowledged_at,
          'parent_acknowledge_name', incident.parent_acknowledge_name,
          'parent_acknowledged_by', incident.parent_acknowledged_by,
          'created_at', incident.created_at,
          'updated_at', incident.updated_at,
          'educator_name', reporter.full_name,
          'signed_off_by_name', director.full_name,
          'action_required', incident.status in ('submitted', 'signed_off')
            and incident.parent_acknowledged_at is null,
          'acknowledgment', case when acknowledgment.id is null then null else
            jsonb_build_object(
              'id', acknowledgment.id,
              'parent_id', acknowledgment.parent_id,
              'signed_name', acknowledgment.signed_name,
              'statement_version', acknowledgment.statement_version,
              'statement_text', acknowledgment.statement_text,
              'acknowledged_at', acknowledgment.acknowledged_at,
              'parent_name', acknowledging_parent.full_name
            ) end
        ) order by
          (incident.status in ('submitted', 'signed_off')
            and incident.parent_acknowledged_at is null) desc,
          incident.occurred_at desc
      )
        from public.incident_reports incident
        left join public.profiles reporter on reporter.id = incident.educator_id
        left join public.profiles director on director.id = incident.signed_off_by
        left join public.incident_acknowledgments acknowledgment
          on acknowledgment.incident_id = incident.id
        left join public.profiles acknowledging_parent
          on acknowledging_parent.id = acknowledgment.parent_id
       where incident.child_id = v_child.id
         and incident.parent_notified_at is not null
         and incident.status in ('submitted', 'signed_off', 'acknowledged')
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.acknowledge_parent_incident(
  p_incident_id uuid,
  p_signed_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_incident public.incident_reports%rowtype;
  v_ack public.incident_acknowledgments%rowtype;
  v_signed_name text := btrim(coalesce(p_signed_name, ''));
  v_statement constant text :=
    'I confirm that I was informed of this incident and reviewed the report provided by the childcare center.';
  v_child_name text;
  v_event_key text;
begin
  if auth.uid() is null or public.get_my_role() <> 'parent' then
    raise exception 'A parent account is required';
  end if;
  if length(v_signed_name) < 2 or length(v_signed_name) > 120 then
    raise exception 'Type your full name to acknowledge this report';
  end if;

  select * into v_profile from public.profiles profile where profile.id = auth.uid();
  if lower(regexp_replace(v_signed_name, '\s+', ' ', 'g'))
     <> lower(regexp_replace(btrim(v_profile.full_name), '\s+', ' ', 'g')) then
    raise exception 'Signature must match the full name on your DailyLog account';
  end if;

  perform public.assert_rate_limit('acknowledge_parent_incident', 12, 600, p_incident_id::text);

  select * into v_incident
    from public.incident_reports incident
   where incident.id = p_incident_id
     and incident.child_id in (select public.my_child_ids())
     and incident.parent_notified_at is not null
     and incident.status in ('submitted', 'signed_off', 'acknowledged')
   for update;
  if v_incident.id is null then
    raise exception 'Incident is not available for acknowledgment';
  end if;

  select * into v_ack
    from public.incident_acknowledgments acknowledgment
   where acknowledgment.incident_id = v_incident.id;
  if v_ack.id is not null then
    return jsonb_build_object(
      'incidentId', v_incident.id,
      'acknowledgmentId', v_ack.id,
      'signedName', v_ack.signed_name,
      'acknowledgedAt', v_ack.acknowledged_at,
      'daycareId', v_ack.daycare_id,
      'childId', v_ack.child_id,
      'alreadyAcknowledged', true
    );
  end if;
  if v_incident.status = 'acknowledged' then
    raise exception 'This legacy report was already acknowledged';
  end if;

  insert into public.incident_acknowledgments (
    daycare_id, incident_id, child_id, parent_id, signed_name,
    statement_version, statement_text
  ) values (
    v_incident.daycare_id, v_incident.id, v_incident.child_id, auth.uid(),
    v_signed_name, 'parent-incident-v1', v_statement
  ) returning * into v_ack;

  update public.incident_reports
     set parent_acknowledged_at = v_ack.acknowledged_at,
         parent_acknowledge_name = v_ack.signed_name,
         parent_acknowledged_by = auth.uid(),
         status = 'acknowledged'
   where id = v_incident.id;

  select concat_ws(' ', child.first_name, child.last_name)
    into v_child_name from public.children child where child.id = v_incident.child_id;
  v_event_key := 'incident:' || v_incident.id || ':parent-acknowledged';

  insert into public.notifications (daycare_id, profile_id, kind, title, body, payload)
  select distinct v_incident.daycare_id, recipient.id, 'incident',
         'Parent acknowledged incident',
         v_child_name || ' · signed by ' || v_ack.signed_name,
         jsonb_build_object(
           'type', 'incident_acknowledged',
           'screen', 'IncidentHub',
           'incidentId', v_incident.id,
           'childId', v_incident.child_id,
           'acknowledgmentId', v_ack.id,
           'eventKey', v_event_key
         )
    from public.profiles recipient
   where recipient.daycare_id = v_incident.daycare_id
     and recipient.archived_at is null
     and (
       recipient.role in ('owner_admin', 'admin')
       or recipient.id in (v_incident.educator_id, v_incident.signed_off_by)
     )
     and not exists (
       select 1 from public.notifications notification
        where notification.profile_id = recipient.id
          and notification.payload->>'eventKey' = v_event_key
     );

  insert into public.audit_log (
    daycare_id, actor_id, action, entity_type, entity_id, before, after
  ) values (
    v_incident.daycare_id, auth.uid(), 'parent_incident_acknowledged',
    'incident_report', v_incident.id, to_jsonb(v_incident),
    jsonb_build_object(
      'acknowledgment_id', v_ack.id,
      'parent_id', v_ack.parent_id,
      'signed_name', v_ack.signed_name,
      'acknowledged_at', v_ack.acknowledged_at,
      'statement_version', v_ack.statement_version
    )
  );

  return jsonb_build_object(
    'incidentId', v_incident.id,
    'acknowledgmentId', v_ack.id,
    'signedName', v_ack.signed_name,
    'acknowledgedAt', v_ack.acknowledged_at,
    'daycareId', v_ack.daycare_id,
    'childId', v_ack.child_id,
    'alreadyAcknowledged', false
  );
end;
$$;

revoke all on table public.incident_acknowledgments from anon, authenticated;
grant select on table public.incident_acknowledgments to authenticated;

revoke all on function public.get_parent_incident_hub(uuid) from public, anon;
revoke all on function public.acknowledge_parent_incident(uuid, text) from public, anon;
grant execute on function public.get_parent_incident_hub(uuid) to authenticated;
grant execute on function public.acknowledge_parent_incident(uuid, text) to authenticated;

-- Retire the earlier acknowledgment path so every new signature receives an
-- immutable receipt, actor identity, explicit audit entry and staff feedback.
revoke all on function public.acknowledge_incident(uuid, text)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
