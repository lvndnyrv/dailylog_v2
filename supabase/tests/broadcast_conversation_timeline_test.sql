-- Rollback-safe Admin Group 5 broadcast-to-family-thread checks.
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
  v_family_announcement uuid;
  v_staff_announcement uuid;
  v_conversation uuid;
begin
  perform pg_temp.impersonate('authenticated', v_owner);
  insert into public.announcements (
    daycare_id, author_id, title, body, audience_type, published_at
  ) values (
    v_daycare, v_owner, 'Timeline broadcast test', 'Visible inside family conversations.',
    'families', now()
  ) returning id into v_family_announcement;

  select delivery.conversation_id into v_conversation
    from public.announcement_thread_deliveries delivery
    join public.conversations conversation on conversation.id = delivery.conversation_id
    join public.parent_children parent_link on parent_link.child_id = conversation.child_id
   where delivery.announcement_id = v_family_announcement
     and parent_link.parent_id = v_parent
   limit 1;

  if v_conversation is null then
    raise exception 'FAIL: family broadcast was not materialized into a linked conversation';
  end if;

  perform pg_temp.impersonate('authenticated', v_parent);
  if not exists (
    select 1 from public.get_family_conversation_timeline(v_conversation) timeline
     where timeline.item_type = 'announcement'
       and timeline.announcement_id = v_family_announcement
  ) then
    raise exception 'FAIL: parent could not read the inline broadcast timeline entry';
  end if;

  perform pg_temp.impersonate('authenticated', v_owner);
  if not exists (
    select 1 from public.get_inbox_threads() inbox
     where inbox.conversation_id = v_conversation
       and inbox.last_message_body = '📢 Timeline broadcast test'
  ) then
    raise exception 'FAIL: admin inbox preview did not reflect the broadcast';
  end if;

  insert into public.announcements (
    daycare_id, author_id, title, body, audience_type, published_at
  ) values (
    v_daycare, v_owner, 'Private team update', 'Staff only.', 'staff', now()
  ) returning id into v_staff_announcement;

  if exists (
    select 1 from public.announcement_thread_deliveries
     where announcement_id = v_staff_announcement
  ) then
    raise exception 'FAIL: staff-only broadcast leaked into a family conversation';
  end if;
end $$;

rollback;
select 'PASS: family broadcasts join conversation timelines while staff updates stay private' as result;
