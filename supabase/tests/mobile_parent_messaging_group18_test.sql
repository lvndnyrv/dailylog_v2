-- Mobile Parent Group 18 messaging tests. All mutations roll back.
begin;

create or replace function pg_temp.impersonate(p_role text, p_user_id uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('role', p_role, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', p_user_id,
      'role', case when p_role = 'postgres' then 'service_role' else p_role end
    )::text,
    true
  );
end;
$$;

do $$
declare
  v_daycare constant uuid := '10000000-0000-4000-a000-000000000001';
  v_owner constant uuid := '00000000-0000-4000-a000-000000000001';
  v_parent constant uuid := '00000000-0000-4000-a000-000000000023';
  v_other_parent constant uuid := '00000000-0000-4000-a000-000000000024';
  v_restricted constant uuid := '00000000-0000-4000-a000-000000000008';
  v_child constant uuid := '30000000-0000-4000-a000-000000000013';
  v_other_child constant uuid := '30000000-0000-4000-a000-000000000014';
  v_conversation uuid;
  v_retry uuid;
  v_other_conversation uuid;
  v_message uuid := gen_random_uuid();
  v_reply uuid := gen_random_uuid();
  v_muted_reply uuid := gen_random_uuid();
  v_role uuid;
  v_failed boolean := false;
begin
  perform pg_temp.impersonate('postgres');
  insert into public.center_roles (daycare_id, name, base_role, permissions)
  values (
    v_daycare,
    'Rollback-only no child messages',
    'admin',
    '{"children":{"view":false,"edit":false,"approve":false}}'
  ) returning id into v_role;
  update public.profiles
     set role = 'admin', center_role_id = v_role, archived_at = null
   where id = v_restricted;
  update public.staff_delegations
     set revoked_at = now()
   where delegate_profile_id = v_restricted and revoked_at is null;
  update public.children
     set archived_at = null,
         enrolled_on = least(coalesce(enrolled_on, current_date), current_date)
   where id = v_child;
  perform pg_temp.impersonate('authenticated', v_parent);
  v_conversation := public.get_or_create_child_conversation(v_child);
  v_retry := public.get_or_create_child_conversation(v_child);

  if v_conversation is null or v_retry <> v_conversation then
    raise exception 'FAIL: conversation creation was not idempotent';
  end if;
  if (
    select count(*)
    from public.conversations
    where child_id = v_child and kind = 'direct' and archived_at is null
  ) <> 1 then
    raise exception 'FAIL: more than one active direct conversation exists';
  end if;
  raise notice 'PASS: linked family gets one durable child conversation';

  insert into public.messages (
    id, daycare_id, conversation_id, child_id, sender_id, body
  ) values (
    v_message, v_daycare, v_conversation, v_child, v_parent, 'Group 18 read receipt test'
  );

  perform pg_temp.impersonate('postgres');
  if not exists (
    select 1 from public.notifications notification
     where notification.profile_id = v_owner
       and notification.kind = 'parent_messages'
       and notification.payload ->> 'messageId' = v_message::text
       and notification.payload ->> 'screen' = 'Messaging'
  ) then
    raise exception 'FAIL: family message did not create a routed staff alert';
  end if;
  if exists (
    select 1 from public.notifications notification
     where notification.profile_id = v_restricted
       and notification.payload ->> 'messageId' = v_message::text
  ) then
    raise exception 'FAIL: restricted admin received a private child message alert';
  end if;
  if not exists (
    select 1 from public.notification_outbox outbox
     where outbox.recipient_id = v_owner
       and outbox.kind = 'parent_messages'
       and outbox.channel = 'push'
       and outbox.payload ->> 'messageId' = v_message::text
  ) then
    raise exception 'FAIL: family message did not queue a staff push alert';
  end if;
  if exists (
    select 1 from public.notification_outbox outbox
     where outbox.recipient_id = v_restricted
       and outbox.payload ->> 'messageId' = v_message::text
  ) then
    raise exception 'FAIL: restricted admin received a private child message push';
  end if;

  perform pg_temp.impersonate('authenticated', v_owner);
  insert into public.messages (
    id, daycare_id, conversation_id, child_id, sender_id, body
  ) values (
    v_reply, v_daycare, v_conversation, v_child, v_owner, 'Group 18 center reply'
  );
  perform pg_temp.impersonate('postgres');
  if not exists (
    select 1 from public.notifications notification
     where notification.profile_id = v_parent
       and notification.kind = 'parent_messages'
       and notification.payload ->> 'messageId' = v_reply::text
       and notification.payload ->> 'childId' = v_child::text
  ) then
    raise exception 'FAIL: center reply did not create a routed family alert';
  end if;
  if exists (
    select 1 from public.notifications notification
     where notification.profile_id = v_other_parent
       and notification.payload ->> 'messageId' = v_reply::text
  ) then
    raise exception 'FAIL: unrelated family received another child message alert';
  end if;
  if not exists (
    select 1 from public.notification_outbox outbox
     where outbox.recipient_id = v_parent
       and outbox.kind = 'parent_messages'
       and outbox.channel = 'push'
       and outbox.payload ->> 'messageId' = v_reply::text
  ) then
    raise exception 'FAIL: center reply did not queue a family push alert';
  end if;
  if exists (
    select 1 from public.notification_outbox outbox
     where outbox.recipient_id = v_other_parent
       and outbox.payload ->> 'messageId' = v_reply::text
  ) then
    raise exception 'FAIL: unrelated family received another child message push';
  end if;
  raise notice 'PASS: family and center messages create private routed inbox and push alerts';

  insert into public.notification_preferences (
    profile_id, daycare_id, kind, in_app, push, email
  ) values (
    v_parent, v_daycare, 'parent_messages', true, false, false
  ) on conflict (profile_id, kind) do update set push = false;

  perform pg_temp.impersonate('authenticated', v_owner);
  insert into public.messages (
    id, daycare_id, conversation_id, child_id, sender_id, body
  ) values (
    v_muted_reply, v_daycare, v_conversation, v_child, v_owner, 'Muted push preference reply'
  );
  perform pg_temp.impersonate('postgres');
  if not exists (
    select 1 from public.notifications notification
     where notification.profile_id = v_parent
       and notification.payload ->> 'messageId' = v_muted_reply::text
  ) then
    raise exception 'FAIL: push preference incorrectly muted the in-app message';
  end if;
  if exists (
    select 1 from public.notification_outbox outbox
     where outbox.recipient_id = v_parent
       and outbox.payload ->> 'messageId' = v_muted_reply::text
  ) then
    raise exception 'FAIL: disabled message push preference was ignored';
  end if;
  raise notice 'PASS: message push preference mutes push without hiding the inbox alert';

  perform pg_temp.impersonate('authenticated', v_owner);
  perform public.mark_messages_read(v_child);
  if not exists (
    select 1 from public.messages
    where id = v_message and read_at is not null
  ) then
    raise exception 'FAIL: recipient read receipt was not persisted';
  end if;
  raise notice 'PASS: recipient reads persist for live sender updates';

  v_other_conversation := public.get_or_create_child_conversation(v_other_child);
  v_failed := false;
  begin
    insert into public.messages (
      daycare_id, conversation_id, child_id, sender_id, body
    ) values (
      v_daycare, v_other_conversation, v_child, v_owner, 'Mismatched thread'
    );
  exception when others then
    v_failed := position('does not match' in sqlerrm) > 0;
  end;
  if not v_failed then
    raise exception 'FAIL: message crossed child conversation boundaries';
  end if;
  raise notice 'PASS: database rejects child/conversation mismatches';

  v_failed := false;
  begin
    insert into public.conversations (daycare_id, child_id, kind)
    values (v_daycare, v_child, 'direct');
  exception when unique_violation then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: duplicate active direct conversation was created';
  end if;
  raise notice 'PASS: concurrent clients cannot create duplicate direct threads';

  v_failed := false;
  begin
    insert into public.conversations (daycare_id, child_id, kind)
    values (gen_random_uuid(), v_other_child, 'direct');
  exception when others then
    v_failed := position('center does not match' in sqlerrm) > 0
      or position('same center' in sqlerrm) > 0;
  end;
  if not v_failed then
    raise exception 'FAIL: conversation claimed a center different from its child';
  end if;
  raise notice 'PASS: direct conversation center is derived from the child boundary';

  perform pg_temp.impersonate('authenticated', v_other_parent);
  v_failed := false;
  begin
    perform public.get_or_create_child_conversation(v_child);
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: unrelated parent opened another family conversation';
  end if;
  raise notice 'PASS: unrelated families cannot open a child conversation';
end;
$$;

rollback;
select 'MOBILE PARENT GROUP 18 TESTS: ALL PASSED' as result;
