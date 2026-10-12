-- Cross-role messaging handoff: read state belongs to each recipient.
--
-- messages.read_at is retained as a backwards-compatible "read by someone"
-- timestamp for older clients and sender-side delivery copy. Inbox badges use
-- the per-profile receipts below so one educator or guardian cannot clear the
-- message for everybody else.

create table if not exists public.message_reads (
  message_id uuid not null references public.messages(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (message_id, profile_id)
);

create index if not exists message_reads_profile_idx
  on public.message_reads (profile_id, read_at desc);

alter table public.message_reads enable row level security;

drop policy if exists "members read relevant message receipts" on public.message_reads;
create policy "members read relevant message receipts"
  on public.message_reads for select
  using (
    profile_id = auth.uid()
    or exists (
      select 1
      from public.messages message
      where message.id = message_id
        and message.sender_id = auth.uid()
    )
  );

revoke all on table public.message_reads from public, anon;
grant select on table public.message_reads to authenticated;

-- Preserve the state users already saw before per-recipient receipts existed.
-- A legacy read_at meant the message appeared read to every eligible recipient,
-- so backfill every eligible recipient and individualize all future reads.
insert into public.message_reads (message_id, profile_id, read_at)
select distinct message.id, recipient.id, message.read_at
from public.messages message
join public.children child on child.id = message.child_id
join public.profiles recipient
  on recipient.daycare_id = message.daycare_id
 and recipient.archived_at is null
 and recipient.id <> message.sender_id
where message.read_at is not null
  and message.child_id is not null
  and (
    (
      recipient.role = 'parent'
      and exists (
        select 1
        from public.parent_children link
        where link.parent_id = recipient.id
          and link.child_id = message.child_id
      )
    )
    or (
      recipient.role in ('owner_admin', 'admin')
      and public.profile_has_permission(recipient.id, 'children', 'view')
    )
    or (
      recipient.role = 'educator'
      and public.profile_has_permission(recipient.id, 'children', 'view')
      and (
        recipient.classroom_id = child.classroom_id
        or exists (
          select 1
          from public.educator_classrooms assignment
          where assignment.educator_id = recipient.id
            and assignment.classroom_id = child.classroom_id
        )
      )
    )
  )
on conflict (message_id, profile_id) do nothing;

create or replace function public.mark_messages_read(p_child_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to read messages';
  end if;
  if not public.can_access_child(p_child_id) then
    raise exception 'No access to this child';
  end if;

  insert into public.message_reads (message_id, profile_id, read_at)
  select message.id, auth.uid(), now()
  from public.messages message
  where message.child_id = p_child_id
    and message.sender_id <> auth.uid()
  on conflict (message_id, profile_id) do update
    set read_at = excluded.read_at;

  -- Legacy aggregate receipt and sender-side "Read" indicator.
  update public.messages message
     set read_at = coalesce(message.read_at, now())
   where message.child_id = p_child_id
     and message.sender_id <> auth.uid()
     and message.read_at is null;
end;
$$;

revoke all on function public.mark_messages_read(uuid) from public, anon;
grant execute on function public.mark_messages_read(uuid) to authenticated;

create or replace function public.get_unread_child_message_counts(
  p_child_ids uuid[] default null
)
returns table (
  child_id uuid,
  unread_count bigint
)
language sql
security definer
stable
set search_path = public
as $$
  select message.child_id, count(*)::bigint
  from public.messages message
  where auth.uid() is not null
    and message.child_id is not null
    and message.sender_id <> auth.uid()
    and public.can_access_child(message.child_id)
    and (p_child_ids is null or message.child_id = any(p_child_ids))
    and not exists (
      select 1
      from public.message_reads receipt
      where receipt.message_id = message.id
        and receipt.profile_id = auth.uid()
    )
  group by message.child_id;
$$;

revoke all on function public.get_unread_child_message_counts(uuid[]) from public, anon;
grant execute on function public.get_unread_child_message_counts(uuid[]) to authenticated;

-- Keep the admin inbox response shape stable while making its unread count
-- profile-specific and enforcing the same child boundary as the mobile app.
create or replace function public.get_inbox_threads()
returns table (
  conversation_id uuid,
  family_id uuid,
  family_name text,
  family_child_count bigint,
  child_id uuid,
  child_first_name text,
  child_last_name text,
  room_name text,
  last_message_at timestamptz,
  last_message_body text,
  last_message_from_staff boolean,
  unread_count bigint
)
language sql
security definer
stable
set search_path = public
as $$
  select conversation.id,
         family.id,
         coalesce(family.display_name, child.last_name || ' family'),
         coalesce((
           select count(*)
           from public.family_children family_child
           where family_child.family_id = family.id
         ), 1),
         child.id,
         child.first_name,
         child.last_name,
         classroom.name,
         conversation.last_message_at,
         latest.body,
         coalesce(latest_profile.role in ('owner_admin', 'admin', 'educator'), false),
         (
           select count(*)
           from public.messages unread
           join public.profiles sender on sender.id = unread.sender_id
           where unread.conversation_id = conversation.id
             and sender.role = 'parent'
             and not exists (
               select 1
               from public.message_reads receipt
               where receipt.message_id = unread.id
                 and receipt.profile_id = auth.uid()
             )
         )
  from public.conversations conversation
  join public.children child
    on child.id = conversation.child_id
   and child.archived_at is null
  left join public.families family on family.id = conversation.family_id
  left join public.classrooms classroom on classroom.id = child.classroom_id
  left join lateral (
    select message.body, message.sender_id
    from public.messages message
    where message.conversation_id = conversation.id
    order by message.created_at desc
    limit 1
  ) latest on true
  left join public.profiles latest_profile on latest_profile.id = latest.sender_id
  where conversation.daycare_id = public.get_my_daycare_id()
    and conversation.kind = 'direct'
    and conversation.archived_at is null
    and public.is_staff()
    and public.can_access_child(child.id)
  order by conversation.last_message_at desc;
$$;

revoke all on function public.get_inbox_threads() from public, anon;
grant execute on function public.get_inbox_threads() to authenticated;

do $$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'message_reads'
  ) then
    alter publication supabase_realtime add table public.message_reads;
  end if;
end;
$$;

notify pgrst, 'reload schema';
