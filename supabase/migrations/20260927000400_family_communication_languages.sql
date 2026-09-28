-- Admin Group 5b/5c: store each family's communication language and deliver
-- the matching announcement copy everywhere the parent reads a broadcast.

alter table public.profiles
  add column if not exists preferred_language text not null default 'en';

alter table public.profiles
  drop constraint if exists profiles_preferred_language_check;
alter table public.profiles
  add constraint profiles_preferred_language_check check (
    preferred_language in ('en', 'fr', 'es', 'pt', 'ar', 'zh', 'pa', 'ur', 'tl')
  );

create table public.announcement_translations (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  language_code text not null check (
    language_code in ('fr', 'es', 'pt', 'ar', 'zh', 'pa', 'ur', 'tl')
  ),
  title text not null check (char_length(btrim(title)) between 1 and 180),
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  provider text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (announcement_id, language_code)
);

alter table public.announcement_translations enable row level security;

create policy "members read translations for visible announcements"
  on public.announcement_translations for select
  using (announcement_id in (select announcement.id from public.announcements announcement));

create policy "broadcast staff manage announcement translations"
  on public.announcement_translations for all
  using (
    public.is_staff()
    and public.has_permission('broadcasts', 'edit')
    and exists (
      select 1
        from public.announcements announcement
       where announcement.id = announcement_translations.announcement_id
         and announcement.daycare_id = public.get_my_daycare_id()
    )
  )
  with check (
    public.is_staff()
    and public.has_permission('broadcasts', 'edit')
    and exists (
      select 1
        from public.announcements announcement
       where announcement.id = announcement_translations.announcement_id
         and announcement.daycare_id = public.get_my_daycare_id()
    )
  );

create or replace function public.set_my_preferred_language(p_language text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_language text := lower(btrim(coalesce(p_language, '')));
begin
  if auth.uid() is null or public.get_my_role() <> 'parent' then
    raise exception 'A signed-in parent account is required';
  end if;
  if v_language not in ('en', 'fr', 'es', 'pt', 'ar', 'zh', 'pa', 'ur', 'tl') then
    raise exception 'Unsupported communication language';
  end if;

  update public.profiles
     set preferred_language = v_language,
         updated_at = now()
   where id = auth.uid()
     and role = 'parent'
     and archived_at is null;

  if not found then raise exception 'A signed-in parent account is required'; end if;
  return v_language;
end;
$$;

revoke all on function public.set_my_preferred_language(text) from public, anon;
grant execute on function public.set_my_preferred_language(text) to authenticated;

-- A single parent-facing read contract keeps the feed, chat preview, home card,
-- and event detail on the same localized copy. Missing translations fall back
-- to the center's original English without hiding the announcement.
create or replace function public.get_my_localized_announcements(
  p_limit integer default 50,
  p_announcement_id uuid default null
)
returns jsonb
language sql
security invoker
stable
set search_path = public
as $$
  with viewer as (
    select profile.preferred_language
      from public.profiles profile
     where profile.id = auth.uid()
       and profile.role = 'parent'
  ), visible as (
    select announcement.*,
           coalesce(translation.title, announcement.title) as localized_title,
           coalesce(translation.body, announcement.body) as localized_body,
           coalesce(translation.language_code, 'en') as delivered_language,
           translation.announcement_id is not null as is_translated,
           author.full_name as author_name,
           daycare.name as daycare_name,
           classroom.name as classroom_name
      from public.announcements announcement
      cross join viewer
      left join public.announcement_translations translation
        on translation.announcement_id = announcement.id
       and translation.language_code = viewer.preferred_language
       and viewer.preferred_language <> 'en'
      left join public.profiles author on author.id = announcement.author_id
      left join public.daycares daycare on daycare.id = announcement.daycare_id
      left join public.classrooms classroom on classroom.id = announcement.classroom_id
     where (p_announcement_id is null or announcement.id = p_announcement_id)
     order by announcement.pinned desc, announcement.created_at desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200)
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', visible.id,
      'daycare_id', visible.daycare_id,
      'classroom_id', visible.classroom_id,
      'author_id', visible.author_id,
      'audience_type', visible.audience_type,
      'title', visible.localized_title,
      'body', visible.localized_body,
      'source_title', visible.title,
      'source_body', visible.body,
      'language_code', visible.delivered_language,
      'is_translated', visible.is_translated,
      'pinned', visible.pinned,
      'rsvp_enabled', visible.rsvp_enabled,
      'event_at', visible.event_at,
      'event_ends_at', visible.event_ends_at,
      'event_location', visible.event_location,
      'published_at', visible.published_at,
      'created_at', visible.created_at,
      'updated_at', visible.updated_at,
      'author', case when visible.author_id is null then null else jsonb_build_object('full_name', visible.author_name) end,
      'daycare', jsonb_build_object('name', visible.daycare_name),
      'classroom', case when visible.classroom_id is null then null else jsonb_build_object('name', visible.classroom_name) end,
      'rsvps', coalesce((
        select jsonb_agg(jsonb_build_object(
          'profile_id', rsvp.profile_id,
          'response', rsvp.response,
          'guests', rsvp.guests,
          'child_id', rsvp.child_id,
          'updated_at', rsvp.updated_at
        ))
          from public.announcement_rsvps rsvp
         where rsvp.announcement_id = visible.id
      ), '[]'::jsonb)
    ) order by visible.pinned desc, visible.created_at desc
  ), '[]'::jsonb)
    from visible;
$$;

revoke all on function public.get_my_localized_announcements(integer, uuid)
  from public, anon;
grant execute on function public.get_my_localized_announcements(integer, uuid)
  to authenticated;

-- Extend the merged family thread without changing its public return shape.
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
  v_language text := 'en';
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

  select case when profile.role = 'parent' then profile.preferred_language else 'en' end
    into v_language
    from public.profiles profile
   where profile.id = auth.uid();
  v_language := coalesce(v_language, 'en');

  return query
  select message.id, 'message'::text, message.conversation_id, message.child_id,
         message.sender_id, message.body, null::text, null::uuid,
         false, false, null::timestamptz,
         message.attachment_kind, message.attachment_path,
         message.attachment_name, message.attachment_mime,
         message.read_at, message.created_at,
         case when profile.id is null then null::jsonb else jsonb_build_object(
           'id', profile.id, 'full_name', profile.full_name, 'role', profile.role
         ) end
    from public.messages message
    left join public.profiles profile on profile.id = message.sender_id
   where message.conversation_id = v_conversation.id
  union all
  select announcement.id, 'announcement'::text, delivery.conversation_id,
         v_conversation.child_id, announcement.author_id,
         coalesce(translation.body, announcement.body),
         coalesce(translation.title, announcement.title),
         announcement.id, coalesce(announcement.pinned, false),
         announcement.rsvp_enabled, announcement.event_at,
         null::text, null::text, null::text, null::text,
         null::timestamptz, delivery.delivered_at,
         case when author.id is null then null::jsonb else jsonb_build_object(
           'id', author.id, 'full_name', author.full_name, 'role', author.role
         ) end
    from public.announcement_thread_deliveries delivery
    join public.announcements announcement on announcement.id = delivery.announcement_id
    left join public.announcement_translations translation
      on translation.announcement_id = announcement.id
     and translation.language_code = v_language
     and v_language <> 'en'
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

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'announcement_translations'
     ) then
    alter publication supabase_realtime add table public.announcement_translations;
  end if;
end;
$$;
