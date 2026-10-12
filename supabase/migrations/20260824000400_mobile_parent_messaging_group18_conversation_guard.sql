-- ============================================================================
-- DailyLog Mobile Parent Group 18 follow-up
-- Keep conversation ownership aligned with its child before messages exist.
-- ============================================================================

create or replace function public.enforce_conversation_child_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_child_daycare_id uuid;
begin
  if new.child_id is null then
    if new.kind = 'direct' then
      raise exception 'Direct conversations require a child';
    end if;
    return new;
  end if;

  select child.daycare_id
    into v_child_daycare_id
  from public.children child
  where child.id = new.child_id;

  if v_child_daycare_id is null then
    raise exception 'Conversation child does not exist';
  end if;

  if new.kind <> 'direct' then
    raise exception 'Child conversations must be direct';
  end if;

  if new.daycare_id is distinct from v_child_daycare_id then
    raise exception 'Conversation center does not match its child';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_conversation_child_integrity on public.conversations;
create trigger enforce_conversation_child_integrity
  before insert or update of daycare_id, child_id, kind
  on public.conversations
  for each row execute function public.enforce_conversation_child_integrity();
