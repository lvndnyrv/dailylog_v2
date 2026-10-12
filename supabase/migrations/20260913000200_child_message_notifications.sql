-- Child/family conversations were realtime while open but produced no durable
-- alert for recipients who were elsewhere in the app. Add a private in-app
-- handoff for both directions without exposing a child thread to unrelated or
-- permission-restricted staff.

create or replace function public.notify_child_conversation_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation public.conversations%rowtype;
  v_sender public.profiles%rowtype;
  v_child public.children%rowtype;
  v_child_name text;
  v_payload jsonb;
begin
  if new.conversation_id is null or new.child_id is null then return new; end if;

  select * into v_conversation
    from public.conversations conversation
   where conversation.id = new.conversation_id;
  if v_conversation.id is null or v_conversation.kind <> 'direct'
     or v_conversation.child_id is distinct from new.child_id then
    return new;
  end if;

  select * into v_sender from public.profiles profile where profile.id = new.sender_id;
  select * into v_child from public.children child where child.id = new.child_id;
  if v_sender.id is null or v_child.id is null then return new; end if;

  v_child_name := concat_ws(' ', v_child.first_name, v_child.last_name);
  v_payload := jsonb_build_object(
    'type', 'parent_messages',
    'screen', 'Messaging',
    'childId', new.child_id,
    'childName', v_child_name,
    'conversationId', new.conversation_id,
    'messageId', new.id,
    'href', '/messages?child=' || new.child_id,
    'source', 'Messages',
    'action_label', 'Open conversation'
  );

  if v_sender.role = 'parent' then
    insert into public.notifications (
      daycare_id, profile_id, kind, title, body, payload
    )
    select
      new.daycare_id,
      recipient.id,
      'parent_messages',
      'New family message',
      coalesce(nullif(v_sender.full_name, ''), 'A parent') ||
        ' sent a message about ' || v_child.first_name || '.',
      v_payload
    from public.profiles recipient
    where recipient.daycare_id = new.daycare_id
      and recipient.id <> new.sender_id
      and public.profile_has_permission(recipient.id, 'children', 'view')
      and (
        recipient.role in ('owner_admin', 'admin')
        or (
          recipient.role = 'educator'
          and (
            recipient.classroom_id = v_child.classroom_id
            or exists (
              select 1 from public.educator_classrooms assignment
               where assignment.educator_id = recipient.id
                 and assignment.classroom_id = v_child.classroom_id
            )
          )
        )
      )
      and not exists (
        select 1 from public.notifications notification
         where notification.profile_id = recipient.id
           and notification.payload ->> 'messageId' = new.id::text
      );
  else
    insert into public.notifications (
      daycare_id, profile_id, kind, title, body, payload
    )
    select
      new.daycare_id,
      recipient.id,
      'parent_messages',
      'New message from ' || coalesce(nullif(v_sender.full_name, ''), 'your center'),
      v_sender.full_name || ' replied about ' || v_child.first_name || '.',
      v_payload
    from public.parent_children link
    join public.profiles recipient on recipient.id = link.parent_id
    where link.child_id = new.child_id
      and recipient.role = 'parent'
      and recipient.archived_at is null
      and recipient.id <> new.sender_id
      and not exists (
        select 1 from public.notifications notification
         where notification.profile_id = recipient.id
           and notification.payload ->> 'messageId' = new.id::text
      );
  end if;

  return new;
end;
$$;

drop trigger if exists notify_child_conversation_message on public.messages;
create trigger notify_child_conversation_message
  after insert on public.messages
  for each row execute function public.notify_child_conversation_message();

revoke all on function public.notify_child_conversation_message()
  from public, anon, authenticated;

comment on function public.notify_child_conversation_message() is
  'Creates private, routed in-app alerts for new family/staff child-conversation messages.';

notify pgrst, 'reload schema';
