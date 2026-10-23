-- Rollback-only: the linked development project never sends these messages.
begin;

do $$
declare
  v_owner uuid := '00000000-0000-4000-a000-000000000001';
  v_daycare uuid;
  v_timezone text;
  v_first uuid := gen_random_uuid();
  v_second uuid := gen_random_uuid();
  v_safety uuid := gen_random_uuid();
  v_failed_source uuid := gen_random_uuid();
  v_digest uuid;
  v_claimed uuid[];
  v_status text;
  v_count int;
begin
  select daycare_id into v_daycare from public.profiles where id = v_owner;
  if v_daycare is null then raise exception 'Seeded owner is missing'; end if;

  v_timezone := case when (now() at time zone 'UTC')::time >= time '08:00'
    then 'UTC' else 'Etc/GMT+12' end;
  update public.daycares set timezone = v_timezone where id = v_daycare;
  insert into public.notification_delivery_settings (profile_id, daycare_id, email_mode)
  values (v_owner, v_daycare, 'daily_digest')
  on conflict (profile_id) do update set email_mode = 'daily_digest';

  insert into public.notification_outbox (
    id, daycare_id, recipient_id, channel, kind, title, dedupe_key,
    created_at, available_at
  ) values
    (v_first, v_daycare, v_owner, 'email', 'compliance_due',
     'First digest item', v_first::text,
     '2000-01-01 12:00:00+00', '2000-01-01'),
    (v_second, v_daycare, v_owner, 'email', 'cert_expiry',
     'Second digest item', v_second::text,
     '2000-01-01 13:00:00+00', '2000-01-01'),
    (v_safety, v_daycare, v_owner, 'email', 'incident_report',
     'Immediate safety email', v_safety::text,
     '2000-01-01 14:00:00+00', '2000-01-01');

  perform set_config('request.jwt.claim.role', 'service_role', true);
  execute 'set local role service_role';

  select array_agg(id) into v_claimed from public.claim_notification_batch(100);
  if v_first = any(coalesce(v_claimed, array[]::uuid[]))
    or v_second = any(coalesce(v_claimed, array[]::uuid[]))
    or not (v_safety = any(coalesce(v_claimed, array[]::uuid[]))) then
    raise exception 'Ordinary admin email was claimed individually or safety email was held';
  end if;

  perform public.materialize_admin_daily_digests(50);
  select digest_id into v_digest from public.notification_outbox where id = v_first;
  if v_digest is null or v_digest <> (select digest_id from public.notification_outbox where id = v_second) then
    raise exception 'Two same-day messages did not share one digest';
  end if;
  select status into v_status from public.notification_outbox where id = v_first;
  if v_status <> 'held' then raise exception 'Digest source was not held'; end if;
  select count(*) into v_count from public.notification_outbox
   where id = v_digest and body like '%First digest item%Second digest item%';
  if v_count <> 1 then raise exception 'Digest body omitted a source item'; end if;

  update public.notification_outbox set available_at = '2000-01-01' where id = v_digest;
  select array_agg(id) into v_claimed from public.claim_notification_batch(100);
  if not (v_digest = any(coalesce(v_claimed, array[]::uuid[]))) then
    raise exception 'Digest was not claimable';
  end if;
  perform public.complete_notification_delivery(v_digest, true, p_provider_response := '{"ok":true}');
  select count(*) into v_count from public.notification_outbox
   where id in (v_first, v_second, v_digest) and status = 'delivered';
  if v_count <> 3 then raise exception 'Digest completion did not finalize its sources'; end if;

  insert into public.notification_outbox (
    id, daycare_id, recipient_id, channel, kind, title, dedupe_key,
    created_at, available_at
  ) values (
    v_failed_source, v_daycare, v_owner, 'email', 'compliance_due',
    'Retry test item', v_failed_source::text,
    '1999-01-01 12:00:00+00', '1999-01-01'
  );
  perform public.materialize_admin_daily_digests(50);
  select digest_id into v_digest from public.notification_outbox where id = v_failed_source;
  update public.notification_outbox set available_at = '1999-01-01' where id = v_digest;
  perform public.claim_notification_batch(100);
  perform public.complete_notification_delivery(v_digest, false,
    p_error := 'Test provider rejection', p_permanent := true);
  select status into v_status from public.notification_outbox where id = v_failed_source;
  if v_status <> 'failed' then raise exception 'Failed digest did not fail its sources'; end if;

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  perform public.retry_notification_delivery(v_digest);
  select status into v_status from public.notification_outbox where id = v_failed_source;
  if v_status <> 'held' then raise exception 'Retry did not re-hold digest sources'; end if;

  execute 'reset role';
end;
$$;

rollback;
select 'PASS: admin digest grouping, immediate safety email, completion and retry' as result;
