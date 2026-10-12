-- ============================================================================
-- Mobile Group 20 — event RSVP visibility and child activity consents
-- ============================================================================
-- Group 20 closes two previously silent loops:
--   * family event responses are visible and actionable for assigned staff;
--   * parent-controlled activity permissions are visible to staff and enforced
--     for the photo workflow that already exists in the product.

alter table public.announcements
  add column if not exists event_ends_at timestamptz,
  add column if not exists event_location text;

alter table public.announcements
  drop constraint if exists announcements_event_window_check;

alter table public.announcements
  add constraint announcements_event_window_check
  check (
    (not rsvp_enabled)
    or (
      event_at is not null
      and (event_ends_at is null or event_ends_at > event_at)
      and length(coalesce(event_location, '')) <= 240
    )
  );

create index if not exists announcements_upcoming_events_idx
  on public.announcements (daycare_id, event_at)
  where rsvp_enabled and event_at is not null;

-- A consent is active only when the newest record for the kind is explicitly
-- granted and has not been revoked. Missing consent is intentionally false.
create or replace function public.child_has_active_consent(
  p_child_id uuid,
  p_kind text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select consent.granted and consent.revoked_at is null
      from public.consents consent
     where consent.child_id = p_child_id
       and consent.kind = p_kind
     order by consent.updated_at desc, consent.created_at desc
     limit 1
  ), false)
$$;

-- This is a safety boundary rather than a presentation rule. Even an outdated
-- client cannot attach new photo metadata after consent has been withdrawn.
create or replace function public.enforce_daily_log_photo_consent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_child_id uuid;
begin
  if auth.role() = 'service_role' or auth.uid() is null then
    return new;
  end if;

  select log.child_id into v_child_id
    from public.daily_logs log
   where log.id = new.daily_log_id;

  if v_child_id is null then
    raise exception 'Daily log not found';
  end if;
  if not public.child_has_active_consent(v_child_id, 'Photo & media consent') then
    raise exception 'Photo consent is missing or declined for this child'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_daily_log_photo_consent on public.photos;
create trigger enforce_daily_log_photo_consent
  before insert or update of daily_log_id on public.photos
  for each row execute function public.enforce_daily_log_photo_consent();

create or replace function public.get_mobile_children_photo_consent(
  p_child_ids uuid[]
)
returns table (
  child_id uuid,
  allowed boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if coalesce(cardinality(p_child_ids), 0) > 100 then
    raise exception 'Too many children requested';
  end if;

  return query
    select child.id, public.child_has_active_consent(child.id, 'Photo & media consent')
      from public.children child
     where child.id = any(coalesce(p_child_ids, array[]::uuid[]))
       and child.archived_at is null
       and public.can_access_child(child.id);
end;
$$;

create or replace function public.get_mobile_child_consents(
  p_child_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_child public.children%rowtype;
  v_rows jsonb;
begin
  if auth.uid() is null or not public.can_access_child(p_child_id) then
    raise exception 'Child not found or unavailable';
  end if;

  select * into v_child
    from public.children child
   where child.id = p_child_id and child.archived_at is null;
  if v_child.id is null then raise exception 'Child not found or unavailable'; end if;

  with kinds(kind, label, detail, sort) as (
    values
      ('Photo & media consent'::text, 'Photos in daily log'::text,
       'Educators may take and share photos in the private daily log.'::text, 1),
      ('Sunscreen application', 'Sunscreen application',
       'Educators may apply the family-provided or center-approved sunscreen.'::text, 2),
      ('Field-trip permission', 'Local walking trips',
       'The child may join supervised walks away from the center property.'::text, 3),
      ('Water / splash play', 'Water / splash play',
       'The child may join supervised sprinkler, splash-table and water play.'::text, 4)
  )
  select jsonb_agg(
    jsonb_build_object(
      'kind', kinds.kind,
      'label', kinds.label,
      'detail', kinds.detail,
      'status', case
        when latest.id is null then 'not_set'
        when latest.granted and latest.revoked_at is null then 'allowed'
        else 'declined'
      end,
      'granted', coalesce(latest.granted and latest.revoked_at is null, false),
      'updatedAt', latest.updated_at,
      'updatedBy', parent.full_name
    ) order by kinds.sort
  ) into v_rows
    from kinds
    left join lateral (
      select consent.*
        from public.consents consent
       where consent.child_id = p_child_id and consent.kind = kinds.kind
       order by consent.updated_at desc, consent.created_at desc
       limit 1
    ) latest on true
    left join public.profiles parent on parent.id = latest.parent_id;

  return jsonb_build_object(
    'childId', v_child.id,
    'childName', btrim(v_child.first_name || ' ' || v_child.last_name),
    'classroomId', v_child.classroom_id,
    'items', coalesce(v_rows, '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_mobile_classroom_consents(
  p_classroom_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_classroom public.classrooms%rowtype;
  v_children jsonb;
begin
  if auth.uid() is null or not public.is_staff()
     or not public.has_permission('children', 'view') then
    raise exception 'Children view permission is required';
  end if;

  select * into v_classroom
    from public.classrooms classroom
   where classroom.id = p_classroom_id
     and classroom.daycare_id = public.get_my_daycare_id()
     and classroom.archived_at is null;
  if v_classroom.id is null then raise exception 'Classroom not found'; end if;
  if public.get_my_role() = 'educator'
     and p_classroom_id not in (select public.my_classroom_ids()) then
    raise exception 'This classroom is not assigned to you';
  end if;

  with kinds(kind, short_key) as (
    values
      ('Photo & media consent'::text, 'photos'::text),
      ('Field-trip permission', 'trips'),
      ('Water / splash play', 'water'),
      ('Sunscreen application', 'sunscreen')
  ), child_rows as (
    select child.id, btrim(child.first_name || ' ' || child.last_name) as child_name,
           child.first_name,
           child.photo_url,
           jsonb_object_agg(kinds.short_key, jsonb_build_object(
             'kind', kinds.kind,
             'status', case
               when latest.id is null then 'not_set'
               when latest.granted and latest.revoked_at is null then 'allowed'
               else 'declined'
             end,
             'allowed', coalesce(latest.granted and latest.revoked_at is null, false),
             'updatedAt', latest.updated_at
           )) as permissions
      from public.children child
      cross join kinds
      left join lateral (
        select consent.*
          from public.consents consent
         where consent.child_id = child.id and consent.kind = kinds.kind
         order by consent.updated_at desc, consent.created_at desc
         limit 1
      ) latest on true
     where child.classroom_id = p_classroom_id and child.archived_at is null
     group by child.id, child.first_name, child.last_name, child.photo_url
  )
  select jsonb_agg(jsonb_build_object(
    'childId', child_rows.id,
    'childName', child_rows.child_name,
    'firstName', child_rows.first_name,
    'photoUrl', child_rows.photo_url,
    'permissions', child_rows.permissions
  ) order by child_rows.child_name) into v_children
    from child_rows;

  return jsonb_build_object(
    'classroomId', v_classroom.id,
    'classroomName', v_classroom.name,
    'children', coalesce(v_children, '[]'::jsonb)
  );
end;
$$;

create or replace function public.set_mobile_parent_consent(
  p_child_id uuid,
  p_kind text,
  p_granted boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_daycare_id uuid;
begin
  if auth.uid() is null or public.get_my_role() <> 'parent'
     or p_child_id not in (select public.my_child_ids()) then
    raise exception 'A linked parent account is required';
  end if;
  if p_kind not in (
    'Photo & media consent', 'Sunscreen application',
    'Field-trip permission', 'Water / splash play'
  ) then
    raise exception 'Unsupported consent type';
  end if;
  perform public.assert_rate_limit('parent_activity_consent', 40, 600, p_child_id::text);

  select child.daycare_id into v_daycare_id
    from public.children child
   where child.id = p_child_id and child.archived_at is null;
  if v_daycare_id is null then raise exception 'Child not found'; end if;

  insert into public.consents (
    daycare_id, child_id, parent_id, kind, version,
    granted, granted_at, revoked_at, updated_at
  ) values (
    v_daycare_id, p_child_id, auth.uid(), p_kind, '1',
    p_granted,
    case when p_granted then now() else null end,
    case when p_granted then null else now() end,
    now()
  )
  on conflict (child_id, kind, version) do update
    set parent_id = auth.uid(),
        granted = excluded.granted,
        granted_at = excluded.granted_at,
        revoked_at = excluded.revoked_at,
        updated_at = now();

  return jsonb_build_object(
    'childId', p_child_id,
    'kind', p_kind,
    'status', case when p_granted then 'allowed' else 'declined' end,
    'granted', p_granted,
    'updatedAt', now()
  );
end;
$$;

create or replace function public.send_mobile_event_rsvp(
  p_announcement_id uuid,
  p_response text,
  p_guests int default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_announcement public.announcements%rowtype;
  v_child_id uuid;
  v_guests int;
begin
  if auth.uid() is null or public.get_my_role() <> 'parent' then
    raise exception 'A parent account is required';
  end if;
  if p_response not in ('yes', 'maybe', 'no') then
    raise exception 'Choose Yes, Maybe or No';
  end if;

  select announcement.* into v_announcement
    from public.announcements announcement
   where announcement.id = p_announcement_id
     and announcement.daycare_id = public.get_my_daycare_id()
     and announcement.rsvp_enabled
     and announcement.event_at is not null
     and (
       announcement.classroom_id is null
       or announcement.classroom_id in (
         select child.classroom_id
           from public.children child
          where child.id in (select public.my_child_ids())
       )
     );
  if v_announcement.id is null then raise exception 'Event not found'; end if;
  if v_announcement.event_at <= now() then raise exception 'This event has already started'; end if;

  v_guests := case when p_response = 'no' then 0 else greatest(1, least(coalesce(p_guests, 1), 20)) end;
  select child.id into v_child_id
    from public.children child
   where child.id in (select public.my_child_ids())
     and child.archived_at is null
     and (v_announcement.classroom_id is null or child.classroom_id = v_announcement.classroom_id)
   order by child.first_name, child.last_name
   limit 1;
  if v_child_id is null then raise exception 'No eligible child is linked to this account'; end if;

  perform public.assert_rate_limit('event_rsvp', 30, 600, p_announcement_id::text);
  insert into public.announcement_rsvps (
    daycare_id, announcement_id, profile_id, child_id,
    response, guests, updated_at
  ) values (
    v_announcement.daycare_id, v_announcement.id, auth.uid(), v_child_id,
    p_response, v_guests, now()
  )
  on conflict (announcement_id, profile_id) do update
    set child_id = excluded.child_id,
        response = excluded.response,
        guests = excluded.guests,
        updated_at = now();

  return jsonb_build_object('response', p_response, 'guests', v_guests, 'updatedAt', now());
end;
$$;

create or replace function public.get_mobile_event_rsvp_summary(
  p_announcement_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_event public.announcements%rowtype;
  v_rows jsonb;
  v_going int;
  v_maybe int;
  v_no int;
  v_missing int;
begin
  if auth.uid() is null or not public.is_staff()
     or not public.has_permission('broadcasts', 'view') then
    raise exception 'Broadcast view permission is required';
  end if;

  select announcement.* into v_event
    from public.announcements announcement
   where announcement.id = p_announcement_id
     and announcement.daycare_id = public.get_my_daycare_id()
     and announcement.rsvp_enabled;
  if v_event.id is null then raise exception 'Event not found'; end if;
  if public.get_my_role() = 'educator' and v_event.classroom_id is not null
     and v_event.classroom_id not in (select public.my_classroom_ids()) then
    raise exception 'This event is not assigned to your classroom';
  end if;

  with eligible as (
    select distinct family.id, family.display_name
      from public.families family
      join public.family_children family_child on family_child.family_id = family.id
      join public.children child on child.id = family_child.child_id
     where family.daycare_id = v_event.daycare_id
       and family.status = 'active' and family.archived_at is null
       and child.archived_at is null
       and (v_event.classroom_id is null or child.classroom_id = v_event.classroom_id)
       and (
         public.get_my_role() <> 'educator'
         or child.classroom_id in (select public.my_classroom_ids())
       )
  ), details as (
    select eligible.id,
           eligible.display_name,
           coalesce(children.child_names, '') as child_names,
           response.response,
           coalesce(response.guests, 0) as guests,
           response.responder_name,
           response.updated_at
      from eligible
      left join lateral (
        select string_agg(btrim(child.first_name || ' ' || child.last_name), ', '
                          order by child.first_name, child.last_name) as child_names
          from public.family_children family_child
          join public.children child on child.id = family_child.child_id
         where family_child.family_id = eligible.id
           and child.archived_at is null
           and (v_event.classroom_id is null or child.classroom_id = v_event.classroom_id)
           and (
             public.get_my_role() <> 'educator'
             or child.classroom_id in (select public.my_classroom_ids())
           )
      ) children on true
      left join lateral (
        select rsvp.response, rsvp.guests, profile.full_name as responder_name, rsvp.updated_at
          from public.announcement_rsvps rsvp
          join public.family_members member on member.profile_id = rsvp.profile_id
          left join public.profiles profile on profile.id = rsvp.profile_id
         where member.family_id = eligible.id
           and rsvp.announcement_id = v_event.id
         order by rsvp.updated_at desc
         limit 1
      ) response on true
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'familyId', details.id,
      'familyName', details.display_name,
      'childNames', details.child_names,
      'response', coalesce(details.response, 'no_reply'),
      'guests', details.guests,
      'responderName', details.responder_name,
      'updatedAt', details.updated_at
    ) order by
      case coalesce(details.response, 'no_reply')
        when 'yes' then 1 when 'maybe' then 2 when 'no' then 3 else 4 end,
      details.display_name), '[]'::jsonb),
    count(*) filter (where details.response = 'yes')::int,
    count(*) filter (where details.response = 'maybe')::int,
    count(*) filter (where details.response = 'no')::int,
    count(*) filter (where details.response is null)::int
  into v_rows, v_going, v_maybe, v_no, v_missing
  from details;

  return jsonb_build_object(
    'event', jsonb_build_object(
      'id', v_event.id,
      'title', v_event.title,
      'body', v_event.body,
      'eventAt', v_event.event_at,
      'eventEndsAt', v_event.event_ends_at,
      'location', v_event.event_location,
      'classroomId', v_event.classroom_id
    ),
    'counts', jsonb_build_object(
      'going', coalesce(v_going, 0),
      'maybe', coalesce(v_maybe, 0),
      'no', coalesce(v_no, 0),
      'noReply', coalesce(v_missing, 0)
    ),
    'families', coalesce(v_rows, '[]'::jsonb)
  );
end;
$$;

create or replace function public.remind_mobile_event_nonresponders(
  p_announcement_id uuid
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.announcements%rowtype;
  v_count int := 0;
begin
  if auth.uid() is null or not public.is_staff()
     or not public.has_permission('broadcasts', 'edit') then
    raise exception 'Broadcast edit permission is required';
  end if;
  select announcement.* into v_event
    from public.announcements announcement
   where announcement.id = p_announcement_id
     and announcement.daycare_id = public.get_my_daycare_id()
     and announcement.rsvp_enabled and announcement.event_at > now();
  if v_event.id is null then raise exception 'Upcoming event not found'; end if;
  if public.get_my_role() = 'educator' and v_event.classroom_id is not null
     and v_event.classroom_id not in (select public.my_classroom_ids()) then
    raise exception 'This event is not assigned to your classroom';
  end if;

  perform public.assert_rate_limit('event_rsvp_reminder', 10, 3600, p_announcement_id::text);

  with eligible_families as (
    select distinct family.id
      from public.families family
      join public.family_children family_child on family_child.family_id = family.id
      join public.children child on child.id = family_child.child_id
     where family.daycare_id = v_event.daycare_id
       and family.status = 'active' and family.archived_at is null
       and child.archived_at is null
       and (v_event.classroom_id is null or child.classroom_id = v_event.classroom_id)
       and (
         public.get_my_role() <> 'educator'
         or child.classroom_id in (select public.my_classroom_ids())
       )
       and not exists (
         select 1
           from public.family_members responding_member
           join public.announcement_rsvps rsvp on rsvp.profile_id = responding_member.profile_id
          where responding_member.family_id = family.id
            and rsvp.announcement_id = v_event.id
       )
  ), recipients as (
    select distinct member.profile_id
      from eligible_families family
      join public.family_members member on member.family_id = family.id
      join public.profiles profile on profile.id = member.profile_id
     where member.receives_messages and profile.archived_at is null
  ), queued as (
    insert into public.notification_outbox (
      daycare_id, recipient_id, channel, kind, title, body, payload, dedupe_key
    )
    select v_event.daycare_id, recipient.profile_id, 'push', 'announcement',
           'RSVP reminder: ' || v_event.title,
           'Please let the center know whether your family can attend.',
           jsonb_build_object(
             'type', 'announcement', 'screen', 'EventDetail',
             'announcementId', v_event.id
           ),
           'event-rsvp-reminder:' || v_event.id || ':' || public.center_today()
      from recipients recipient
    on conflict do nothing
    returning recipient_id
  ), inbox as (
    insert into public.notifications (
      daycare_id, profile_id, kind, title, body, payload
    )
    select v_event.daycare_id, queued.recipient_id, 'announcement',
           'RSVP reminder: ' || v_event.title,
           'Please let the center know whether your family can attend.',
           jsonb_build_object(
             'type', 'announcement', 'screen', 'EventDetail',
             'announcementId', v_event.id
           )
      from queued
    returning id
  )
  select count(*) into v_count from queued;

  return v_count;
end;
$$;

revoke all on function public.child_has_active_consent(uuid, text) from public;
revoke all on function public.get_mobile_children_photo_consent(uuid[]) from public;
revoke all on function public.get_mobile_child_consents(uuid) from public;
revoke all on function public.get_mobile_classroom_consents(uuid) from public;
revoke all on function public.set_mobile_parent_consent(uuid, text, boolean) from public;
revoke all on function public.send_mobile_event_rsvp(uuid, text, int) from public;
revoke all on function public.get_mobile_event_rsvp_summary(uuid) from public;
revoke all on function public.remind_mobile_event_nonresponders(uuid) from public;

grant execute on function public.child_has_active_consent(uuid, text) to authenticated;
grant execute on function public.get_mobile_children_photo_consent(uuid[]) to authenticated;
grant execute on function public.get_mobile_child_consents(uuid) to authenticated;
grant execute on function public.get_mobile_classroom_consents(uuid) to authenticated;
grant execute on function public.set_mobile_parent_consent(uuid, text, boolean) to authenticated;
grant execute on function public.send_mobile_event_rsvp(uuid, text, int) to authenticated;
grant execute on function public.get_mobile_event_rsvp_summary(uuid) to authenticated;
grant execute on function public.remind_mobile_event_nonresponders(uuid) to authenticated;

grant select, insert, update on public.announcement_rsvps to authenticated;
