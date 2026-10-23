-- Rollback-only test: ordinary push waits, safety push and email do not.
begin;

do $$
declare
  v_owner uuid := '00000000-0000-4000-a000-000000000001';
  v_daycare uuid;
  v_timezone text;
  v_local timestamp;
  v_regular uuid := gen_random_uuid();
  v_ratio uuid := gen_random_uuid();
  v_incident uuid := gen_random_uuid();
  v_email uuid := gen_random_uuid();
  v_claimed uuid[];
begin
  select profile.daycare_id, center.timezone
    into v_daycare, v_timezone
    from public.profiles profile
    join public.daycares center on center.id = profile.daycare_id
   where profile.id = v_owner;
  if v_daycare is null then raise exception 'Seeded owner is missing'; end if;
  v_local := now() at time zone v_timezone;

  insert into public.notification_delivery_settings (
    profile_id, daycare_id, quiet_hours_enabled, quiet_hours_start, quiet_hours_end
  ) values (
    v_owner, v_daycare, true,
    (v_local - interval '1 hour')::time,
    (v_local + interval '1 hour')::time
  ) on conflict (profile_id) do update
    set quiet_hours_enabled = true,
        quiet_hours_start = excluded.quiet_hours_start,
        quiet_hours_end = excluded.quiet_hours_end;

  insert into public.notification_outbox (
    id, daycare_id, recipient_id, channel, kind, title, dedupe_key, available_at
  ) values
    (v_regular, v_daycare, v_owner, 'push', 'cert_expiry', 'Quiet test', v_regular::text, '2000-01-01'),
    (v_ratio, v_daycare, v_owner, 'push', 'ratio_alert', 'Ratio test', v_ratio::text, '2000-01-01'),
    (v_incident, v_daycare, v_owner, 'push', 'incident_report', 'Incident test', v_incident::text, '2000-01-01'),
    (v_email, v_daycare, v_owner, 'email', 'incident_report', 'Safety email test', v_email::text, '2000-01-01');

  perform set_config('request.jwt.claim.role', 'service_role', true);
  execute 'set local role service_role';
  select array_agg(id) into v_claimed from public.claim_notification_batch(100);
  if v_regular = any(coalesce(v_claimed, array[]::uuid[]))
    or not (v_ratio = any(coalesce(v_claimed, array[]::uuid[])))
    or not (v_incident = any(coalesce(v_claimed, array[]::uuid[])))
    or not (v_email = any(coalesce(v_claimed, array[]::uuid[]))) then
    raise exception 'Quiet-hours claim guard did not hold ordinary push and pass safety/email';
  end if;

  execute 'reset role';
  update public.notification_delivery_settings
     set quiet_hours_enabled = false
   where profile_id = v_owner;
  execute 'set local role service_role';
  select array_agg(id) into v_claimed from public.claim_notification_batch(100);
  if not (v_regular = any(coalesce(v_claimed, array[]::uuid[]))) then
    raise exception 'Held push was not claimable after quiet hours ended';
  end if;
  execute 'reset role';
end;
$$;

rollback;
select 'PASS: quiet hours defer ordinary push but not safety push or email' as result;
