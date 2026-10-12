-- ============================================================================
-- Mobile Group 16 follow-up — enforce incident visibility beyond the UI
-- ============================================================================

-- Parents only receive serious submitted reports or director-signed routine
-- reports. Staff retain the existing area-based access rules.
drop policy if exists "read incidents by area access" on incident_reports;
create policy "read incidents by area access" on incident_reports
  for select using (
    can_access_child_area(child_id, 'incidents', 'view')
    and (
      get_my_role() <> 'parent'
      or (
        parent_notified_at is not null
        and status in ('submitted', 'signed_off', 'acknowledged')
      )
    )
  );

-- Prevent any non-draft report from entering the workflow without a real
-- staff witness. Existing legacy signed reports with no witness remain readable
-- and acknowledgeable, but cannot be manufactured through a new transition.
create or replace function enforce_incident_witness_transition()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.status <> 'draft' and new.witness_id is null then
    if tg_op = 'INSERT'
       or old.status = 'draft'
       or old.witness_id is distinct from new.witness_id then
      raise exception 'A staff witness is required before submitting an incident';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_incident_witness_transition on incident_reports;
create trigger enforce_incident_witness_transition
  before insert or update on incident_reports
  for each row execute function enforce_incident_witness_transition();

-- A parent acknowledgment is valid only after the workflow has explicitly
-- made the report visible to the family. This closes the direct-RPC bypass for
-- drafts and routine reports still waiting for director sign-off.
create or replace function acknowledge_incident(p_incident_id uuid, p_name text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if nullif(btrim(p_name), '') is null then
    raise exception 'Full name is required to acknowledge an incident';
  end if;

  update incident_reports
     set parent_acknowledged_at = now(),
         parent_acknowledge_name = btrim(p_name),
         status = 'acknowledged'
   where id = p_incident_id
     and child_id in (select my_child_ids())
     and parent_notified_at is not null
     and status in ('submitted', 'signed_off');

  if not found then
    raise exception 'Incident is not available for acknowledgment';
  end if;
end;
$$;

grant execute on function acknowledge_incident(uuid, text) to authenticated;
