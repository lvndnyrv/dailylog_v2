-- Assemble non-urgent admin email into one center-local morning digest.
-- Source deliveries are held and linked until the digest itself succeeds or
-- permanently fails, so delivery health never records unsent mail as sent.
alter table public.notification_outbox
  drop constraint notification_outbox_status_check;
alter table public.notification_outbox
  add constraint notification_outbox_status_check
  check (status in ('pending', 'processing', 'held', 'delivered', 'failed'));
alter table public.notification_outbox
  add column digest_id uuid references public.notification_outbox(id);
create index notification_outbox_digest_source_idx
  on public.notification_outbox (digest_id) where digest_id is not null;

create or replace function public.materialize_admin_daily_digests(p_limit int default 20)
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  v_group record;
  v_ids uuid[];
  v_count int;
  v_lines text;
  v_digest_id uuid;
  v_created int := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;

  for v_group in
    select distinct outbox.daycare_id, outbox.recipient_id,
           (outbox.created_at at time zone center.timezone)::date as local_day,
           center.timezone
      from public.notification_outbox outbox
      join public.profiles profile on profile.id = outbox.recipient_id
      join public.daycares center on center.id = outbox.daycare_id
      left join public.notification_delivery_settings settings
        on settings.profile_id = outbox.recipient_id
       and settings.daycare_id = outbox.daycare_id
     where outbox.status = 'pending'
       and outbox.channel = 'email'
       and outbox.kind in ('cert_expiry', 'compliance_due', 'overdue_billing', 'waitlist_enrollment')
       and outbox.available_at <= now()
       and profile.role in ('admin', 'owner_admin')
       and coalesce(settings.email_mode, 'daily_digest') = 'daily_digest'
       and (now() at time zone center.timezone)::time >= time '08:00'
       and (outbox.created_at at time zone center.timezone)::date
         < (now() at time zone center.timezone)::date
     order by local_day, outbox.daycare_id, outbox.recipient_id, center.timezone
     limit least(greatest(coalesce(p_limit, 20), 1), 50)
  loop
    -- Lock all rows in this recipient/day group. A competing worker skips
    -- them; it cannot build a second digest from the same source rows.
    select array_agg(source.id order by source.created_at, source.id),
           count(*)::int,
           string_agg(
             case when source.position <= 30 then
               '• ' || left(source.title, 160)
                 || case when nullif(btrim(source.body), '') is null then ''
                         else ' — ' || left(source.body, 240) end
             end,
             E'\n' order by source.created_at, source.id
           )
      into v_ids, v_count, v_lines
      from (
        select locked.*,
               row_number() over (order by locked.created_at, locked.id) as position
          from (
            select outbox.id, outbox.title, outbox.body, outbox.created_at
              from public.notification_outbox outbox
             where outbox.daycare_id = v_group.daycare_id
               and outbox.recipient_id = v_group.recipient_id
               and outbox.status = 'pending'
               and outbox.channel = 'email'
               and outbox.kind in ('cert_expiry', 'compliance_due', 'overdue_billing', 'waitlist_enrollment')
               and outbox.available_at <= now()
               and (outbox.created_at at time zone v_group.timezone)::date = v_group.local_day
             order by outbox.created_at, outbox.id
             for update of outbox skip locked
          ) locked
      ) source;

    if v_count = 0 then continue; end if;

    insert into public.notification_outbox (
      daycare_id, recipient_id, channel, kind, title, body, payload, dedupe_key
    ) values (
      v_group.daycare_id, v_group.recipient_id, 'email', 'admin_daily_digest',
      'DailyLog daily digest · ' || to_char(v_group.local_day, 'Mon FMDD, YYYY'),
      format('%s update%s from your center for %s:', v_count,
             case when v_count = 1 then '' else 's' end,
             to_char(v_group.local_day, 'Mon FMDD, YYYY'))
        || E'\n\n' || coalesce(v_lines, '')
        || case when v_count > 30 then
             format(E'\n\n…and %s more. Sign in to DailyLog to review all notifications.', v_count - 30)
           else '' end,
      jsonb_build_object('type', 'admin_daily_digest', 'localDate', v_group.local_day,
                         'notificationCount', v_count),
      'admin-digest:' || v_group.local_day::text || ':' || v_ids[1]::text
    ) returning id into v_digest_id;

    update public.notification_outbox
       set status = 'held', digest_id = v_digest_id
     where id = any(v_ids);
    v_created := v_created + 1;
  end loop;

  return v_created;
end;
$$;

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
           outbox.channel = 'email'
           and outbox.kind in ('cert_expiry', 'compliance_due', 'overdue_billing', 'waitlist_enrollment')
           and exists (
             select 1
               from public.profiles profile
               left join public.notification_delivery_settings settings
                 on settings.profile_id = profile.id
                and settings.daycare_id = outbox.daycare_id
              where profile.id = outbox.recipient_id
                and profile.role in ('admin', 'owner_admin')
                and coalesce(settings.email_mode, 'daily_digest') = 'daily_digest'
           )
         )
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

create or replace function public.complete_notification_delivery(
  p_id uuid,
  p_succeeded boolean,
  p_error text default null,
  p_provider_response jsonb default null,
  p_permanent boolean default false,
  p_retry_after_seconds int default 60
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;

  update public.notification_outbox
     set status = case
           when p_succeeded then 'delivered'
           when p_permanent or attempts >= max_attempts then 'failed'
           else 'pending'
         end,
         delivered_at = case when p_succeeded then now() else null end,
         locked_at = null,
         last_error = case when p_succeeded then null else left(p_error, 2000) end,
         provider_response = p_provider_response,
         available_at = case
           when p_succeeded or p_permanent or attempts >= max_attempts then available_at
           else now() + make_interval(secs => least(greatest(p_retry_after_seconds, 10), 3600))
         end
   where id = p_id and status = 'processing'
   returning status into v_status;

  if v_status in ('delivered', 'failed') then
    update public.notification_outbox
       set status = v_status,
           delivered_at = case when v_status = 'delivered' then now() else null end,
           last_error = case when v_status = 'failed' then left(p_error, 2000) else null end,
           provider_response = p_provider_response
     where digest_id = p_id and status = 'held';
  end if;
end;
$$;

-- Show the digest as the external delivery, not each linked source row.
create or replace function public.list_notification_delivery_health(p_days integer default 7)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_daycare uuid := public.get_my_daycare_id();
  v_days integer := least(greatest(coalesce(p_days, 7), 1), 30);
  v_result jsonb;
begin
  if v_daycare is null or not public.has_permission('reports', 'view') then
    return jsonb_build_object(
      'windowDays', v_days,
      'counts', jsonb_build_object('total', 0, 'delivered', 0, 'queued', 0,
        'retrying', 0, 'processing', 0, 'skipped', 0, 'failed', 0),
      'deliveries', '[]'::jsonb
    );
  end if;

  with recent as (
    select outbox.*,
      case
        when outbox.provider_response ->> 'skipped' is not null then 'skipped'
        when outbox.status = 'pending' and outbox.attempts > 0 then 'retrying'
        when outbox.status = 'pending' then 'queued'
        else outbox.status
      end as display_status,
      case
        when outbox.provider_response ->> 'skipped' = 'no_push_token'
          then 'No registered device for this recipient.'
        when coalesce(outbox.last_error, '') ilike '%EMAIL_WEBHOOK_URL%'
          then 'Email provider is not configured.'
        when coalesce(outbox.last_error, '') ilike '%DeviceNotRegistered%'
          then 'The recipient device is no longer registered.'
        when outbox.status = 'failed'
          then 'The delivery provider rejected this notification.'
        when outbox.status = 'pending' and outbox.attempts > 0
          then 'Delivery will retry automatically.'
        else null
      end as issue,
      (outbox.status = 'failed'
        and coalesce(outbox.last_error, '') not ilike '%EMAIL_WEBHOOK_URL%'
        and coalesce(outbox.last_error, '') not ilike 'cancelled%'
        and coalesce(outbox.last_error, '') not ilike '%restored before%') as can_retry
    from public.notification_outbox outbox
    where outbox.daycare_id = v_daycare
      and outbox.digest_id is null
      and outbox.created_at >= now() - make_interval(days => v_days)
  ), counts as (
    select count(*) as total,
      count(*) filter (where display_status = 'delivered') as delivered,
      count(*) filter (where display_status = 'queued') as queued,
      count(*) filter (where display_status = 'retrying') as retrying,
      count(*) filter (where display_status = 'processing') as processing,
      count(*) filter (where display_status = 'skipped') as skipped,
      count(*) filter (where display_status = 'failed') as failed
    from recent
  ), detail as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', item.id, 'title', item.title, 'kind', item.kind,
      'channel', item.channel, 'status', item.display_status,
      'attempts', item.attempts, 'maxAttempts', item.max_attempts,
      'createdAt', item.created_at, 'deliveredAt', item.delivered_at,
      'availableAt', item.available_at, 'issue', item.issue,
      'canRetry', item.can_retry
    ) order by
      case item.display_status when 'failed' then 0 when 'retrying' then 1
        when 'processing' then 2 when 'skipped' then 3 when 'queued' then 4 else 5 end,
      item.created_at desc), '[]'::jsonb) as rows
    from (
      select * from recent
      order by case display_status when 'failed' then 0 when 'retrying' then 1
        when 'processing' then 2 when 'skipped' then 3 when 'queued' then 4 else 5 end,
        created_at desc
      limit 75
    ) item
  )
  select jsonb_build_object('windowDays', v_days, 'counts', jsonb_build_object(
    'total', counts.total, 'delivered', counts.delivered, 'queued', counts.queued,
    'retrying', counts.retrying, 'processing', counts.processing,
    'skipped', counts.skipped, 'failed', counts.failed
  ), 'deliveries', detail.rows) into v_result
  from counts cross join detail;

  return v_result;
end;
$$;

create or replace function public.retry_notification_delivery(p_delivery_id uuid)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  v_delivery public.notification_outbox%rowtype;
begin
  if not public.has_permission('reports', 'edit') then
    raise exception 'Reports edit permission required';
  end if;

  select * into v_delivery
    from public.notification_outbox
   where id = p_delivery_id
     and daycare_id = public.get_my_daycare_id()
   for update;
  if not found then raise exception 'Delivery not found'; end if;
  if v_delivery.digest_id is not null then
    raise exception 'Retry the digest, not an item within it';
  end if;
  if v_delivery.status <> 'failed' then
    raise exception 'Only failed deliveries can be retried';
  end if;
  if coalesce(v_delivery.last_error, '') ilike 'cancelled%'
     or coalesce(v_delivery.last_error, '') ilike '%restored before%' then
    raise exception 'Cancelled deliveries cannot be retried';
  end if;

  update public.notification_outbox
     set status = 'pending', attempts = 0, available_at = now(),
         locked_at = null, delivered_at = null,
         last_error = null, provider_response = null
   where id = p_delivery_id;

  if v_delivery.kind = 'admin_daily_digest' then
    update public.notification_outbox
       set status = 'held', delivered_at = null,
           last_error = null, provider_response = null
     where digest_id = p_delivery_id and status = 'failed';
  end if;
  return true;
end;
$$;

revoke all on function public.materialize_admin_daily_digests(int) from public, anon, authenticated;
grant execute on function public.materialize_admin_daily_digests(int) to service_role;
