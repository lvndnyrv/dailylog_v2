-- Rollback-safe urgent family/staff broadcast delivery and read-metric test.
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
end $$;

do $$
declare
  v_owner constant uuid := '00000000-0000-4000-a000-000000000001';
  v_educator constant uuid := '00000000-0000-4000-a000-000000000003';
  v_parent constant uuid := '00000000-0000-4000-a000-000000000023';
  v_daycare constant uuid := '10000000-0000-4000-a000-000000000001';
  v_announcement uuid;
  v_metric record;
  v_feed jsonb;
  v_failed boolean := false;
begin
  perform pg_temp.impersonate('authenticated', v_owner);
  begin
    insert into public.announcements (
      daycare_id, author_id, audience_type, title, body, priority,
      scheduled_for, published_at
    ) values (
      v_daycare, v_owner, 'families', 'Invalid scheduled alert', 'Should fail',
      'urgent', now() + interval '1 hour', null
    );
  exception when check_violation then
    v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL: urgent alert was allowed to wait for a schedule'; end if;

  insert into public.announcements (
    daycare_id, author_id, audience_type, title, body, priority, pinned, published_at
  ) values (
    v_daycare, v_owner, 'families', 'Urgent handoff test',
    'Families and classroom staff need the same immediate instruction.',
    'urgent', true, now()
  ) returning id into v_announcement;

  if not exists (
    select 1 from public.notification_outbox delivery
     where delivery.dedupe_key = 'announcement:' || v_announcement
       and delivery.recipient_id = v_parent
       and delivery.payload->>'priority' = 'urgent'
       and delivery.payload->>'channelId' = 'urgent'
       and delivery.title like '🚨 URGENT:%'
  ) then raise exception 'FAIL: linked family did not receive the urgent push'; end if;

  if not exists (
    select 1 from public.notification_outbox delivery
     where delivery.dedupe_key = 'announcement:' || v_announcement
       and delivery.recipient_id = v_educator
       and delivery.payload->>'priority' = 'urgent'
  ) then raise exception 'FAIL: educator did not receive the family-facing urgent alert'; end if;

  if not exists (
    select 1 from public.announcements
     where id = v_announcement
       and email_nudge_eligible_at <= published_at + interval '15 minutes 1 second'
  ) then raise exception 'FAIL: urgent unread-family nudge was not accelerated'; end if;

  perform pg_temp.impersonate('authenticated', v_parent);
  v_feed := public.get_my_localized_announcements(1, v_announcement);
  if jsonb_array_length(v_feed) <> 1 or v_feed->0->>'priority' <> 'urgent' then
    raise exception 'FAIL: localized parent feed lost urgent priority';
  end if;
  insert into public.announcement_reads (announcement_id, profile_id)
  values (v_announcement, v_parent);

  perform pg_temp.impersonate('authenticated', v_educator);
  if not exists (select 1 from public.announcements where id = v_announcement) then
    raise exception 'FAIL: educator could not read the urgent broadcast';
  end if;
  insert into public.announcement_reads (announcement_id, profile_id)
  values (v_announcement, v_educator);

  perform pg_temp.impersonate('postgres');
  update public.announcements
     set email_nudge_eligible_at = clock_timestamp() - interval '1 second'
   where id = v_announcement;
  perform public.process_unread_announcement_email_nudges();
  if not exists (
    select 1 from public.notification_outbox delivery
     where delivery.dedupe_key = 'announcement-unread-email:' || v_announcement
       and delivery.payload->>'priority' = 'urgent'
       and delivery.payload->>'reason' = 'urgent_unread_after_15_minutes'
  ) then raise exception 'FAIL: accelerated urgent email nudge was not queued for unread families'; end if;

  perform pg_temp.impersonate('authenticated', v_owner);
  select * into v_metric
    from public.list_broadcast_delivery_metrics(array[v_announcement]);
  if v_metric.recipient_count < 2
     or v_metric.read_count < 2
     or v_metric.push_queued <> v_metric.recipient_count then
    raise exception 'FAIL: urgent delivery/read metrics are inaccurate: %', row_to_json(v_metric);
  end if;
end $$;

rollback;
select 'PASS: urgent broadcasts immediately reach families and staff with trustworthy read metrics' as result;
