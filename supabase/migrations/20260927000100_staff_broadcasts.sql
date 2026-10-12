-- Admin Group 5b/5c: staff-only broadcasts share the announcement lifecycle,
-- while remaining invisible to families and reporting their own recipients.

alter table public.announcements
  add column if not exists audience_type text not null default 'families';

alter table public.announcements
  drop constraint if exists announcements_audience_type_check;
alter table public.announcements
  add constraint announcements_audience_type_check
  check (
    audience_type in ('families', 'staff')
    and (audience_type = 'families' or classroom_id is null)
    and (audience_type = 'families' or not rsvp_enabled)
  );

drop policy if exists "members read permitted announcements" on public.announcements;
create policy "members read permitted announcements"
  on public.announcements for select using (
    (
      public.is_staff()
      and public.has_permission('broadcasts', 'view')
      and daycare_id = public.get_my_daycare_id()
    )
    or (
      public.get_my_role() = 'parent'
      and audience_type = 'families'
      and published_at is not null
      and published_at <= now()
      and cancelled_at is null
      and daycare_id in (
        select child.daycare_id
          from public.children child
         where child.id in (select public.my_child_ids())
      )
      and (
        classroom_id is null
        or classroom_id in (
          select child.classroom_id
            from public.children child
           where child.id in (select public.my_child_ids())
        )
      )
    )
  );

create or replace function public.queue_announcement_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
  v_body text;
  v_payload jsonb;
begin
  if new.published_at is null or new.published_at > now() or new.cancelled_at is not null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.published_at is not null then return new; end if;
  if tg_op = 'INSERT' and auth.uid() is null and auth.role() is null then return new; end if;

  v_title := '📢 ' || new.title;
  v_body := case when length(new.body) > 160 then left(new.body, 157) || '...' else new.body end;
  v_payload := jsonb_build_object(
    'type', 'announcement',
    'announcementId', new.id,
    'audienceType', new.audience_type,
    'screen', 'Announcements',
    'channelId', 'default'
  );

  with recipients as (
    select profile.id as profile_id
      from public.profiles profile
     where new.audience_type = 'staff'
       and profile.daycare_id = new.daycare_id
       and profile.role in ('owner_admin', 'admin', 'educator')
       and profile.archived_at is null
       and profile.id <> new.author_id
    union
    select family_recipient.profile_id
      from (
        with target_children as (
          select child.id
            from public.children child
           where child.daycare_id = new.daycare_id
             and child.archived_at is null
             and (new.classroom_id is null or child.classroom_id = new.classroom_id)
        )
        select parent_link.parent_id as profile_id
          from target_children target
          join public.parent_children parent_link on parent_link.child_id = target.id
        union
        select member.profile_id
          from target_children target
          join public.family_children family_child on family_child.child_id = target.id
          join public.family_members member
            on member.family_id = family_child.family_id
           and member.receives_messages
      ) family_recipient
     where new.audience_type = 'families'
  ), queued as (
    insert into public.notification_outbox (
      daycare_id, recipient_id, channel, kind, title, body, payload, dedupe_key
    )
    select new.daycare_id, recipient.profile_id, 'push', 'announcement',
           v_title, v_body, v_payload, 'announcement:' || new.id
      from recipients recipient
      join public.profiles profile on profile.id = recipient.profile_id
     where profile.archived_at is null
    on conflict do nothing
    returning recipient_id
  )
  insert into public.notifications (daycare_id, profile_id, kind, title, body, payload)
  select new.daycare_id, queued.recipient_id, 'announcement', v_title, v_body, v_payload
    from queued;
  return new;
end;
$$;

create or replace function public.list_broadcast_delivery_metrics(p_announcement_ids uuid[])
returns table (
  announcement_id uuid,
  recipient_count bigint,
  read_count bigint,
  push_queued bigint,
  push_delivered bigint
)
language plpgsql stable security definer set search_path = public
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
    select announcement.id, announcement.classroom_id,
           announcement.audience_type, announcement.author_id
      from public.announcements announcement
     where announcement.id = any(p_announcement_ids)
       and announcement.daycare_id = v_daycare
  ), family_children as (
    select requested.id as announcement_id, child.id as child_id
      from requested
      join public.children child
        on requested.audience_type = 'families'
       and child.daycare_id = v_daycare
       and child.archived_at is null
       and (requested.classroom_id is null or child.classroom_id = requested.classroom_id)
  ), recipients as (
    select target.announcement_id, parent_link.parent_id as profile_id
      from family_children target
      join public.parent_children parent_link on parent_link.child_id = target.child_id
    union
    select target.announcement_id, member.profile_id
      from family_children target
      join public.family_children family_child on family_child.child_id = target.child_id
      join public.family_members member
        on member.family_id = family_child.family_id and member.receives_messages
    union
    select requested.id, profile.id
      from requested
      join public.profiles profile
        on requested.audience_type = 'staff'
       and profile.daycare_id = v_daycare
       and profile.role in ('owner_admin', 'admin', 'educator')
       and profile.archived_at is null
       and profile.id <> requested.author_id
  ), recipient_totals as (
    select recipient.announcement_id, count(distinct recipient.profile_id) as total
      from recipients recipient group by recipient.announcement_id
  ), read_totals as (
    select recipient.announcement_id, count(distinct receipt.profile_id) as total
      from recipients recipient
      join public.announcement_reads receipt
        on receipt.announcement_id = recipient.announcement_id
       and receipt.profile_id = recipient.profile_id
     group by recipient.announcement_id
  ), delivery_totals as (
    select requested.id as announcement_id,
           count(delivery.id) filter (where delivery.channel = 'push') as queued,
           count(delivery.id) filter (
             where delivery.channel = 'push' and delivery.status = 'delivered'
           ) as delivered
      from requested
      left join public.notification_outbox delivery
        on delivery.daycare_id = v_daycare
       and delivery.dedupe_key = 'announcement:' || requested.id
     group by requested.id
  )
  select requested.id,
         coalesce(recipient_totals.total, 0), coalesce(read_totals.total, 0),
         coalesce(delivery_totals.queued, 0), coalesce(delivery_totals.delivered, 0)
    from requested
    left join recipient_totals on recipient_totals.announcement_id = requested.id
    left join read_totals on read_totals.announcement_id = requested.id
    left join delivery_totals on delivery_totals.announcement_id = requested.id;
end;
$$;

notify pgrst, 'reload schema';
