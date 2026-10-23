-- Group 15: honor saved quiet hours when the durable worker claims push rows.
-- Leave rows pending so the next worker run after quiet hours delivers them.
-- Safety alerts shown as exempt in the settings UI may still be claimed.
create or replace function public.claim_notification_batch(p_limit int default 50)
returns setof public.notification_outbox
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;

  update public.notification_outbox
     set status = 'pending', locked_at = null,
         available_at = greatest(available_at, now())
   where status = 'processing' and locked_at < now() - interval '5 minutes';

  return query
    with candidates as (
      select outbox.id
        from public.notification_outbox outbox
       where outbox.status = 'pending'
         and outbox.available_at <= now()
         and not (
           outbox.channel = 'push'
           and outbox.kind not in ('ratio_alert', 'incident', 'incident_report')
           and exists (
             select 1
               from public.notification_delivery_settings settings
               join public.daycares center on center.id = settings.daycare_id
              where settings.profile_id = outbox.recipient_id
                and settings.daycare_id = outbox.daycare_id
                and settings.quiet_hours_enabled
                and settings.quiet_hours_start <> settings.quiet_hours_end
                and (
                  (settings.quiet_hours_start < settings.quiet_hours_end
                    and (now() at time zone center.timezone)::time >= settings.quiet_hours_start
                    and (now() at time zone center.timezone)::time < settings.quiet_hours_end)
                  or
                  (settings.quiet_hours_start > settings.quiet_hours_end
                    and ((now() at time zone center.timezone)::time >= settings.quiet_hours_start
                      or (now() at time zone center.timezone)::time < settings.quiet_hours_end))
                )
           )
         )
       order by outbox.available_at, outbox.created_at
       for update of outbox skip locked
       limit least(greatest(coalesce(p_limit, 50), 1), 100)
    )
    update public.notification_outbox outbox
       set status = 'processing', locked_at = now(), attempts = attempts + 1
      from candidates
     where outbox.id = candidates.id
    returning outbox.*;
end;
$$;
