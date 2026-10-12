-- Keep private staff conversations inside the active employment boundary.
-- Deactivated profiles retain their audit history, but can no longer read,
-- mark, or send staff messages with an existing auth session.

drop policy if exists "participants read staff conversation membership"
  on public.conversation_participants;
create policy "participants read active staff conversation membership"
  on public.conversation_participants for select
  using (
    profile_id = auth.uid()
    and public.get_my_daycare_id() is not null
  );

drop policy if exists "read conversations by participant or child access"
  on public.conversations;
create policy "read conversations by participant or child access"
  on public.conversations for select
  using (
    (kind = 'direct' and child_id is not null and public.can_access_child(child_id))
    or (
      kind = 'staff'
      and archived_at is null
      and daycare_id = public.get_my_daycare_id()
      and exists (
        select 1
          from public.conversation_participants participant
         where participant.conversation_id = conversations.id
           and participant.profile_id = auth.uid()
      )
    )
    or (
      kind = 'broadcast'
      and public.is_staff()
      and daycare_id = public.get_my_daycare_id()
    )
  );

create or replace function public.list_my_staff_conversations()
returns table (
  conversation_id uuid,
  other_profile_id uuid,
  other_full_name text,
  other_role text,
  last_message_body text,
  last_message_at timestamptz,
  unread_count bigint
)
language sql
security definer
stable
set search_path = public
as $$
  select
    conversation.id,
    other.profile_id,
    other_profile.full_name,
    other_profile.role,
    latest.body,
    conversation.last_message_at,
    (
      select count(*)
        from public.messages unread
       where unread.conversation_id = conversation.id
         and unread.sender_id <> auth.uid()
         and unread.read_at is null
    )
  from public.conversation_participants mine
  join public.profiles mine_profile
    on mine_profile.id = mine.profile_id
   and mine_profile.id = auth.uid()
   and mine_profile.role in ('owner_admin', 'admin', 'educator')
   and mine_profile.daycare_id is not null
   and mine_profile.archived_at is null
  join public.conversations conversation
    on conversation.id = mine.conversation_id
   and conversation.kind = 'staff'
   and conversation.daycare_id = mine_profile.daycare_id
   and conversation.archived_at is null
  join public.conversation_participants other
    on other.conversation_id = conversation.id
   and other.profile_id <> mine.profile_id
  join public.profiles other_profile
    on other_profile.id = other.profile_id
   and other_profile.daycare_id = mine_profile.daycare_id
   and other_profile.role in ('owner_admin', 'admin', 'educator')
   and other_profile.archived_at is null
  left join lateral (
    select message.body
      from public.messages message
     where message.conversation_id = conversation.id
     order by message.created_at desc
     limit 1
  ) latest on true
  order by conversation.last_message_at desc nulls last
$$;

create or replace function public.mark_staff_conversation_read(
  p_conversation_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not exists (
    select 1
      from public.conversation_participants participant
      join public.conversations conversation
        on conversation.id = participant.conversation_id
       and conversation.kind = 'staff'
       and conversation.archived_at is null
      join public.profiles profile
        on profile.id = participant.profile_id
       and profile.daycare_id = conversation.daycare_id
       and profile.role in ('owner_admin', 'admin', 'educator')
       and profile.archived_at is null
     where participant.conversation_id = p_conversation_id
       and participant.profile_id = auth.uid()
  ) then
    raise exception 'This staff conversation is not available';
  end if;

  update public.messages message
     set read_at = now()
   where message.conversation_id = p_conversation_id
     and message.sender_id <> auth.uid()
     and message.read_at is null;
  get diagnostics v_count = row_count;

  update public.conversation_participants participant
     set last_read_at = now()
   where participant.conversation_id = p_conversation_id
     and participant.profile_id = auth.uid();

  return v_count;
end;
$$;

create or replace function public.send_staff_message(
  p_conversation_id uuid,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_daycare_id uuid;
  v_message_id uuid;
begin
  if nullif(trim(p_body), '') is null then
    raise exception 'Message cannot be empty';
  end if;
  if length(trim(p_body)) > 4000 then
    raise exception 'Message is too long';
  end if;

  select conversation.daycare_id
    into v_daycare_id
    from public.conversations conversation
    join public.conversation_participants mine
      on mine.conversation_id = conversation.id
     and mine.profile_id = auth.uid()
    join public.profiles mine_profile
      on mine_profile.id = mine.profile_id
     and mine_profile.daycare_id = conversation.daycare_id
     and mine_profile.role in ('owner_admin', 'admin', 'educator')
     and mine_profile.archived_at is null
   where conversation.id = p_conversation_id
     and conversation.kind = 'staff'
     and conversation.archived_at is null
     and exists (
       select 1
         from public.conversation_participants other
         join public.profiles other_profile
           on other_profile.id = other.profile_id
          and other_profile.daycare_id = conversation.daycare_id
          and other_profile.role in ('owner_admin', 'admin', 'educator')
          and other_profile.archived_at is null
        where other.conversation_id = conversation.id
          and other.profile_id <> auth.uid()
     );

  if v_daycare_id is null then
    raise exception 'This staff conversation is no longer available';
  end if;

  insert into public.messages (
    daycare_id, conversation_id, child_id, sender_id, body
  ) values (
    v_daycare_id, p_conversation_id, null, auth.uid(), trim(p_body)
  ) returning id into v_message_id;

  return v_message_id;
end;
$$;

create or replace function public.notify_staff_message_recipient()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text;
  v_sender_name text;
  v_sender_staff_member_id uuid;
  v_recipient uuid;
  v_payload jsonb;
begin
  select conversation.kind into v_kind
    from public.conversations conversation
   where conversation.id = new.conversation_id;
  if v_kind <> 'staff' then
    return new;
  end if;

  select profile.full_name into v_sender_name
    from public.profiles profile
   where profile.id = new.sender_id
     and profile.archived_at is null;
  select staff.id into v_sender_staff_member_id
    from public.staff_members staff
   where staff.profile_id = new.sender_id
     and staff.status = 'active'
     and staff.archived_at is null
   limit 1;
  select participant.profile_id into v_recipient
    from public.conversation_participants participant
    join public.profiles profile
      on profile.id = participant.profile_id
     and profile.daycare_id = new.daycare_id
     and profile.role in ('owner_admin', 'admin', 'educator')
     and profile.archived_at is null
   where participant.conversation_id = new.conversation_id
     and participant.profile_id <> new.sender_id
   limit 1;
  if v_recipient is null or v_sender_name is null then
    return new;
  end if;

  v_payload := jsonb_build_object(
    'type', 'staff_message',
    'screen', 'StaffConversation',
    'conversationId', new.conversation_id,
    'otherProfileId', new.sender_id,
    'otherStaffMemberId', v_sender_staff_member_id,
    'href', case
      when v_sender_staff_member_id is not null
        then '/staff/' || v_sender_staff_member_id::text || '/messages'
      else '/staff'
    end,
    'action_label', 'Open message'
  );

  insert into public.notifications (
    daycare_id, profile_id, kind, title, body, payload
  ) values (
    new.daycare_id,
    v_recipient,
    'staff_message',
    coalesce(nullif(v_sender_name, ''), 'A team member') || ' sent you a message',
    left(new.body, 180),
    v_payload
  );

  insert into public.notification_outbox (
    daycare_id, recipient_id, channel, kind, title, body, payload, dedupe_key
  ) values (
    new.daycare_id,
    v_recipient,
    'push',
    'staff_message',
    coalesce(nullif(v_sender_name, ''), 'A team member') || ' sent you a message',
    left(new.body, 180),
    v_payload,
    'staff-message:' || new.id::text
  ) on conflict do nothing;

  return new;
end;
$$;

revoke all on function public.list_my_staff_conversations()
  from public, anon, authenticated;
revoke all on function public.mark_staff_conversation_read(uuid)
  from public, anon, authenticated;
revoke all on function public.send_staff_message(uuid, text)
  from public, anon, authenticated;
grant execute on function public.list_my_staff_conversations() to authenticated;
grant execute on function public.mark_staff_conversation_read(uuid) to authenticated;
grant execute on function public.send_staff_message(uuid, text) to authenticated;

notify pgrst, 'reload schema';
