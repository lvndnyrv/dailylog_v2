-- Pickup safety notifications belong to the attendance approval workflow.
-- A reporting educator needs attendance edit permission, while the resolution
-- acknowledgement is emitted by an attendance approver. Keep the rest of the
-- central notification guard unchanged.

do $migration$
declare
  v_definition text;
  v_needle text := $needle$if new.kind in ('time_off', 'timesheet_review') then$needle$;
  v_replacement text := $replacement$if new.kind = 'pickup_security' then
    if not public.has_permission('attendance', 'edit') then
      raise exception 'attendance edit permission required';
    end if;
    return new;
  end if;

  if new.kind = 'pickup_security_resolved' then
    if not public.has_permission('attendance', 'approve') then
      raise exception 'attendance approve permission required';
    end if;
    return new;
  end if;

  if new.kind in ('time_off', 'timesheet_review') then$replacement$;
begin
  select pg_get_functiondef(
    'public.enforce_notification_enqueue_permission()'::regprocedure
  ) into v_definition;

  if position(v_needle in v_definition) = 0 then
    raise exception 'Notification permission guard has an unexpected definition.';
  end if;

  execute replace(v_definition, v_needle, v_replacement);
end
$migration$;

notify pgrst, 'reload schema';
