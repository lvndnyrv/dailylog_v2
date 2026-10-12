-- Admin Group 5c: expose which family languages each broadcast needs and
-- which localized copies are ready, without exposing family identities.

create or replace function public.list_broadcast_language_metrics(p_announcement_ids uuid[])
returns table (
  announcement_id uuid,
  requested_languages text[],
  ready_languages text[],
  missing_languages text[]
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_daycare uuid := public.get_my_daycare_id();
begin
  if v_daycare is null or not public.has_permission('broadcasts', 'view') then
    raise exception 'Broadcast view permission required';
  end if;
  if p_announcement_ids is null or cardinality(p_announcement_ids) = 0 then return; end if;
  if cardinality(p_announcement_ids) > 100 then raise exception 'Choose at most 100 broadcasts'; end if;

  return query
  with requested as (
    select announcement.id, announcement.classroom_id, announcement.audience_type
      from public.announcements announcement
     where announcement.id = any(p_announcement_ids)
       and announcement.daycare_id = v_daycare
  ), target_children as (
    select requested.id as announcement_id, child.id as child_id
      from requested
      join public.children child
        on requested.audience_type = 'families'
       and child.daycare_id = v_daycare
       and child.archived_at is null
       and (requested.classroom_id is null or child.classroom_id = requested.classroom_id)
  ), recipients as (
    select target.announcement_id, parent_link.parent_id as profile_id
      from target_children target
      join public.parent_children parent_link on parent_link.child_id = target.child_id
    union
    select target.announcement_id, member.profile_id
      from target_children target
      join public.family_children family_child on family_child.child_id = target.child_id
      join public.family_members member
        on member.family_id = family_child.family_id
       and member.receives_messages
  ), language_needs as (
    select recipient.announcement_id,
           array_agg(distinct coalesce(profile.preferred_language, 'en') order by coalesce(profile.preferred_language, 'en')) as languages
      from recipients recipient
      join public.profiles profile
        on profile.id = recipient.profile_id
       and profile.archived_at is null
     group by recipient.announcement_id
  ), language_ready as (
    select requested.id as announcement_id,
           coalesce(array_agg(distinct needed.language order by needed.language)
             filter (where needed.language is not null), array[]::text[]) as languages
      from requested
      left join language_needs need on need.announcement_id = requested.id
      left join lateral unnest(coalesce(need.languages, array[]::text[])) needed(language) on true
      left join public.announcement_translations translation
        on translation.announcement_id = requested.id
       and translation.language_code = needed.language
     where needed.language = 'en' or translation.announcement_id is not null
     group by requested.id
  )
  select requested.id,
         coalesce(need.languages, array[]::text[]),
         coalesce(ready.languages, array[]::text[]),
         coalesce(array(
           select unnest(coalesce(need.languages, array[]::text[]))
           except
           select unnest(coalesce(ready.languages, array[]::text[]))
         ), array[]::text[])
    from requested
    left join language_needs need on need.announcement_id = requested.id
    left join language_ready ready on ready.announcement_id = requested.id;
end;
$$;

revoke all on function public.list_broadcast_language_metrics(uuid[])
  from public, anon;
grant execute on function public.list_broadcast_language_metrics(uuid[])
  to authenticated, service_role;
