-- Parent Mobile Group 20 completion — keep urgent reports in the director
-- queue when a parent acknowledges before sign-off, and keep staff-only notes
-- out of the family incident payload.

alter function public.get_parent_incident_hub(uuid)
  rename to get_parent_incident_hub_group20_base;

revoke all on function public.get_parent_incident_hub_group20_base(uuid)
  from public, anon, authenticated;

create function public.get_parent_incident_hub(p_child_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_hub jsonb;
  v_reports jsonb;
begin
  v_hub := public.get_parent_incident_hub_group20_base(p_child_id);

  select coalesce(
    jsonb_agg(
      (report - 'notes')
      || jsonb_build_object(
        'director_review_required', report->>'status' = 'submitted'
      )
    ),
    '[]'::jsonb
  )
    into v_reports
    from jsonb_array_elements(coalesce(v_hub->'reports', '[]'::jsonb)) report;

  return jsonb_set(v_hub, '{reports}', v_reports, true);
end;
$$;

-- The normal lifecycle is submitted -> signed_off -> acknowledged. Serious
-- incidents are shared immediately, so acknowledgment may arrive while the
-- report is still submitted. In that case the signature is stored without
-- advancing the report past the director's queue.
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
  v_director_review_pending boolean;
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

  v_director_review_pending := v_incident.status = 'submitted';

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
      'directorReviewPending', v_director_review_pending,
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
         status = case
           when v_incident.status = 'signed_off' then 'acknowledged'
           else v_incident.status
         end
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
      'statement_version', v_ack.statement_version,
      'director_review_pending', v_director_review_pending
    )
  );

  return jsonb_build_object(
    'incidentId', v_incident.id,
    'acknowledgmentId', v_ack.id,
    'signedName', v_ack.signed_name,
    'acknowledgedAt', v_ack.acknowledged_at,
    'daycareId', v_ack.daycare_id,
    'childId', v_ack.child_id,
    'directorReviewPending', v_director_review_pending,
    'alreadyAcknowledged', false
  );
end;
$$;

-- When the director signs an already acknowledged urgent report, preserve the
-- final acknowledged state while still allowing the sign-off update and audit.
create or replace function public.finalize_preacknowledged_incident_signoff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'submitted'
     and new.status = 'signed_off'
     and old.parent_acknowledged_at is not null then
    new.status := 'acknowledged';
  end if;
  return new;
end;
$$;

drop trigger if exists zz_finalize_preacknowledged_incident_signoff
  on public.incident_reports;
create trigger zz_finalize_preacknowledged_incident_signoff
  before update of status on public.incident_reports
  for each row execute function public.finalize_preacknowledged_incident_signoff();

revoke all on function public.get_parent_incident_hub(uuid) from public, anon;
revoke all on function public.acknowledge_parent_incident(uuid, text) from public, anon;
grant execute on function public.get_parent_incident_hub(uuid) to authenticated;
grant execute on function public.acknowledge_parent_incident(uuid, text) to authenticated;

notify pgrst, 'reload schema';
