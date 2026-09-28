-- A missing provider is configuration work, not a transient delivery failure.
-- Prevent repeated manual retries until email delivery has been connected.

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
  if coalesce(v_delivery.last_error, '') ilike '%EMAIL_WEBHOOK_URL%' then
    raise exception 'Connect an email provider before retrying this delivery';
  end if;
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

revoke all on function public.retry_notification_delivery(uuid)
  from public, anon;
grant execute on function public.retry_notification_delivery(uuid)
  to authenticated;

