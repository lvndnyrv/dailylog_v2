begin;

create or replace function pg_temp.impersonate(p_role text, p_user uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user, 'role', case when p_role = 'postgres' then 'service_role' else p_role end)::text,
    true
  );
  perform set_config('role', p_role, true);
end;
$$;

do $$
declare
  v_owner uuid := '00000000-0000-4000-a000-000000000001';
  v_restricted uuid := '00000000-0000-4000-a000-000000000008';
  v_daycare uuid;
  v_role uuid;
  v_delivery uuid;
  v_unconfigured uuid;
  v_health jsonb;
begin
  select daycare_id into v_daycare from public.profiles where id = v_owner;
  if v_daycare is null then raise exception 'Missing dev owner fixture'; end if;

  perform pg_temp.impersonate('postgres');
  insert into public.notification_outbox(
    daycare_id, recipient_id, channel, kind, title, body, status,
    dedupe_key, attempts, max_attempts, last_error
  ) values (
    v_daycare, v_owner, 'push', 'delivery_health_test',
    'Rollback-only failed delivery', 'Test body', 'failed',
    'delivery-health:' || gen_random_uuid()::text, 5, 5, 'Simulated provider failure'
  ) returning id into v_delivery;

  perform pg_temp.impersonate('authenticated', v_owner);
  v_health := public.list_notification_delivery_health(7);
  if not exists (
    select 1 from jsonb_array_elements(v_health -> 'deliveries') row
    where row ->> 'id' = v_delivery::text
      and row ->> 'status' = 'failed'
      and (row ->> 'canRetry')::boolean
      and row ->> 'issue' = 'The delivery provider rejected this notification.'
  ) then raise exception 'FAIL: sanitized failed delivery is missing'; end if;

  if not public.retry_notification_delivery(v_delivery) then
    raise exception 'FAIL: retry did not return success';
  end if;
  if not exists (
    select 1 from public.notification_outbox
    where id = v_delivery and status = 'pending' and attempts = 0 and last_error is null
  ) then raise exception 'FAIL: failed delivery was not reset safely'; end if;

  perform pg_temp.impersonate('postgres');
  insert into public.notification_outbox(
    daycare_id, recipient_id, channel, kind, title, body, status,
    dedupe_key, attempts, max_attempts, last_error
  ) values (
    v_daycare, v_owner, 'email', 'delivery_health_test',
    'Rollback-only unconfigured email', 'Test body', 'failed',
    'delivery-health-email:' || gen_random_uuid()::text, 1, 5,
    'Email delivery is not configured: set EMAIL_WEBHOOK_URL before enabling email notifications'
  ) returning id into v_unconfigured;
  perform pg_temp.impersonate('authenticated', v_owner);
  begin
    perform public.retry_notification_delivery(v_unconfigured);
    raise exception 'FAIL: unconfigured email delivery was retried';
  exception when others then
    if sqlerrm = 'FAIL: unconfigured email delivery was retried' then raise; end if;
  end;

  perform pg_temp.impersonate('postgres');
  insert into public.center_roles(daycare_id, name, base_role, permissions)
  values(v_daycare, 'Rollback-only no reports', 'admin', '{"reports":{"view":false,"edit":false}}')
  returning id into v_role;
  update public.profiles set role = 'admin', center_role_id = v_role where id = v_restricted;

  perform pg_temp.impersonate('authenticated', v_restricted);
  v_health := public.list_notification_delivery_health(7);
  if (v_health #>> '{counts,total}')::integer <> 0 then
    raise exception 'FAIL: restricted admin sees delivery health';
  end if;
  begin
    perform public.retry_notification_delivery(v_delivery);
    raise exception 'FAIL: restricted admin retried a delivery';
  exception when others then
    if sqlerrm = 'FAIL: restricted admin retried a delivery' then raise; end if;
  end;
end;
$$;

rollback;
select 'PASS: delivery health is sanitized, permission-scoped and safely retryable' as result;
