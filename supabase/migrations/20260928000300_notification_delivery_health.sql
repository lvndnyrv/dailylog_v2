-- Give authorized administrators an operational view of external delivery
-- without exposing recipient identity or raw provider responses. Genuine
-- failures can be retried; intentionally cancelled deliveries cannot.

create or replace function public.list_notification_delivery_health(p_days integer default 7)
returns jsonb
language plpgsql
stable
security definer
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
      'counts', jsonb_build_object(
        'total', 0, 'delivered', 0, 'queued', 0, 'retrying', 0,
        'processing', 0, 'skipped', 0, 'failed', 0
      ),
      'deliveries', '[]'::jsonb
    );
  end if;

  with recent as (
    select
      outbox.*,
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
      (
        outbox.status = 'failed'
        and coalesce(outbox.last_error, '') not ilike '%EMAIL_WEBHOOK_URL%'
        and coalesce(outbox.last_error, '') not ilike 'cancelled%'
        and coalesce(outbox.last_error, '') not ilike '%restored before%'
      ) as can_retry
    from public.notification_outbox outbox
    where outbox.daycare_id = v_daycare
      and outbox.created_at >= now() - make_interval(days => v_days)
  ), counts as (
    select
      count(*) as total,
      count(*) filter (where display_status = 'delivered') as delivered,
      count(*) filter (where display_status = 'queued') as queued,
      count(*) filter (where display_status = 'retrying') as retrying,
      count(*) filter (where display_status = 'processing') as processing,
      count(*) filter (where display_status = 'skipped') as skipped,
      count(*) filter (where display_status = 'failed') as failed
    from recent
  ), detail as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', item.id,
      'title', item.title,
      'kind', item.kind,
      'channel', item.channel,
      'status', item.display_status,
      'attempts', item.attempts,
      'maxAttempts', item.max_attempts,
      'createdAt', item.created_at,
      'deliveredAt', item.delivered_at,
      'availableAt', item.available_at,
      'issue', item.issue,
      'canRetry', item.can_retry
    ) order by
      case item.display_status
        when 'failed' then 0 when 'retrying' then 1 when 'processing' then 2
        when 'skipped' then 3 when 'queued' then 4 else 5
      end,
      item.created_at desc
    ), '[]'::jsonb) as rows
    from (
      select * from recent
      order by
        case display_status
          when 'failed' then 0 when 'retrying' then 1 when 'processing' then 2
          when 'skipped' then 3 when 'queued' then 4 else 5
        end,
        created_at desc
      limit 75
    ) item
  )
  select jsonb_build_object(
    'windowDays', v_days,
    'counts', jsonb_build_object(
      'total', counts.total,
      'delivered', counts.delivered,
      'queued', counts.queued,
      'retrying', counts.retrying,
      'processing', counts.processing,
      'skipped', counts.skipped,
      'failed', counts.failed
    ),
    'deliveries', detail.rows
  ) into v_result
  from counts cross join detail;

  return v_result;
end;
$$;

create or replace function public.retry_notification_delivery(p_delivery_id uuid)
returns boolean
language plpgsql
security definer
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
  if v_delivery.status <> 'failed' then raise exception 'Only failed deliveries can be retried'; end if;
  if coalesce(v_delivery.last_error, '') ilike 'cancelled%'
     or coalesce(v_delivery.last_error, '') ilike '%restored before%' then
    raise exception 'Cancelled deliveries cannot be retried';
  end if;

  update public.notification_outbox
  set status = 'pending',
      attempts = 0,
      available_at = now(),
      locked_at = null,
      delivered_at = null,
      last_error = null,
      provider_response = null
  where id = p_delivery_id;

  return true;
end;
$$;

revoke all on function public.list_notification_delivery_health(integer)
  from public, anon;
revoke all on function public.retry_notification_delivery(uuid)
  from public, anon;
grant execute on function public.list_notification_delivery_health(integer)
  to authenticated;
grant execute on function public.retry_notification_delivery(uuid)
  to authenticated;
