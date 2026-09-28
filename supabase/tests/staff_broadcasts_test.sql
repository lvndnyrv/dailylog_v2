-- Rollback-safe Admin Group 5 staff-audience visibility, delivery and read checks.
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
  v_educator uuid := '00000000-0000-4000-a000-000000000003';
  v_parent uuid := '00000000-0000-4000-a000-000000000023';
  v_daycare uuid := '10000000-0000-4000-a000-000000000001';
  v_announcement uuid;
  v_metric record;
begin
  perform pg_temp.impersonate('authenticated', v_owner);
  insert into public.announcements (
    daycare_id, author_id, title, body, audience_type, published_at
  ) values (
    v_daycare, v_owner, 'Staff broadcast test', 'Visible to the team only',
    'staff', now()
  ) returning id into v_announcement;

  if exists (
    select 1 from public.notification_outbox delivery
     where delivery.dedupe_key = 'announcement:' || v_announcement
       and delivery.recipient_id = v_owner
  ) then
    raise exception 'FAIL: the broadcast author was notified about their own message';
  end if;

  perform pg_temp.impersonate('authenticated', v_parent);
  if exists (select 1 from public.announcements where id = v_announcement) then
    raise exception 'FAIL: parent saw a staff-only broadcast';
  end if;

  perform pg_temp.impersonate('authenticated', v_educator);
  if not exists (select 1 from public.announcements where id = v_announcement) then
    raise exception 'FAIL: educator could not see a staff-only broadcast';
  end if;
  insert into public.announcement_reads (announcement_id, profile_id)
  values (v_announcement, v_educator);

  perform pg_temp.impersonate('authenticated', v_owner);
  select * into v_metric
    from public.list_broadcast_delivery_metrics(array[v_announcement]);
  if v_metric.read_count <> 1
     or v_metric.recipient_count = 0
     or v_metric.push_queued <> v_metric.recipient_count then
    raise exception 'FAIL: staff delivery/read metrics are inaccurate';
  end if;
end $$;

rollback;
select 'PASS: staff-only broadcasts stay private, notify the team, and report reads' as result;
