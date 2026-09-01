-- ============================================================================
-- DailyLog Mobile Parent Group 18 completion
-- One durable direct thread per child + message/thread integrity
-- ============================================================================

-- Old clients could race while creating a first conversation. Keep the oldest
-- active direct thread and move every message onto it before adding uniqueness.
with ranked as (
  select
    id,
    first_value(id) over (
      partition by child_id
      order by created_at nulls last, id
    ) as canonical_id
  from public.conversations
  where child_id is not null
    and kind = 'direct'
    and archived_at is null
)
update public.messages message
set conversation_id = ranked.canonical_id
from ranked
where message.conversation_id = ranked.id
  and ranked.id <> ranked.canonical_id;

with ranked as (
  select
    id,
    row_number() over (
      partition by child_id
      order by created_at nulls last, id
    ) as position
  from public.conversations
  where child_id is not null
    and kind = 'direct'
    and archived_at is null
)
delete from public.conversations conversation
using ranked
where conversation.id = ranked.id
  and ranked.position > 1;

update public.conversations conversation
set daycare_id = child.daycare_id
from public.children child
where conversation.child_id = child.id
  and conversation.daycare_id is distinct from child.daycare_id;

create unique index if not exists conversations_one_active_direct_child_idx
  on public.conversations (child_id)
  where child_id is not null
    and kind = 'direct'
    and archived_at is null;

-- Give legacy child-keyed messages a canonical conversation too.
insert into public.conversations (
  daycare_id,
  child_id,
  kind,
  last_message_at
)
select
  child.daycare_id,
  child.id,
  'direct',
  coalesce(max(message.created_at), now())
from public.messages message
join public.children child on child.id = message.child_id
where not exists (
  select 1
  from public.conversations existing
  where existing.child_id = child.id
    and existing.kind = 'direct'
    and existing.archived_at is null
)
group by child.daycare_id, child.id
on conflict (child_id) where (
  child_id is not null
  and kind = 'direct'
  and archived_at is null
) do nothing;

update public.messages message
set
  daycare_id = child.daycare_id,
  conversation_id = conversation.id
from public.children child
join public.conversations conversation
  on conversation.child_id = child.id
 and conversation.kind = 'direct'
 and conversation.archived_at is null
where message.child_id = child.id
  and (
    message.daycare_id is distinct from child.daycare_id
    or message.conversation_id is distinct from conversation.id
  );

create or replace function public.get_or_create_child_conversation(p_child_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation_id uuid;
  v_daycare_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in to open this conversation';
  end if;

  if not public.can_access_child(p_child_id) then
    raise exception 'You do not have access to this child';
  end if;

  select child.daycare_id
    into v_daycare_id
  from public.children child
  where child.id = p_child_id
    and child.archived_at is null;

  if v_daycare_id is null then
    raise exception 'This child is not available';
  end if;

  select conversation.id
    into v_conversation_id
  from public.conversations conversation
  where conversation.child_id = p_child_id
    and conversation.kind = 'direct'
    and conversation.archived_at is null
  limit 1;

  if v_conversation_id is null then
    insert into public.conversations (
      daycare_id,
      child_id,
      kind,
      last_message_at
    ) values (
      v_daycare_id,
      p_child_id,
      'direct',
      now()
    )
    on conflict (child_id) where (
      child_id is not null
      and kind = 'direct'
      and archived_at is null
    ) do update
      set daycare_id = excluded.daycare_id
    returning id into v_conversation_id;
  end if;

  return v_conversation_id;
end;
$$;

revoke all on function public.get_or_create_child_conversation(uuid) from public;
grant execute on function public.get_or_create_child_conversation(uuid) to authenticated;

create or replace function public.enforce_message_thread_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_child_daycare_id uuid;
  v_conversation public.conversations%rowtype;
begin
  if new.conversation_id is null then
    raise exception 'A conversation is required for every message';
  end if;

  select conversation.*
    into v_conversation
  from public.conversations conversation
  where conversation.id = new.conversation_id;

  if not found or v_conversation.archived_at is not null then
    raise exception 'This conversation is not available';
  end if;

  if new.child_id is null then
    if v_conversation.kind = 'direct' or v_conversation.child_id is not null then
      raise exception 'Direct messages require a child';
    end if;
    if new.daycare_id is distinct from v_conversation.daycare_id then
      raise exception 'Message center does not match its conversation';
    end if;
    return new;
  end if;

  select child.daycare_id
    into v_child_daycare_id
  from public.children child
  where child.id = new.child_id;

  if v_child_daycare_id is null then
    raise exception 'Message child does not exist';
  end if;

  if v_conversation.kind <> 'direct'
     or v_conversation.child_id is distinct from new.child_id then
    raise exception 'Message child does not match its conversation';
  end if;

  if new.daycare_id is distinct from v_child_daycare_id
     or v_conversation.daycare_id is distinct from v_child_daycare_id then
    raise exception 'Message center does not match its child';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_message_thread_integrity on public.messages;
create trigger enforce_message_thread_integrity
  before insert or update of daycare_id, conversation_id, child_id
  on public.messages
  for each row execute function public.enforce_message_thread_integrity();
