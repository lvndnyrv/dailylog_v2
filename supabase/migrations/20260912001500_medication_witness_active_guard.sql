-- A medication witness must be a different, currently active staff profile.
-- The previous validator checked role and center but still accepted archived
-- staff records, even though the UI calls this an active-staff safety check.

create or replace function public.validate_medication_log_safety()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  auth_row public.medication_authorizations%rowtype;
  v_timezone text;
  v_local_day date;
  v_existing_doses integer;
begin
  select * into auth_row
    from public.medication_authorizations
   where id = new.authorization_id
     and child_id = new.child_id;

  if auth_row.id is null then
    raise exception 'The selected medication is not authorized for this child';
  end if;
  if new.administered_at > now() + interval '5 minutes' then
    raise exception 'A medication dose cannot be recorded in the future';
  end if;

  select coalesce(daycare.timezone, 'UTC') into v_timezone
    from public.daycares daycare where daycare.id = auth_row.daycare_id;
  v_local_day := (new.administered_at at time zone coalesce(v_timezone, 'UTC'))::date;

  if not auth_row.active
     or auth_row.start_date > v_local_day
     or (auth_row.end_date is not null and auth_row.end_date < v_local_day) then
    raise exception 'This medication authorization is not currently active';
  end if;
  if new.witness_id is null then
    raise exception 'A second staff witness is required';
  end if;
  if new.witness_id = new.administered_by then
    raise exception 'The administering educator cannot witness their own dose';
  end if;
  if not exists (
    select 1
      from public.profiles witness
     where witness.id = new.witness_id
       and witness.daycare_id = auth_row.daycare_id
       and witness.role in ('owner_admin', 'admin', 'educator')
       and witness.archived_at is null
  ) then
    raise exception 'The witness must be an active staff member at this center';
  end if;
  if not (
    coalesce((new.safety_checks ->> 'right_child')::boolean, false)
    and coalesce((new.safety_checks ->> 'right_medication')::boolean, false)
    and coalesce((new.safety_checks ->> 'right_dose')::boolean, false)
    and coalesce((new.safety_checks ->> 'right_route')::boolean, false)
    and coalesce((new.safety_checks ->> 'right_time')::boolean, false)
  ) then
    raise exception 'All five medication safety rights must be confirmed';
  end if;

  if auth_row.schedule_type = 'as_needed' and auth_row.max_daily_doses is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(auth_row.id::text || ':' || v_local_day::text, 0)
    );
    select count(*) into v_existing_doses
      from public.medication_logs medication_log
     where medication_log.authorization_id = auth_row.id
       and medication_log.id is distinct from new.id
       and (medication_log.administered_at at time zone coalesce(v_timezone, 'UTC'))::date = v_local_day;
    if v_existing_doses >= auth_row.max_daily_doses then
      raise exception 'The maximum daily doses for this medication have already been given';
    end if;
  end if;

  return new;
end;
$$;

notify pgrst, 'reload schema';
