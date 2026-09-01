-- Allow the signed parent RPC to record evidence on a serious submitted report
-- without granting parents any ability to edit the incident itself.
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
    -- Signed-off reports move to acknowledged. Serious submitted reports stay
    -- submitted so the director review cannot be skipped. In both cases only
    -- the receipt fields and lifecycle status may change.
    if new.parent_acknowledged_at is not null
       and old.parent_acknowledged_at is null
       and new.parent_acknowledged_by = auth.uid()
       and new.status in ('submitted', 'acknowledged')
       and (to_jsonb(new) - array[
         'parent_acknowledged_at',
         'parent_acknowledge_name',
         'parent_acknowledged_by',
         'status',
         'updated_at'
       ]) = (to_jsonb(old) - array[
         'parent_acknowledged_at',
         'parent_acknowledge_name',
         'parent_acknowledged_by',
         'status',
         'updated_at'
       ]) then
      return new;
    end if;
    raise exception 'Parents cannot edit incident reports';
  end if;

  if new.status = 'signed_off'
     and old.status is distinct from 'signed_off'
     and not public.has_permission('incidents', 'approve') then
    raise exception 'Incident approval permission required';
  end if;
  if not public.has_permission('incidents', 'edit') then
    raise exception 'Incident edit permission required';
  end if;
  return new;
end;
$$;
