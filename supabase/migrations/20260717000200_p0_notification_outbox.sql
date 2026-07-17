-- ============================================================================
-- P0 — durable, server-side notification delivery
-- ============================================================================
-- Mobile and web clients enqueue authenticated domain events. A server worker
-- claims rows from this outbox and talks to Expo/email providers. Provider
-- credentials and retry state never live in a client bundle.

create table notification_outbox (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references daycares(id) on delete cascade,
  recipient_id uuid references profiles(id) on delete cascade,
  recipient_email text,
  channel text not null check (channel in ('push', 'email')),
  kind text not null,
  title text not null,
  body text,
  payload jsonb not null default '{}',
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'delivered', 'failed')),
  dedupe_key text not null,
  attempts int not null default 0 check (attempts >= 0),
  max_attempts int not null default 5 check (max_attempts between 1 and 20),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  delivered_at timestamptz,
  last_error text,
  provider_response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(payload) = 'object'),
  check (recipient_id is not null or nullif(btrim(recipient_email), '') is not null),
  check (channel <> 'push' or recipient_id is not null)
);

create index notification_outbox_pending_idx
  on notification_outbox (available_at, created_at)
  where status = 'pending';
create index notification_outbox_recipient_idx
  on notification_outbox (recipient_id, created_at desc);
create unique index notification_outbox_profile_dedupe_idx
  on notification_outbox (daycare_id, recipient_id, channel, dedupe_key)
  where recipient_id is not null;
create unique index notification_outbox_email_dedupe_idx
  on notification_outbox (daycare_id, lower(recipient_email), channel, dedupe_key)
  where recipient_id is null and recipient_email is not null;

create trigger notification_outbox_updated_at
  before update on notification_outbox
  for each row execute function update_updated_at();

alter table notification_outbox enable row level security;

create policy "recipients read own delivery history" on notification_outbox
  for select using (recipient_id = auth.uid());

create policy "admins read center delivery history" on notification_outbox
  for select using (is_admin() and daycare_id = get_my_daycare_id());

-- Enqueue a notification for every guardian linked to one child. The legacy
-- parent_children link and the household model are intentionally unioned while
-- old installations are being migrated.
create or replace function enqueue_child_notification(
  p_child_id uuid,
  p_kind text,
  p_title text,
  p_body text default null,
  p_payload jsonb default '{}',
  p_dedupe_key text default null,
  p_channels text[] default array['push']::text[]
)
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  v_daycare uuid;
  v_dedupe text := coalesce(nullif(btrim(p_dedupe_key), ''), gen_random_uuid()::text);
  v_count int;
begin
  if not can_write_child(p_child_id) then
    raise exception 'Not allowed to notify guardians for this child';
  end if;
  if nullif(btrim(p_kind), '') is null or nullif(btrim(p_title), '') is null then
    raise exception 'Notification kind and title are required';
  end if;
  if length(p_title) > 200 or length(coalesce(p_body, '')) > 4000 then
    raise exception 'Notification content is too long';
  end if;
  if jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' then
    raise exception 'Notification payload must be a JSON object';
  end if;
  if p_channels is null or cardinality(p_channels) = 0
     or not (p_channels <@ array['push', 'email']::text[]) then
    raise exception 'Unsupported notification channel';
  end if;

  select daycare_id into v_daycare from children where id = p_child_id;

  with recipients as (
    select pc.parent_id as profile_id
      from parent_children pc
     where pc.child_id = p_child_id
    union
    select fm.profile_id
      from family_children fc
      join family_members fm on fm.family_id = fc.family_id
     where fc.child_id = p_child_id and fm.receives_messages
  ), queued as (
    insert into notification_outbox (
      daycare_id, recipient_id, channel, kind, title, body, payload, dedupe_key
    )
    select v_daycare, r.profile_id, channel, btrim(p_kind), btrim(p_title), p_body,
           coalesce(p_payload, '{}'::jsonb), v_dedupe
      from recipients r
      cross join unnest(p_channels) as channel
      join profiles p on p.id = r.profile_id
     where p.archived_at is null
    on conflict do nothing
    returning recipient_id
  ), inbox as (
    insert into notifications (daycare_id, profile_id, kind, title, body, payload)
    select v_daycare, recipient_id, btrim(p_kind), btrim(p_title), p_body,
           coalesce(p_payload, '{}'::jsonb)
      from (select distinct recipient_id from queued) q
    returning id
  )
  select count(*) into v_count from queued;

  return v_count;
end;
$$;

-- Announcement fan-out. A classroom target limits recipients to guardians of
-- children in that room; a null classroom targets all center households.
create or replace function enqueue_center_notification(
  p_daycare_id uuid,
  p_classroom_id uuid,
  p_kind text,
  p_title text,
  p_body text default null,
  p_payload jsonb default '{}',
  p_dedupe_key text default null,
  p_channels text[] default array['push']::text[]
)
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  v_dedupe text := coalesce(nullif(btrim(p_dedupe_key), ''), gen_random_uuid()::text);
  v_count int;
begin
  if not is_staff() or p_daycare_id <> get_my_daycare_id() then
    raise exception 'Not allowed to notify this center';
  end if;
  if p_classroom_id is not null and not exists (
    select 1 from classrooms
     where id = p_classroom_id and daycare_id = p_daycare_id and archived_at is null
  ) then
    raise exception 'Classroom not found';
  end if;
  if nullif(btrim(p_kind), '') is null or nullif(btrim(p_title), '') is null then
    raise exception 'Notification kind and title are required';
  end if;
  if length(p_title) > 200 or length(coalesce(p_body, '')) > 4000 then
    raise exception 'Notification content is too long';
  end if;
  if jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' then
    raise exception 'Notification payload must be a JSON object';
  end if;
  if p_channels is null or cardinality(p_channels) = 0
     or not (p_channels <@ array['push', 'email']::text[]) then
    raise exception 'Unsupported notification channel';
  end if;

  with target_children as (
    select c.id
      from children c
     where c.daycare_id = p_daycare_id
       and c.archived_at is null
       and (p_classroom_id is null or c.classroom_id = p_classroom_id)
  ), recipients as (
    select pc.parent_id as profile_id
      from target_children tc
      join parent_children pc on pc.child_id = tc.id
    union
    select fm.profile_id
      from target_children tc
      join family_children fc on fc.child_id = tc.id
      join family_members fm on fm.family_id = fc.family_id and fm.receives_messages
  ), queued as (
    insert into notification_outbox (
      daycare_id, recipient_id, channel, kind, title, body, payload, dedupe_key
    )
    select p_daycare_id, r.profile_id, channel, btrim(p_kind), btrim(p_title), p_body,
           coalesce(p_payload, '{}'::jsonb), v_dedupe
      from recipients r
      cross join unnest(p_channels) as channel
      join profiles p on p.id = r.profile_id
     where p.archived_at is null
    on conflict do nothing
    returning recipient_id
  ), inbox as (
    insert into notifications (daycare_id, profile_id, kind, title, body, payload)
    select p_daycare_id, recipient_id, btrim(p_kind), btrim(p_title), p_body,
           coalesce(p_payload, '{}'::jsonb)
      from (select distinct recipient_id from queued) q
    returning id
  )
  select count(*) into v_count from queued;

  return v_count;
end;
$$;

-- Pre-account invitations and other transactional email can target a raw
-- address without manufacturing a profile row. The permission trigger in the
-- RBAC migration maps kind to the appropriate area.
create or replace function enqueue_email_notification(
  p_daycare_id uuid,
  p_recipient_email text,
  p_kind text,
  p_title text,
  p_body text default null,
  p_payload jsonb default '{}',
  p_dedupe_key text default null
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(p_recipient_email));
  v_id uuid;
begin
  if not is_staff() or p_daycare_id <> get_my_daycare_id() then
    raise exception 'Not allowed to send center email';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or length(v_email) > 320 then
    raise exception 'A valid recipient email is required';
  end if;
  if nullif(btrim(p_kind), '') is null or nullif(btrim(p_title), '') is null
     or length(p_title) > 200 or length(coalesce(p_body, '')) > 4000 then
    raise exception 'Valid notification content is required';
  end if;
  if jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' then
    raise exception 'Notification payload must be a JSON object';
  end if;

  insert into notification_outbox (
    daycare_id, recipient_email, channel, kind, title, body, payload, dedupe_key
  ) values (
    p_daycare_id, v_email, 'email', btrim(p_kind), btrim(p_title), p_body,
    coalesce(p_payload, '{}'::jsonb),
    coalesce(nullif(btrim(p_dedupe_key), ''), gen_random_uuid()::text)
  ) on conflict do nothing
  returning id into v_id;
  return v_id;
end;
$$;

-- Claims are short-lived leases. A crashed worker's rows become claimable
-- again after five minutes. SKIP LOCKED makes concurrent workers safe.
create or replace function claim_notification_batch(p_limit int default 50)
returns setof notification_outbox
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;

  update notification_outbox
     set status = 'pending', locked_at = null,
         available_at = greatest(available_at, now())
   where status = 'processing' and locked_at < now() - interval '5 minutes';

  return query
    with candidates as (
      select id
        from notification_outbox
       where status = 'pending' and available_at <= now()
       order by available_at, created_at
       for update skip locked
       limit least(greatest(coalesce(p_limit, 50), 1), 100)
    )
    update notification_outbox o
       set status = 'processing', locked_at = now(), attempts = attempts + 1
      from candidates c
     where o.id = c.id
    returning o.*;
end;
$$;

create or replace function complete_notification_delivery(
  p_id uuid,
  p_succeeded boolean,
  p_error text default null,
  p_provider_response jsonb default null,
  p_permanent boolean default false,
  p_retry_after_seconds int default 60
)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required';
  end if;

  update notification_outbox
     set status = case
           when p_succeeded then 'delivered'
           when p_permanent or attempts >= max_attempts then 'failed'
           else 'pending'
         end,
         delivered_at = case when p_succeeded then now() else null end,
         locked_at = null,
         last_error = case when p_succeeded then null else left(p_error, 2000) end,
         provider_response = p_provider_response,
         available_at = case
           when p_succeeded or p_permanent or attempts >= max_attempts then available_at
           else now() + make_interval(secs => least(greatest(p_retry_after_seconds, 10), 3600))
         end
   where id = p_id and status = 'processing';
end;
$$;

-- Broadcasts created from either web or mobile are queued atomically. Seed and
-- migration inserts have no JWT and are intentionally not delivered.
create or replace function queue_announcement_notification()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return new; end if;
  perform enqueue_center_notification(
    new.daycare_id,
    new.classroom_id,
    'announcement',
    '📢 ' || new.title,
    case when length(new.body) > 160 then left(new.body, 157) || '...' else new.body end,
    jsonb_build_object(
      'type', 'announcement',
      'announcementId', new.id,
      'channelId', 'default'
    ),
    'announcement:' || new.id,
    array['push']::text[]
  );
  return new;
end;
$$;

create trigger queue_announcement_after_insert after insert on announcements
  for each row execute function queue_announcement_notification();

revoke all on function claim_notification_batch(int) from public, anon, authenticated;
revoke all on function complete_notification_delivery(uuid, boolean, text, jsonb, boolean, int)
  from public, anon, authenticated;
grant execute on function claim_notification_batch(int) to service_role;
grant execute on function complete_notification_delivery(uuid, boolean, text, jsonb, boolean, int)
  to service_role;
grant execute on function enqueue_child_notification(uuid, text, text, text, jsonb, text, text[])
  to authenticated;
grant execute on function enqueue_center_notification(uuid, uuid, text, text, text, jsonb, text, text[])
  to authenticated;
grant execute on function enqueue_email_notification(uuid, text, text, text, text, jsonb, text)
  to authenticated;

-- These legacy client fan-out RPCs expose other users' device tokens. Current
-- clients enqueue events instead, so remove their API access immediately.
revoke all on function get_parent_push_tokens(uuid) from public, anon, authenticated;
revoke all on function get_announcement_push_tokens(uuid, uuid) from public, anon, authenticated;
