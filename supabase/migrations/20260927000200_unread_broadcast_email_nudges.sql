-- Admin Group 5c: remind unread family recipients once by email after 24 hours.
-- Existing broadcasts deliberately remain ineligible so deploying this change
-- cannot produce a burst of reminders for historical announcements.

alter table public.announcements
  add column if not exists email_nudge_eligible_at timestamptz;

create index if not exists announcements_email_nudge_due_idx
  on public.announcements (email_nudge_eligible_at)
  where email_nudge_eligible_at is not null and cancelled_at is null;

create or replace function public.set_announcement_email_nudge_schedule()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.audience_type <> 'families' or new.cancelled_at is not null then
    new.email_nudge_eligible_at := null;
  elsif new.published_at is not null
        and (tg_op = 'INSERT' or old.published_at is null) then
    new.email_nudge_eligible_at := new.published_at + interval '24 hours';
  end if;
  return new;
end;
$$;

drop trigger if exists set_announcement_email_nudge_schedule
  on public.announcements;
create trigger set_announcement_email_nudge_schedule
  before insert or update of published_at, audience_type, cancelled_at
  on public.announcements
  for each row execute function public.set_announcement_email_nudge_schedule();

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
           announcement.title, announcement.body
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
       and (
         announcement.classroom_id is null
         or child.classroom_id = announcement.classroom_id
       )
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
  ), queued as (
    insert into public.notification_outbox (
      daycare_id, recipient_id, channel, kind, title, body, payload, dedupe_key
    )
    select announcement.daycare_id, recipient.profile_id, 'email',
           'announcement_unread_nudge',
           'Reminder: ' || announcement.title,
           case
             when length(announcement.body) > 500
               then left(announcement.body, 497) || '...'
             else announcement.body
           end || E'\n\nOpen DailyLog to read the full center update.',
           jsonb_build_object(
             'type', 'announcement',
             'announcementId', announcement.id,
             'screen', 'Announcements',
             'reason', 'unread_after_24_hours'
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

revoke all on function public.process_unread_announcement_email_nudges()
  from public, anon, authenticated;
grant execute on function public.process_unread_announcement_email_nudges()
  to service_role;

do $$
declare
  v_job bigint;
begin
  select jobid into v_job
    from cron.job
   where jobname = 'dailylog-unread-broadcast-email-nudges';
  if v_job is not null then perform cron.unschedule(v_job); end if;

  perform cron.schedule(
    'dailylog-unread-broadcast-email-nudges',
    '20 * * * *',
    $cron$
      select set_config('request.jwt.claims', '{"role":"service_role"}', true);
      select public.process_unread_announcement_email_nudges();
    $cron$
  );
end;
$$;

drop function if exists public.list_broadcast_delivery_metrics(uuid[]);

create or replace function public.list_broadcast_delivery_metrics(p_announcement_ids uuid[])
returns table (
  announcement_id uuid,
  recipient_count bigint,
  read_count bigint,
  push_queued bigint,
  push_delivered bigint,
  email_nudged bigint
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
           ) as delivered,
           count(delivery.id) filter (
             where delivery.channel = 'email'
               and delivery.kind = 'announcement_unread_nudge'
           ) as nudged
      from requested
      left join public.notification_outbox delivery
        on delivery.daycare_id = v_daycare
       and (
         delivery.dedupe_key = 'announcement:' || requested.id
         or delivery.dedupe_key = 'announcement-unread-email:' || requested.id
       )
     group by requested.id
  )
  select requested.id,
         coalesce(recipient_totals.total, 0), coalesce(read_totals.total, 0),
         coalesce(delivery_totals.queued, 0), coalesce(delivery_totals.delivered, 0),
         coalesce(delivery_totals.nudged, 0)
    from requested
    left join recipient_totals on recipient_totals.announcement_id = requested.id
    left join read_totals on read_totals.announcement_id = requested.id
    left join delivery_totals on delivery_totals.announcement_id = requested.id;
end;
$$;

revoke all on function public.list_broadcast_delivery_metrics(uuid[])
  from public, anon;
grant execute on function public.list_broadcast_delivery_metrics(uuid[])
  to authenticated, service_role;

notify pgrst, 'reload schema';
