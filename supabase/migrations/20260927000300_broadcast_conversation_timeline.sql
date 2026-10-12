-- Admin Group 5: preserve family broadcasts inside each child conversation so
-- direct messages and center-wide communication share one durable timeline.

create table public.announcement_thread_deliveries (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  daycare_id uuid not null references public.daycares(id) on delete cascade,
  delivered_at timestamptz not null default now(),
  primary key (announcement_id, conversation_id)
);

create index announcement_thread_deliveries_conversation_idx
  on public.announcement_thread_deliveries (conversation_id, delivered_at);

alter table public.announcement_thread_deliveries enable row level security;

create policy "members read accessible announcement timeline entries"
  on public.announcement_thread_deliveries for select
  using (
    conversation_id in (
      select conversation.id
        from public.conversations conversation
       where conversation.child_id is not null
         and public.can_access_child(conversation.child_id)
    )
  );

create or replace function public.materialize_announcement_thread_deliveries()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.audience_type <> 'families'
     or new.published_at is null
     or new.published_at > now()
     or new.cancelled_at is not null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.published_at is not null then return new; end if;

  insert into public.conversations (
    daycare_id, child_id, kind, last_message_at
  )
  select new.daycare_id, child.id, 'direct', new.published_at
    from public.children child
   where child.daycare_id = new.daycare_id
     and child.archived_at is null
     and (new.classroom_id is null or child.classroom_id = new.classroom_id)
  on conflict (child_id) where (
    child_id is not null and kind = 'direct' and archived_at is null
  ) do update
    set last_message_at = greatest(
      coalesce(public.conversations.last_message_at, excluded.last_message_at),
      excluded.last_message_at
    );

  insert into public.announcement_thread_deliveries (
    announcement_id, conversation_id, daycare_id, delivered_at
  )
  select new.id, conversation.id, new.daycare_id, new.published_at
    from public.conversations conversation
    join public.children child on child.id = conversation.child_id
   where conversation.daycare_id = new.daycare_id
     and conversation.kind = 'direct'
     and conversation.archived_at is null
     and child.archived_at is null
     and (new.classroom_id is null or child.classroom_id = new.classroom_id)
  on conflict do nothing;

  return new;
end;
$$;

revoke all on function public.materialize_announcement_thread_deliveries()
  from public, anon, authenticated;

create trigger materialize_announcement_thread_deliveries
  after insert or update of published_at on public.announcements
  for each row execute function public.materialize_announcement_thread_deliveries();

create or replace function public.get_family_conversation_timeline(p_conversation_id uuid)
returns table (
  id uuid,
  item_type text,
  conversation_id uuid,
  child_id uuid,
  sender_id uuid,
  body text,
  title text,
  announcement_id uuid,
  pinned boolean,
  rsvp_enabled boolean,
  event_at timestamptz,
  attachment_kind text,
  attachment_path text,
  attachment_name text,
  attachment_mime text,
  read_at timestamptz,
  created_at timestamptz,
  sender jsonb
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_conversation public.conversations%rowtype;
begin
  select conversation.* into v_conversation
    from public.conversations conversation
   where conversation.id = p_conversation_id
     and conversation.kind = 'direct'
     and conversation.archived_at is null;

  if v_conversation.id is null
     or v_conversation.child_id is null
     or not public.can_access_child(v_conversation.child_id) then
    raise exception 'Conversation not found';
  end if;

  return query
  select message.id, 'message'::text, message.conversation_id, message.child_id,
         message.sender_id, message.body, null::text, null::uuid,
         false, false, null::timestamptz,
         message.attachment_kind, message.attachment_path,
         message.attachment_name, message.attachment_mime,
         message.read_at, message.created_at,
         case when profile.id is null then null::jsonb else jsonb_build_object(
           'id', profile.id,
           'full_name', profile.full_name,
           'role', profile.role
         ) end
    from public.messages message
    left join public.profiles profile on profile.id = message.sender_id
   where message.conversation_id = v_conversation.id
  union all
  select announcement.id, 'announcement'::text, delivery.conversation_id,
         v_conversation.child_id, announcement.author_id, announcement.body,
         announcement.title, announcement.id, coalesce(announcement.pinned, false),
         announcement.rsvp_enabled, announcement.event_at,
         null::text, null::text, null::text, null::text,
         null::timestamptz, delivery.delivered_at,
         case when author.id is null then null::jsonb else jsonb_build_object(
           'id', author.id,
           'full_name', author.full_name,
           'role', author.role
         ) end
    from public.announcement_thread_deliveries delivery
    join public.announcements announcement on announcement.id = delivery.announcement_id
    left join public.profiles author on author.id = announcement.author_id
   where delivery.conversation_id = v_conversation.id
     and announcement.published_at is not null
     and announcement.published_at <= now()
     and announcement.cancelled_at is null
  order by created_at;
end;
$$;

revoke all on function public.get_family_conversation_timeline(uuid)
  from public, anon;
grant execute on function public.get_family_conversation_timeline(uuid)
  to authenticated;

-- Keep the admin inbox preview and ordering aligned with the merged timeline.
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
           select count(*) from public.family_children family_child
            where family_child.family_id = family.id
         ), 1),
         child.id,
         child.first_name,
         child.last_name,
         classroom.name,
         greatest(conversation.last_message_at, latest.created_at),
         latest.body,
         coalesce(latest.from_staff, false),
         (
           select count(*)
             from public.messages unread
             join public.profiles sender on sender.id = unread.sender_id
            where unread.conversation_id = conversation.id
              and sender.role = 'parent'
              and not exists (
                select 1 from public.message_reads receipt
                 where receipt.message_id = unread.id
                   and receipt.profile_id = auth.uid()
              )
         )
    from public.conversations conversation
    join public.children child
      on child.id = conversation.child_id and child.archived_at is null
    left join public.families family on family.id = conversation.family_id
    left join public.classrooms classroom on classroom.id = child.classroom_id
    left join lateral (
      select item.body, item.created_at, item.from_staff
        from (
          select message.body, message.created_at,
                 coalesce(profile.role in ('owner_admin', 'admin', 'educator'), false) as from_staff
            from public.messages message
            left join public.profiles profile on profile.id = message.sender_id
           where message.conversation_id = conversation.id
          union all
          select '📢 ' || announcement.title, delivery.delivered_at, true
            from public.announcement_thread_deliveries delivery
            join public.announcements announcement on announcement.id = delivery.announcement_id
           where delivery.conversation_id = conversation.id
             and announcement.cancelled_at is null
        ) item
       order by item.created_at desc
       limit 1
    ) latest on true
   where conversation.daycare_id = public.get_my_daycare_id()
     and conversation.kind = 'direct'
     and conversation.archived_at is null
     and public.is_staff()
     and public.can_access_child(child.id)
   order by greatest(conversation.last_message_at, latest.created_at) desc;
$$;

revoke all on function public.get_inbox_threads() from public, anon;
grant execute on function public.get_inbox_threads() to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'announcement_thread_deliveries'
     ) then
    alter publication supabase_realtime add table public.announcement_thread_deliveries;
  end if;
end;
$$;

notify pgrst, 'reload schema';
