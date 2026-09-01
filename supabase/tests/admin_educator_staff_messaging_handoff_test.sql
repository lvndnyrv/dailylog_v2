-- Cross-app invariant: an admin and educator can privately message one another,
-- each receives a routable alert, and unrelated staff cannot see the thread.

begin;

create or replace function pg_temp.impersonate(p_role text, p_user_id uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('role', p_role, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id, 'role', p_role)::text,
    true
  );
end;
$$;

do $$
declare
  v_owner uuid := '00000000-0000-4000-a000-000000000001';
  v_educator uuid := '00000000-0000-4000-a000-000000000003';
  v_unrelated_staff uuid := '00000000-0000-4000-a000-000000000008';
  v_conversation uuid;
  v_same_conversation uuid;
  v_owner_staff_member uuid;
  v_educator_staff_member uuid;
  v_message uuid;
  v_reply uuid;
  v_count integer;
begin
  select id into v_owner_staff_member
    from public.staff_members where profile_id = v_owner and archived_at is null;
  select id into v_educator_staff_member
    from public.staff_members where profile_id = v_educator and archived_at is null;
  if v_owner_staff_member is null or v_educator_staff_member is null then
    raise exception 'FAIL: staff message fixtures are missing employment records';
  end if;

  perform pg_temp.impersonate('authenticated', v_owner);
  v_conversation := public.get_or_create_staff_conversation(v_educator);
  v_same_conversation := public.get_or_create_staff_conversation(v_educator);
  if v_conversation is null or v_same_conversation <> v_conversation then
    raise exception 'FAIL: staff conversation was not created idempotently';
  end if;

  -- The linked dev accounts may already have real test messages. Establish an
  -- unread baseline inside this rollback-only transaction, not in live state.
  perform public.mark_staff_conversation_read(v_conversation);
  perform pg_temp.impersonate('authenticated', v_educator);
  perform public.mark_staff_conversation_read(v_conversation);
  perform pg_temp.impersonate('authenticated', v_owner);

  select count(*) into v_count
    from public.conversation_participants participant
   where participant.conversation_id = v_conversation;
  if v_count <> 1 then
    raise exception 'FAIL: participant can read membership other than their own';
  end if;

  v_message := public.send_staff_message(
    v_conversation,
    'Please confirm your room coverage before opening.'
  );
  if v_message is null then
    raise exception 'FAIL: admin message was not created';
  end if;

  perform pg_temp.impersonate('authenticated', v_educator);
  if not exists (
    select 1
      from public.list_my_staff_conversations() thread
     where thread.conversation_id = v_conversation
       and thread.other_profile_id = v_owner
       and thread.unread_count = 1
  ) then
    raise exception 'FAIL: educator inbox did not receive the admin message';
  end if;
  if not exists (
    select 1
      from public.notifications notification
     where notification.profile_id = v_educator
       and notification.kind = 'staff_message'
       and notification.payload ->> 'conversationId' = v_conversation::text
       and notification.payload ->> 'otherProfileId' = v_owner::text
       and notification.payload ->> 'href' = '/staff/' || v_owner_staff_member::text || '/messages'
  ) then
    raise exception 'FAIL: educator did not receive a routable message alert';
  end if;

  if public.mark_staff_conversation_read(v_conversation) <> 1 then
    raise exception 'FAIL: educator could not mark the admin message read';
  end if;
  v_reply := public.send_staff_message(
    v_conversation,
    'Coverage confirmed. I will open Infant at 7:30.'
  );

  perform pg_temp.impersonate('authenticated', v_unrelated_staff);
  if exists (
    select 1 from public.conversations conversation
     where conversation.id = v_conversation
  ) or exists (
    select 1 from public.messages message
     where message.id in (v_message, v_reply)
  ) or exists (
    select 1 from public.list_my_staff_conversations() thread
     where thread.conversation_id = v_conversation
  ) then
    raise exception 'FAIL: unrelated staff can see a private staff conversation';
  end if;

  perform pg_temp.impersonate('authenticated', v_owner);
  if not exists (
    select 1
      from public.list_my_staff_conversations() thread
     where thread.conversation_id = v_conversation
       and thread.other_profile_id = v_educator
       and thread.unread_count = 1
  ) then
    raise exception 'FAIL: admin inbox did not receive the educator reply';
  end if;
  if not exists (
    select 1
      from public.notifications notification
     where notification.profile_id = v_owner
       and notification.kind = 'staff_message'
       and notification.payload ->> 'href' = '/staff/' || v_educator_staff_member::text || '/messages'
  ) then
    raise exception 'FAIL: admin did not receive a routable educator reply alert';
  end if;

  raise notice 'PASS: private admin/educator messaging, unread state, and routing are intact';
end;
$$;

rollback;

select 'ADMIN/EDUCATOR STAFF MESSAGING HANDOFF TESTS: ALL PASSED' as result;
