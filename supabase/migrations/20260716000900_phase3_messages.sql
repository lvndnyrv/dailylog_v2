-- ============================================================================
-- DailyLog — Phase 3: messages inbox (5a) + broadcasts (5b/5c)
-- ============================================================================
-- Threads are child-keyed conversations (what the shipping mobile chat
-- writes). Broadcasts reuse the announcements table the parent app already
-- renders. See DECISIONS.md.

-- Keep the inbox sort truthful without an action-side update
create or replace function messages_bump_conversation()
returns trigger
language plpgsql
as $$
begin
  if new.conversation_id is not null then
    update conversations
       set last_message_at = coalesce(new.created_at, now())
     where id = new.conversation_id;
  end if;
  return new;
end;
$$;

drop trigger if exists messages_bump_conversation on messages;
create trigger messages_bump_conversation
  after insert on messages
  for each row execute function messages_bump_conversation();

-- One row per thread: child, room, last message preview, unread count
-- (parent-sent messages nobody has read). Definer keeps it one round trip.
create or replace function get_inbox_threads()
returns table (
  conversation_id uuid,
  child_id uuid,
  child_first_name text,
  child_last_name text,
  room_name text,
  last_message_at timestamptz,
  last_message_body text,
  last_message_from_staff boolean,
  unread_count bigint
)
language sql security definer stable
set search_path = public
as $$
  select conv.id, c.id, c.first_name, c.last_name, cl.name,
         conv.last_message_at,
         lm.body,
         coalesce(lp.role in ('owner_admin', 'admin', 'educator'), false),
         (select count(*) from messages m
           join profiles sp on sp.id = m.sender_id
          where m.conversation_id = conv.id
            and m.read_at is null
            and sp.role = 'parent')
  from conversations conv
  join children c on c.id = conv.child_id and c.archived_at is null
  left join classrooms cl on cl.id = c.classroom_id
  left join lateral (
    select m.body, m.sender_id from messages m
    where m.conversation_id = conv.id
    order by m.created_at desc limit 1
  ) lm on true
  left join profiles lp on lp.id = lm.sender_id
  where conv.daycare_id = get_my_daycare_id()
    and conv.archived_at is null
    and is_staff()
  order by conv.last_message_at desc
$$;
