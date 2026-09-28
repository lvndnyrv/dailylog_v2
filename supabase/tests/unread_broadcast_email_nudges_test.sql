-- Rollback-safe Admin Group 5c unread email reminder checks.
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
  v_first_count integer;
begin
  perform pg_temp.impersonate('authenticated', v_owner);
  insert into public.announcements (
    daycare_id, author_id, title, body, audience_type, published_at
  ) values (
    v_daycare, v_owner, 'Unread reminder test', 'A center update to review.',
    'families', now() - interval '25 hours'
  ) returning id into v_announcement;

  if not exists (
    select 1 from public.announcements
     where id = v_announcement and email_nudge_eligible_at <= now()
  ) then
    raise exception 'FAIL: the 24-hour reminder was not scheduled';
  end if;

  -- This recipient opened the announcement and must never be nudged.
  perform pg_temp.impersonate('authenticated', v_parent);
  insert into public.announcement_reads (announcement_id, profile_id)
  values (v_announcement, v_parent);

  perform pg_temp.impersonate('postgres');
  v_first_count := public.process_unread_announcement_email_nudges();
  if v_first_count = 0 then
    raise exception 'FAIL: no unread family recipients were nudged';
  end if;
  if exists (
    select 1 from public.notification_outbox delivery
     where delivery.dedupe_key = 'announcement-unread-email:' || v_announcement
       and delivery.recipient_id = v_parent
  ) then
    raise exception 'FAIL: a family member who already read the update was nudged';
  end if;
  if public.process_unread_announcement_email_nudges() <> 0 then
    raise exception 'FAIL: the same unread reminders were queued twice';
  end if;
end $$;

rollback;
select 'PASS: unread family broadcasts receive one email reminder after 24 hours' as result;
