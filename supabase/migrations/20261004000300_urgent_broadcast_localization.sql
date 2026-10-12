-- Keep urgent priority in the localized parent feed and make accelerated
-- unread-email copy describe the actual 15-minute urgent policy.

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
      'priority', visible.priority,
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

create or replace function public.process_unread_announcement_email_nudges()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;

  with due_announcements as (
    select announcement.id, announcement.daycare_id, announcement.classroom_id,
           announcement.title, announcement.body, announcement.priority
      from public.announcements announcement
     where announcement.audience_type = 'families'
       and announcement.published_at is not null
       and announcement.published_at <= clock_timestamp()
       and announcement.cancelled_at is null
       and announcement.email_nudge_eligible_at is not null
       and announcement.email_nudge_eligible_at <= clock_timestamp()
  ), target_children as (
    select announcement.id as announcement_id, child.id as child_id
      from due_announcements announcement
      join public.children child
        on child.daycare_id = announcement.daycare_id
       and child.archived_at is null
       and (announcement.classroom_id is null or child.classroom_id = announcement.classroom_id)
  ), recipients as (
    select target.announcement_id, parent_link.parent_id as profile_id
      from target_children target
      join public.parent_children parent_link on parent_link.child_id = target.child_id
    union
    select target.announcement_id, member.profile_id
      from target_children target
      join public.family_children family_child on family_child.child_id = target.child_id
      join public.family_members member
        on member.family_id = family_child.family_id and member.receives_messages
  ), queued as (
    insert into public.notification_outbox (
      daycare_id, recipient_id, channel, kind, title, body, payload, dedupe_key
    )
    select announcement.daycare_id, recipient.profile_id, 'email',
           'announcement_unread_nudge',
           case when announcement.priority = 'urgent' then 'URGENT reminder: ' else 'Reminder: ' end
             || announcement.title,
           case when length(announcement.body) > 500
             then left(announcement.body, 497) || '...'
             else announcement.body
           end || E'\n\nOpen DailyLog to read the full center update.',
           jsonb_build_object(
             'type', 'announcement',
             'announcementId', announcement.id,
             'priority', announcement.priority,
             'screen', 'Announcements',
             'reason', case when announcement.priority = 'urgent'
               then 'urgent_unread_after_15_minutes'
               else 'unread_after_24_hours'
             end
           ),
           'announcement-unread-email:' || announcement.id
      from recipients recipient
      join due_announcements announcement on announcement.id = recipient.announcement_id
      join public.profiles profile
        on profile.id = recipient.profile_id
       and profile.archived_at is null
       and nullif(btrim(profile.email), '') is not null
     where not exists (
       select 1 from public.announcement_reads receipt
        where receipt.announcement_id = recipient.announcement_id
          and receipt.profile_id = recipient.profile_id
     )
    on conflict do nothing
    returning id
  )
  select count(*) into v_count from queued;

  return v_count;
end;
$$;

notify pgrst, 'reload schema';
