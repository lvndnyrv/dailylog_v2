-- Private admin/educator conversations. Family conversations remain child
-- scoped; staff threads are visible only to their explicit two participants.

alter table public.conversations
  drop constraint if exists conversations_kind_check;
alter table public.conversations
  add constraint conversations_kind_check
  check (kind in ('direct', 'broadcast', 'staff'));

create table if not exists public.conversation_participants (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  primary key (conversation_id, profile_id)
);

create index if not exists conversation_participants_profile_idx
  on public.conversation_participants (profile_id, conversation_id);

alter table public.conversation_participants enable row level security;

drop policy if exists "participants read staff conversation membership"
  on public.conversation_participants;
create policy "participants read staff conversation membership"
  on public.conversation_participants for select
  using (profile_id = auth.uid());

drop policy if exists "read conversations by family or child access"
  on public.conversations;
drop policy if exists "read conversations by child access"
  on public.conversations;
create policy "read conversations by participant or child access"
  on public.conversations for select
  using (
    (kind = 'direct' and child_id is not null and public.can_access_child(child_id))
    or (
      kind = 'staff'
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

drop policy if exists "participants create family conversations"
  on public.conversations;
drop policy if exists "participants create conversations"
  on public.conversations;
create policy "participants create child conversations"
  on public.conversations for insert
  with check (
    kind = 'direct'
    and child_id is not null
    and public.can_access_child(child_id)
  );

drop policy if exists "staff update conversations"
  on public.conversations;
create policy "staff update accessible conversations"
  on public.conversations for update
  using (
    daycare_id = public.get_my_daycare_id()
    and (
      (kind = 'direct' and public.is_staff())
      or (
        kind = 'staff'
        and exists (
          select 1
            from public.conversation_participants participant
           where participant.conversation_id = conversations.id
             and participant.profile_id = auth.uid()
        )
      )
    )
  );

create or replace function public.get_or_create_staff_conversation(
  p_other_profile_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me public.profiles%rowtype;
  v_other public.profiles%rowtype;
  v_conversation_id uuid;
  v_first text;
  v_second text;
begin
  if auth.uid() is null or p_other_profile_id is null or p_other_profile_id = auth.uid() then
    raise exception 'Choose another staff member';
  end if;

  select * into v_me
    from public.profiles profile
   where profile.id = auth.uid()
     and profile.role in ('owner_admin', 'admin', 'educator')
     and profile.daycare_id is not null
     and profile.archived_at is null;
  select * into v_other
    from public.profiles profile
   where profile.id = p_other_profile_id
     and profile.role in ('owner_admin', 'admin', 'educator')
     and profile.daycare_id = v_me.daycare_id
     and profile.archived_at is null;

  if v_me.id is null or v_other.id is null then
    raise exception 'Both participants must be active staff in the same center';
  end if;

  v_first := least(v_me.id::text, v_other.id::text);
  v_second := greatest(v_me.id::text, v_other.id::text);
  perform pg_advisory_xact_lock(hashtextextended(v_first || ':' || v_second, 0));

  select conversation.id
    into v_conversation_id
    from public.conversations conversation
   where conversation.kind = 'staff'
     and conversation.daycare_id = v_me.daycare_id
     and conversation.archived_at is null
     and exists (
       select 1 from public.conversation_participants participant
        where participant.conversation_id = conversation.id
          and participant.profile_id = v_me.id
     )
     and exists (
       select 1 from public.conversation_participants participant
        where participant.conversation_id = conversation.id
          and participant.profile_id = v_other.id
     )
     and (
       select count(*) from public.conversation_participants participant
        where participant.conversation_id = conversation.id
     ) = 2
   limit 1;

  if v_conversation_id is null then
    insert into public.conversations (
      daycare_id, kind, subject, last_message_at
    ) values (
      v_me.daycare_id,
      'staff',
      'Staff conversation',
      now()
    ) returning id into v_conversation_id;

    insert into public.conversation_participants (conversation_id, profile_id)
    values
      (v_conversation_id, v_me.id),
      (v_conversation_id, v_other.id);
  end if;

  return v_conversation_id;
end;
$$;

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
  join public.conversations conversation
    on conversation.id = mine.conversation_id
   and conversation.kind = 'staff'
   and conversation.archived_at is null
  join public.conversation_participants other
    on other.conversation_id = conversation.id
   and other.profile_id <> mine.profile_id
  join public.profiles other_profile on other_profile.id = other.profile_id
  left join lateral (
    select message.body
      from public.messages message
     where message.conversation_id = conversation.id
     order by message.created_at desc
     limit 1
  ) latest on true
  where mine.profile_id = auth.uid()
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
    join public.conversation_participants participant
      on participant.conversation_id = conversation.id
     and participant.profile_id = auth.uid()
   where conversation.id = p_conversation_id
     and conversation.kind = 'staff'
     and conversation.archived_at is null;

  if v_daycare_id is null then
    raise exception 'This staff conversation is not available';
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
   where profile.id = new.sender_id;
  select staff.id into v_sender_staff_member_id
    from public.staff_members staff
   where staff.profile_id = new.sender_id
     and staff.archived_at is null
   limit 1;
  select participant.profile_id into v_recipient
    from public.conversation_participants participant
   where participant.conversation_id = new.conversation_id
     and participant.profile_id <> new.sender_id
   limit 1;
  if v_recipient is null then
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

drop trigger if exists notify_staff_message_recipient on public.messages;
create trigger notify_staff_message_recipient
  after insert on public.messages
  for each row execute function public.notify_staff_message_recipient();

revoke all on function public.get_or_create_staff_conversation(uuid)
  from public, anon, authenticated;
revoke all on function public.list_my_staff_conversations()
  from public, anon, authenticated;
revoke all on function public.mark_staff_conversation_read(uuid)
  from public, anon, authenticated;
revoke all on function public.send_staff_message(uuid, text)
  from public, anon, authenticated;
grant execute on function public.get_or_create_staff_conversation(uuid) to authenticated;
grant execute on function public.list_my_staff_conversations() to authenticated;
grant execute on function public.mark_staff_conversation_read(uuid) to authenticated;
grant execute on function public.send_staff_message(uuid, text) to authenticated;

comment on table public.conversation_participants is
  'Explicit membership for private staff-to-staff conversations.';

do $$
begin
  alter publication supabase_realtime add table public.conversation_participants;
exception
  when duplicate_object then null;
end;
$$;

notify pgrst, 'reload schema';
