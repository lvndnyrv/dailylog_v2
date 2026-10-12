-- Admin Group 5c: scheduled broadcasts and trustworthy delivery/read metrics.

alter table public.announcements
  add column if not exists scheduled_for timestamptz,
  add column if not exists published_at timestamptz,
  add column if not exists cancelled_at timestamptz;

update public.announcements
   set published_at = coalesce(published_at, created_at, now())
 where published_at is null
   and scheduled_for is null
   and cancelled_at is null;

alter table public.announcements
  alter column published_at set default now();

alter table public.announcements
  drop constraint if exists announcements_delivery_state_check;
alter table public.announcements
  add constraint announcements_delivery_state_check check (
    not (published_at is not null and cancelled_at is not null)
    and (scheduled_for is null or published_at is null or published_at >= scheduled_for)
  );

create index if not exists announcements_due_publish_idx
  on public.announcements (scheduled_for)
  where published_at is null and cancelled_at is null and scheduled_for is not null;

-- Staff can manage future broadcasts, while family clients see only messages
-- that have actually reached their publish time.
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

drop policy if exists "staff read center announcement receipts" on public.announcement_reads;
create policy "staff read center announcement receipts"
  on public.announcement_reads for select using (
    public.is_staff()
    and public.has_permission('broadcasts', 'view')
    and exists (
      select 1
        from public.announcements announcement
       where announcement.id = announcement_reads.announcement_id
         and announcement.daycare_id = public.get_my_daycare_id()
    )
  );

-- Delivery fan-out is performed by this trusted trigger rather than by a
-- browser. It works for both an authenticated immediate send and the pg_cron
-- publication of a scheduled item. The dedupe key makes retries harmless.
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
  if tg_op = 'UPDATE' and old.published_at is not null then
    return new;
  end if;
  -- Migration/seed inserts have no request claims and must stay silent. Due
  -- publications arrive through UPDATE and are intentionally delivered.
  if tg_op = 'INSERT' and auth.uid() is null and auth.role() is null then
    return new;
  end if;

  v_title := '📢 ' || new.title;
  v_body := case
    when length(new.body) > 160 then left(new.body, 157) || '...'
    else new.body
  end;
  v_payload := jsonb_build_object(
    'type', 'announcement',
    'announcementId', new.id,
    'channelId', 'default'
  );

  with target_children as (
    select child.id
      from public.children child
     where child.daycare_id = new.daycare_id
       and child.archived_at is null
       and (new.classroom_id is null or child.classroom_id = new.classroom_id)
  ), recipients as (
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
  insert into public.notifications (
    daycare_id, profile_id, kind, title, body, payload
  )
  select new.daycare_id, queued.recipient_id, 'announcement',
         v_title, v_body, v_payload
    from queued;

  return new;
end;
$$;

drop trigger if exists queue_announcement_after_insert on public.announcements;
drop trigger if exists queue_announcement_after_publish on public.announcements;
create trigger queue_announcement_after_publish
  after insert or update of published_at on public.announcements
  for each row execute function public.queue_announcement_notification();

create or replace function public.process_due_announcements()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.announcements announcement
     set published_at = clock_timestamp(),
         updated_at = clock_timestamp()
   where announcement.published_at is null
     and announcement.cancelled_at is null
     and announcement.scheduled_for is not null
     and announcement.scheduled_for <= clock_timestamp();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.process_due_announcements()
  from public, anon, authenticated;
grant execute on function public.process_due_announcements() to service_role;

do $$
declare
  v_job bigint;
begin
  select jobid into v_job from cron.job where jobname = 'dailylog-scheduled-broadcasts';
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule(
    'dailylog-scheduled-broadcasts',
    '* * * * *',
    $cron$
      select set_config('request.jwt.claims', '{"role":"service_role"}', true);
      select public.process_due_announcements();
    $cron$
  );
end;
$$;

create or replace function public.list_broadcast_delivery_metrics(
  p_announcement_ids uuid[]
)
returns table (
  announcement_id uuid,
  recipient_count bigint,
  read_count bigint,
  push_queued bigint,
  push_delivered bigint
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
  if p_announcement_ids is null or cardinality(p_announcement_ids) = 0 then
    return;
  end if;
  if cardinality(p_announcement_ids) > 100 then
    raise exception 'Choose at most 100 broadcasts';
  end if;

  return query
  with requested as (
    select announcement.id, announcement.classroom_id
      from public.announcements announcement
     where announcement.id = any(p_announcement_ids)
       and announcement.daycare_id = v_daycare
  ), target_children as (
    select requested.id as announcement_id, child.id as child_id
      from requested
      join public.children child
        on child.daycare_id = v_daycare
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
  ), recipient_totals as (
    select recipient.announcement_id, count(distinct recipient.profile_id) as total
      from recipients recipient
     group by recipient.announcement_id
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
         coalesce(recipient_totals.total, 0),
         coalesce(read_totals.total, 0),
         coalesce(delivery_totals.queued, 0),
         coalesce(delivery_totals.delivered, 0)
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

-- The RSVP RPC is security-definer and therefore needs the same publication
-- boundary as the table policy.
create or replace function public.send_mobile_event_rsvp(
  p_announcement_id uuid,
  p_response text,
  p_guests int default 1,
  p_child_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_announcement public.announcements%rowtype;
  v_child public.children%rowtype;
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
     and announcement.published_at is not null
     and announcement.published_at <= now()
     and announcement.cancelled_at is null
     and announcement.rsvp_enabled
     and announcement.event_at is not null
     and exists (
       select 1
         from public.parent_children family_link
         join public.children child on child.id = family_link.child_id
        where family_link.parent_id = auth.uid()
          and child.archived_at is null
          and child.daycare_id = announcement.daycare_id
          and (
            announcement.classroom_id is null
            or child.classroom_id = announcement.classroom_id
          )
     );
  if v_announcement.id is null then
    raise exception 'Event not found or this family is not invited';
  end if;
  if v_announcement.event_at <= now() then
    raise exception 'This event has already started';
  end if;

  select child.* into v_child
    from public.parent_children family_link
    join public.children child on child.id = family_link.child_id
   where family_link.parent_id = auth.uid()
     and child.archived_at is null
     and child.daycare_id = v_announcement.daycare_id
     and (v_announcement.classroom_id is null or child.classroom_id = v_announcement.classroom_id)
     and (p_child_id is null or child.id = p_child_id)
   order by child.first_name, child.last_name
   limit 1;
  if v_child.id is null then
    raise exception 'The selected child is not invited to this event';
  end if;

  v_guests := case
    when p_response = 'no' then 0
    else greatest(1, least(coalesce(p_guests, 1), 20))
  end;
  perform public.assert_rate_limit('event_rsvp', 30, 600, p_announcement_id::text);
  insert into public.announcement_rsvps (
    daycare_id, announcement_id, profile_id, child_id,
    response, guests, updated_at
  ) values (
    v_announcement.daycare_id, v_announcement.id, auth.uid(), v_child.id,
    p_response, v_guests, now()
  )
  on conflict (announcement_id, profile_id) do update
    set child_id = excluded.child_id,
        response = excluded.response,
        guests = excluded.guests,
        updated_at = now();

  return jsonb_build_object(
    'response', p_response,
    'guests', v_guests,
    'childId', v_child.id,
    'childName', trim(concat_ws(' ', v_child.first_name, v_child.last_name)),
    'updatedAt', now()
  );
end;
$$;

