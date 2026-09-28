-- Rollback-safe Admin Group 5c scheduling, visibility and metrics checks.
begin;

create or replace function pg_temp.impersonate(p_role text, p_user uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', p_user,
      'role', case when p_role = 'postgres' then 'service_role' else p_role end
    )::text,
    true
  );
  perform set_config('role', p_role, true);
end $$;

do $$
declare
  v_owner uuid := '00000000-0000-4000-a000-000000000001';
  v_parent uuid := '00000000-0000-4000-a000-000000000023';
  v_daycare uuid := '10000000-0000-4000-a000-000000000001';
  v_announcement uuid;
  v_cancelled uuid;
  v_metric record;
begin
  perform pg_temp.impersonate('authenticated', v_owner);
  insert into public.announcements (
    daycare_id, author_id, title, body, scheduled_for, published_at
  ) values (
    v_daycare, v_owner, 'Scheduled broadcast test', 'Hidden until publication',
    now() + interval '1 hour', null
  ) returning id into v_announcement;

  if exists (
    select 1 from public.notification_outbox delivery
     where delivery.dedupe_key = 'announcement:' || v_announcement
  ) then
    raise exception 'FAIL: scheduled broadcast queued early';
  end if;

  perform pg_temp.impersonate('authenticated', v_parent);
  if exists (select 1 from public.announcements where id = v_announcement) then
    raise exception 'FAIL: parent saw scheduled broadcast before publication';
  end if;

  perform pg_temp.impersonate('authenticated', v_owner);
  select * into v_metric
    from public.list_broadcast_delivery_metrics(array[v_announcement]);
  if coalesce(v_metric.recipient_count, 0) = 0 or v_metric.push_queued <> 0 then
    raise exception 'FAIL: scheduled metrics did not show the future audience';
  end if;
  update public.announcements
     set scheduled_for = now() - interval '1 minute'
   where id = v_announcement;

  perform pg_temp.impersonate('postgres');
  if public.process_due_announcements() <> 1 then
    raise exception 'FAIL: due broadcast was not published';
  end if;

  perform pg_temp.impersonate('authenticated', v_parent);
  if not exists (select 1 from public.announcements where id = v_announcement) then
    raise exception 'FAIL: parent could not see published broadcast';
  end if;
  insert into public.announcement_reads (announcement_id, profile_id)
  values (v_announcement, v_parent);

  perform pg_temp.impersonate('authenticated', v_owner);
  select * into v_metric
    from public.list_broadcast_delivery_metrics(array[v_announcement]);
  if v_metric.read_count <> 1
     or v_metric.push_queued <> v_metric.recipient_count
     or v_metric.recipient_count = 0 then
    raise exception 'FAIL: published delivery/read metrics are inaccurate';
  end if;

  insert into public.announcements (
    daycare_id, author_id, title, body, scheduled_for, published_at, cancelled_at
  ) values (
    v_daycare, v_owner, 'Cancelled broadcast test', 'Never visible',
    now() - interval '1 minute', null, now()
  ) returning id into v_cancelled;

  perform pg_temp.impersonate('postgres');
  if public.process_due_announcements() <> 0 then
    raise exception 'FAIL: cancelled broadcast was published';
  end if;

  perform pg_temp.impersonate('authenticated', v_parent);
  if exists (select 1 from public.announcements where id = v_cancelled) then
    raise exception 'FAIL: parent saw cancelled broadcast';
  end if;
end $$;

rollback;
select 'PASS: scheduled broadcasts publish once, remain private beforehand, and report delivery/read metrics' as result;

