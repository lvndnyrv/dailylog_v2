-- Parent Mobile Group 23 operational completion.
-- Enforces PRN daily limits under concurrency, expires authorizations in the
-- center's timezone, and reminds families before a renewal is required.

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
  select *
    into auth_row
    from public.medication_authorizations
   where id = new.authorization_id
     and child_id = new.child_id;

  if auth_row.id is null then
    raise exception 'The selected medication is not authorized for this child';
  end if;

  if new.administered_at > now() + interval '5 minutes' then
    raise exception 'A medication dose cannot be recorded in the future';
  end if;

  select coalesce(daycare.timezone, 'UTC')
    into v_timezone
    from public.daycares daycare
   where daycare.id = auth_row.daycare_id;
  v_local_day := (new.administered_at at time zone coalesce(v_timezone, 'UTC'))::date;

  if not auth_row.active
     or auth_row.start_date > v_local_day
     or (
       auth_row.end_date is not null
       and auth_row.end_date < v_local_day
     ) then
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
    -- Serialize dose-count checks for the same authorization and local day.
    perform pg_advisory_xact_lock(
      hashtextextended(auth_row.id::text || ':' || v_local_day::text, 0)
    );

    select count(*)
      into v_existing_doses
      from public.medication_logs medication_log
     where medication_log.authorization_id = auth_row.id
       and medication_log.id is distinct from new.id
       and (
         medication_log.administered_at at time zone coalesce(v_timezone, 'UTC')
       )::date = v_local_day;

    if v_existing_doses >= auth_row.max_daily_doses then
      raise exception 'The maximum daily doses for this medication have already been given';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.process_medication_authorization_statuses()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  auth_record record;
  v_local_today date;
  v_expired_count integer := 0;
  v_reminder_count integer := 0;
  v_has_renewal boolean;
begin
  for auth_record in
    select auth_row.id, auth_row.child_id, auth_row.name,
           auth_row.end_date, daycare.timezone,
           concat_ws(' ', child.first_name, child.last_name) as child_name
      from public.medication_authorizations auth_row
      join public.daycares daycare on daycare.id = auth_row.daycare_id
      join public.children child on child.id = auth_row.child_id
     where auth_row.active
       and auth_row.end_date is not null
  loop
    v_local_today := (now() at time zone coalesce(auth_record.timezone, 'UTC'))::date;
    select exists (
      select 1
        from public.medication_authorizations renewal
       where renewal.renewed_from_id = auth_record.id
         and renewal.active
    ) into v_has_renewal;

    if auth_record.end_date < v_local_today then
      update public.medication_authorizations
         set active = false,
             ended_at = coalesce(ended_at, now()),
             ended_by = null
       where id = auth_record.id
         and active;

      if found then
        v_expired_count := v_expired_count + 1;
        if not v_has_renewal then
          perform public.enqueue_child_notification(
            auth_record.child_id,
            'medication',
            auth_record.name || ' authorization expired',
            'The authorization for ' || auth_record.child_name ||
              ' has ended. Renew it before another dose is needed at care.',
            jsonb_build_object(
              'screen', 'Medication',
              'type', 'medication',
              'childId', auth_record.child_id,
              'authorizationId', auth_record.id,
              'status', 'expired'
            ),
            'medication-authorization-expired:' || auth_record.id,
            array['push']::text[]
          );
        end if;
      end if;
    elsif auth_record.end_date = v_local_today + 7 and not v_has_renewal then
      perform public.enqueue_child_notification(
        auth_record.child_id,
        'medication',
        auth_record.name || ' expires in 7 days',
        'Review and renew ' || auth_record.child_name ||
          '''s authorization if medication will still be needed at care.',
        jsonb_build_object(
          'screen', 'Medication',
          'type', 'medication',
          'childId', auth_record.child_id,
          'authorizationId', auth_record.id,
          'status', 'expiring'
        ),
        'medication-authorization-expiring:' || auth_record.id,
        array['push']::text[]
      );
      v_reminder_count := v_reminder_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'expired', v_expired_count,
    'renewal_reminders', v_reminder_count,
    'processed_at', now()
  );
end;
$$;

revoke all on function public.process_medication_authorization_statuses() from public;
grant execute on function public.process_medication_authorization_statuses() to service_role;

do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job
    from cron.job
   where jobname = 'dailylog-medication-authorization-status';
  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;

  perform cron.schedule(
    'dailylog-medication-authorization-status',
    '15 * * * *',
    'select public.process_medication_authorization_statuses();'
  );
end;
$$;
