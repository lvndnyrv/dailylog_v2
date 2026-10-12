-- Keep submitted safety reports immutable and make director sign-off one
-- atomic, permission-checked operation shared by web and mobile clients.

create or replace function public.enforce_incident_status_permission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' or (auth.uid() is null and auth.role() is null) then
    return new;
  end if;

  if public.get_my_role() = 'parent'
     and new.child_id in (select public.my_child_ids()) then
    if new.parent_acknowledged_at is not null
       and old.parent_acknowledged_at is null
       and new.parent_acknowledged_by = auth.uid()
       and new.status in ('submitted', 'acknowledged')
       and (to_jsonb(new) - array[
         'parent_acknowledged_at', 'parent_acknowledge_name',
         'parent_acknowledged_by', 'status', 'updated_at'
       ]) = (to_jsonb(old) - array[
         'parent_acknowledged_at', 'parent_acknowledge_name',
         'parent_acknowledged_by', 'status', 'updated_at'
       ]) then
      return new;
    end if;
    raise exception 'Parents cannot edit incident reports';
  end if;

  if not public.has_permission('incidents', 'edit') then
    raise exception 'Incident edit permission required';
  end if;

  if old.status in ('signed_off', 'acknowledged') then
    raise exception 'Signed incident reports are immutable';
  end if;

  if old.status = 'submitted' then
    if new.status <> 'signed_off' then
      raise exception 'Submitted incident reports can only be signed off';
    end if;
    if not public.has_permission('incidents', 'approve') then
      raise exception 'Incident approval permission required';
    end if;
    if new.signed_off_by is distinct from auth.uid() or new.signed_off_at is null then
      raise exception 'Director identity and sign-off time are required';
    end if;
    if (to_jsonb(new) - array[
      'status', 'signed_off_by', 'signed_off_at', 'parent_notified_at', 'updated_at'
    ]) <> (to_jsonb(old) - array[
      'status', 'signed_off_by', 'signed_off_at', 'parent_notified_at', 'updated_at'
    ]) then
      raise exception 'Incident details cannot change during sign-off';
    end if;
    return new;
  end if;

  if old.status = 'draft' and new.status not in ('draft', 'submitted') then
    raise exception 'Draft incidents must be submitted before sign-off';
  end if;

  return new;
end;
$$;

create or replace function public.sign_off_incident_report(p_incident_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.profiles%rowtype;
  v_incident public.incident_reports%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if not public.has_permission('incidents', 'approve') then
    raise exception 'Incident approval permission required';
  end if;

  select * into v_actor
    from public.profiles profile
   where profile.id = auth.uid()
     and profile.archived_at is null;
  if v_actor.id is null then
    raise exception 'Active staff profile required';
  end if;

  select * into v_incident
    from public.incident_reports incident
   where incident.id = p_incident_id
     and incident.daycare_id = v_actor.daycare_id
   for update;
  if v_incident.id is null then
    raise exception 'Incident report not found';
  end if;
  if v_incident.status <> 'submitted' then
    raise exception 'This incident was already reviewed or is no longer available';
  end if;

  update public.incident_reports
     set status = 'signed_off',
         signed_off_by = auth.uid(),
         signed_off_at = now(),
         parent_notified_at = coalesce(parent_notified_at, now())
   where id = v_incident.id
   returning * into v_incident;

  return jsonb_build_object(
    'incidentId', v_incident.id,
    'status', v_incident.status,
    'signedOffBy', v_incident.signed_off_by,
    'signedOffAt', v_incident.signed_off_at,
    'parentNotifiedAt', v_incident.parent_notified_at
  );
end;
$$;

revoke all on function public.sign_off_incident_report(uuid) from public, anon;
grant execute on function public.sign_off_incident_report(uuid) to authenticated;

notify pgrst, 'reload schema';
