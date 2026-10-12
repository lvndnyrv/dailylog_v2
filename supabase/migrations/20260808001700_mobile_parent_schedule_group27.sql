-- =============================================================================
-- Parent mobile Group 27 — family-visible center closures and room moves.
--
-- Admin Groups 11c and 7e already persisted these records, but the family app
-- had no publication contract. This migration adds the family-facing snapshot,
-- notification lifecycle, scheduled closure reminders, and one RLS-safe hub.
-- =============================================================================

alter table public.daycares
  add column if not exists opens_at time not null default time '07:00',
  add column if not exists closes_at time not null default time '18:00';

alter table public.daycares
  drop constraint if exists daycares_operating_hours_check;
alter table public.daycares
  add constraint daycares_operating_hours_check check (opens_at < closes_at);

alter table public.center_closures
  add column if not exists family_message text,
  add column if not exists family_visible boolean not null default true,
  add column if not exists billing_treatment text not null default 'no_charge',
  add column if not exists reminder_days_before int not null default 3,
  add column if not exists published_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table public.center_closures
  drop constraint if exists center_closures_billing_treatment_check;
alter table public.center_closures
  add constraint center_closures_billing_treatment_check
  check (billing_treatment in ('no_charge', 'standard_tuition'));

alter table public.center_closures
  drop constraint if exists center_closures_reminder_days_check;
alter table public.center_closures
  add constraint center_closures_reminder_days_check
  check (reminder_days_before between 0 and 30);

drop trigger if exists center_closures_updated_at on public.center_closures;
create trigger center_closures_updated_at
  before update on public.center_closures
  for each row execute function public.update_updated_at();

alter table public.room_transition_plans
  add column if not exists transition_starts_on date,
  add column if not exists transition_ends_on date,
  add column if not exists current_tuition_cents int,
  add column if not exists new_tuition_cents int,
  add column if not exists currency text not null default 'CAD',
  add column if not exists family_message text,
  add column if not exists family_visible boolean not null default true,
  add column if not exists published_at timestamptz;

alter table public.room_transition_plans
  drop constraint if exists room_transition_plan_dates_check;
alter table public.room_transition_plans
  add constraint room_transition_plan_dates_check check (
    (transition_starts_on is null and transition_ends_on is null)
    or (
      transition_starts_on is not null
      and transition_ends_on is not null
      and transition_starts_on <= transition_ends_on
      and transition_ends_on < move_on
    )
  );

alter table public.room_transition_plans
  drop constraint if exists room_transition_plan_tuition_check;
alter table public.room_transition_plans
  add constraint room_transition_plan_tuition_check check (
    (current_tuition_cents is null or current_tuition_cents >= 0)
    and (new_tuition_cents is null or new_tuition_cents >= 0)
  );

alter table public.room_transition_plans
  drop constraint if exists room_transition_plan_currency_check;
alter table public.room_transition_plans
  add constraint room_transition_plan_currency_check
  check (currency ~ '^[A-Z]{3}$');

drop policy if exists "parents read linked room transition plans"
  on public.room_transition_plans;
create policy "parents read linked room transition plans"
  on public.room_transition_plans for select
  using (
    family_visible
    and child_id in (select public.my_child_ids())
  );

alter table public.notification_preferences
  drop constraint if exists notification_preferences_kind_check;
alter table public.notification_preferences
  add constraint notification_preferences_kind_check check (kind in (
    'ratio_alert',
    'incident_report',
    'cert_expiry',
    'overdue_billing',
    'new_device_sign_in',
    'waitlist_enrollment',
    'parent_attendance',
    'parent_moments',
    'parent_routines',
    'parent_messages',
    'parent_announcements',
    'parent_billing',
    'parent_schedule'
  ));

-- This helper is intentionally private. It persists an in-app notification for
-- every linked guardian, while the push outbox respects the family's schedule
-- notification preference. Scheduled reminders are push-only until due.
create or replace function public.queue_parent_schedule_notice(
  p_daycare_id uuid,
  p_child_id uuid,
  p_title text,
  p_body text,
  p_payload jsonb,
  p_dedupe_key text,
  p_available_at timestamptz default now(),
  p_in_app boolean default true
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
begin
  if auth.uid() is null then return 0; end if;
  if not public.is_staff() or p_daycare_id <> public.get_my_daycare_id() then
    raise exception 'Not allowed to publish this family schedule notice';
  end if;
  if nullif(btrim(p_title), '') is null
     or length(p_title) > 200
     or length(coalesce(p_body, '')) > 4000
     or jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' then
    raise exception 'Valid schedule notification content is required';
  end if;
  if p_child_id is not null and not exists (
    select 1 from public.children child
    where child.id = p_child_id and child.daycare_id = p_daycare_id
  ) then
    raise exception 'Child does not belong to this center';
  end if;

  with target_children as (
    select child.id
    from public.children child
    where child.daycare_id = p_daycare_id
      and child.archived_at is null
      and (p_child_id is null or child.id = p_child_id)
  ), recipients as (
    select link.parent_id as profile_id
    from target_children child
    join public.parent_children link on link.child_id = child.id
    union
    select member.profile_id
    from target_children child
    join public.family_children family_child on family_child.child_id = child.id
    join public.family_members member on member.family_id = family_child.family_id
    where member.receives_messages
  ), active_recipients as (
    select distinct recipient.profile_id
    from recipients recipient
    join public.profiles profile on profile.id = recipient.profile_id
    where profile.archived_at is null
  ), inbox as (
    insert into public.notifications (
      daycare_id, profile_id, kind, title, body, payload
    )
    select p_daycare_id, recipient.profile_id, 'parent_schedule',
           btrim(p_title), p_body, coalesce(p_payload, '{}'::jsonb)
    from active_recipients recipient
    where p_in_app
    returning profile_id
  ), queued as (
    insert into public.notification_outbox (
      daycare_id, recipient_id, channel, kind, title, body, payload,
      dedupe_key, available_at
    )
    select p_daycare_id, recipient.profile_id, 'push', 'parent_schedule',
           btrim(p_title), p_body, coalesce(p_payload, '{}'::jsonb),
           p_dedupe_key, greatest(coalesce(p_available_at, now()), now())
    from active_recipients recipient
    left join public.notification_preferences preference
      on preference.profile_id = recipient.profile_id
     and preference.kind = 'parent_schedule'
    where coalesce(preference.push, true)
    on conflict do nothing
    returning recipient_id
  )
  select count(*) into v_count from queued;

  return v_count;
end;
$$;

revoke all on function public.queue_parent_schedule_notice(
  uuid, uuid, text, text, jsonb, text, timestamptz, boolean
) from public, anon, authenticated;

create or replace function public.queue_center_closure_family_notice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.center_closures%rowtype;
  v_daycare public.daycares%rowtype;
  v_title text;
  v_body text;
  v_action text;
  v_reminder_at timestamptz;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  if auth.uid() is null then return coalesce(new, old); end if;

  select * into v_daycare from public.daycares where id = v_row.daycare_id;

  -- A changed/cancelled closure must never leave a stale reminder in flight.
  if tg_op in ('UPDATE', 'DELETE') then
    delete from public.notification_outbox
    where daycare_id = old.daycare_id
      and kind = 'parent_schedule'
      and status = 'pending'
      and dedupe_key like 'closure:' || old.id || ':reminder:%';
  end if;

  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and new.family_visible = false) then
    if old.family_visible and old.published_at is not null then
      perform public.queue_parent_schedule_notice(
        old.daycare_id,
        null,
        'Closure cancelled',
        old.reason || ' is no longer listed as a center closure.',
        jsonb_build_object(
          'type', 'closure_cancelled',
          'screen', 'ParentClosures',
          'closureId', old.id
        ),
        'closure:' || old.id || ':cancelled:' || txid_current(),
        now(),
        true
      );
    end if;
    return coalesce(new, old);
  end if;

  if not new.family_visible then return new; end if;
  if tg_op = 'UPDATE' and not (
    old.starts_on is distinct from new.starts_on
    or old.ends_on is distinct from new.ends_on
    or old.reason is distinct from new.reason
    or old.family_message is distinct from new.family_message
    or old.billing_treatment is distinct from new.billing_treatment
    or old.family_visible is distinct from new.family_visible
  ) then
    return new;
  end if;

  if new.published_at is null then
    update public.center_closures set published_at = now() where id = new.id;
    new.published_at := now();
  end if;

  v_action := case when tg_op = 'INSERT' or old.published_at is null
    then 'scheduled' else 'updated' end;
  v_title := case when v_action = 'scheduled'
    then v_daycare.name || ' closure scheduled'
    else v_daycare.name || ' closure updated' end;
  v_body := coalesce(
    nullif(btrim(new.family_message), ''),
    new.reason || ' · ' || to_char(new.starts_on, 'Mon FMDD')
      || case when new.ends_on <> new.starts_on
         then '–' || to_char(new.ends_on, 'Mon FMDD') else '' end
  );

  perform public.queue_parent_schedule_notice(
    new.daycare_id,
    null,
    v_title,
    v_body,
    jsonb_build_object(
      'type', 'center_closure',
      'screen', 'ParentClosureNotice',
      'closureId', new.id
    ),
    'closure:' || new.id || ':' || v_action || ':' || txid_current(),
    now(),
    true
  );

  v_reminder_at := (
    new.starts_on::timestamp + time '09:00'
  ) at time zone coalesce(v_daycare.timezone, 'America/Toronto')
    - make_interval(days => new.reminder_days_before);

  if new.reminder_days_before > 0 and v_reminder_at > now() + interval '1 hour' then
    perform public.queue_parent_schedule_notice(
      new.daycare_id,
      null,
      v_daycare.name || ' is closed soon',
      new.reason || ' · ' || to_char(new.starts_on, 'FMDay, Mon FMDD'),
      jsonb_build_object(
        'type', 'center_closure_reminder',
        'screen', 'ParentClosureNotice',
        'closureId', new.id
      ),
      'closure:' || new.id || ':reminder:' || new.starts_on,
      v_reminder_at,
      false
    );
  end if;

  return new;
end;
$$;

drop trigger if exists queue_center_closure_family_notice
  on public.center_closures;
create trigger queue_center_closure_family_notice
  after insert or update or delete on public.center_closures
  for each row execute function public.queue_center_closure_family_notice();

create or replace function public.queue_room_transition_family_notice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.room_transition_plans%rowtype;
  v_child public.children%rowtype;
  v_to_room text;
  v_title text;
  v_body text;
  v_cancelled boolean;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  if auth.uid() is null then return coalesce(new, old); end if;

  select * into v_child from public.children where id = v_row.child_id;
  select name into v_to_room from public.classrooms where id = v_row.to_classroom_id;

  v_cancelled := tg_op = 'DELETE'
    or (tg_op = 'UPDATE' and (new.status = 'cancelled' or not new.family_visible));

  if v_cancelled then
    if old.family_visible and old.published_at is not null then
      perform public.queue_parent_schedule_notice(
        old.daycare_id,
        old.child_id,
        v_child.first_name || '''s room move was cancelled',
        'The office cancelled the planned move to ' || coalesce(v_to_room, 'the new room') || '.',
        jsonb_build_object(
          'type', 'room_move_cancelled',
          'screen', 'ParentTabs',
          'childId', old.child_id,
          'transitionId', old.id
        ),
        'room-move:' || old.id || ':cancelled:' || txid_current(),
        now(),
        true
      );
    end if;
    return coalesce(new, old);
  end if;

  if new.status <> 'planned' or not new.family_visible then return new; end if;
  if tg_op = 'UPDATE' and not (
    old.to_classroom_id is distinct from new.to_classroom_id
    or old.move_on is distinct from new.move_on
    or old.transition_week is distinct from new.transition_week
    or old.transition_starts_on is distinct from new.transition_starts_on
    or old.transition_ends_on is distinct from new.transition_ends_on
    or old.current_tuition_cents is distinct from new.current_tuition_cents
    or old.new_tuition_cents is distinct from new.new_tuition_cents
    or old.family_message is distinct from new.family_message
    or old.family_visible is distinct from new.family_visible
    or old.status is distinct from new.status
  ) then
    return new;
  end if;

  if new.published_at is null then
    update public.room_transition_plans set published_at = now() where id = new.id;
    new.published_at := now();
  end if;

  v_title := case when tg_op = 'INSERT' or old.published_at is null
    then 'A room move is planned for ' || v_child.first_name
    else v_child.first_name || '''s room move was updated' end;
  v_body := coalesce(
    nullif(btrim(new.family_message), ''),
    v_child.first_name || ' will join ' || coalesce(v_to_room, 'the new room')
      || ' on ' || to_char(new.move_on, 'FMDay, Mon FMDD') || '.'
  );

  perform public.queue_parent_schedule_notice(
    new.daycare_id,
    new.child_id,
    v_title,
    v_body,
    jsonb_build_object(
      'type', 'room_move',
      'screen', 'ParentRoomMove',
      'childId', new.child_id,
      'transitionId', new.id
    ),
    'room-move:' || new.id || ':'
      || case when tg_op = 'INSERT' or old.published_at is null then 'planned' else 'updated' end
      || ':' || txid_current(),
    now(),
    true
  );

  return new;
end;
$$;

drop trigger if exists queue_room_transition_family_notice
  on public.room_transition_plans;
create trigger queue_room_transition_family_notice
  after insert or update or delete on public.room_transition_plans
  for each row execute function public.queue_room_transition_family_notice();

create or replace function public.get_parent_schedule_hub()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_daycare public.daycares%rowtype;
  v_today date;
  v_closures jsonb := '[]'::jsonb;
  v_moves jsonb := '[]'::jsonb;
begin
  select * into v_profile
  from public.profiles
  where id = auth.uid() and role = 'parent' and archived_at is null;

  if v_profile.id is null then
    raise exception 'A signed-in parent account is required';
  end if;

  select daycare.* into v_daycare
  from public.daycares daycare
  where daycare.id = coalesce(
    v_profile.daycare_id,
    (select child.daycare_id
       from public.parent_children link
       join public.children child on child.id = link.child_id
      where link.parent_id = auth.uid()
      limit 1)
  );

  if v_daycare.id is null then
    raise exception 'A linked childcare center is required';
  end if;

  v_today := (now() at time zone coalesce(v_daycare.timezone, 'America/Toronto'))::date;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', closure.id,
    'starts_on', closure.starts_on,
    'ends_on', closure.ends_on,
    'reason', closure.reason,
    'family_message', closure.family_message,
    'billing_treatment', closure.billing_treatment,
    'reminder_days_before', closure.reminder_days_before,
    'published_at', closure.published_at
  ) order by closure.starts_on, closure.ends_on, closure.reason), '[]'::jsonb)
  into v_closures
  from public.center_closures closure
  where closure.daycare_id = v_daycare.id
    and closure.family_visible
    and closure.ends_on >= v_today - 30;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', plan.id,
    'child_id', child.id,
    'child_first_name', child.first_name,
    'child_last_name', child.last_name,
    'from_room_id', from_room.id,
    'from_room_name', from_room.name,
    'to_room_id', to_room.id,
    'to_room_name', to_room.name,
    'move_on', plan.move_on,
    'transition_week', plan.transition_week,
    'transition_starts_on', case when plan.transition_week then coalesce(
      plan.transition_starts_on,
      date_trunc('week', plan.move_on::timestamp - interval '7 days')::date
    ) else null end,
    'transition_ends_on', case when plan.transition_week then coalesce(
      plan.transition_ends_on,
      date_trunc('week', plan.move_on::timestamp - interval '7 days')::date + 4
    ) else null end,
    'current_tuition_cents', plan.current_tuition_cents,
    'new_tuition_cents', plan.new_tuition_cents,
    'currency', plan.currency,
    'family_message', plan.family_message,
    'status', plan.status,
    'published_at', plan.published_at
  ) order by plan.move_on, child.first_name), '[]'::jsonb)
  into v_moves
  from public.room_transition_plans plan
  join public.children child on child.id = plan.child_id
  join public.classrooms from_room on from_room.id = plan.from_classroom_id
  join public.classrooms to_room on to_room.id = plan.to_classroom_id
  where plan.daycare_id = v_daycare.id
    and plan.family_visible
    and plan.status in ('planned', 'completed')
    and plan.move_on >= v_today - 30
    and plan.child_id in (select public.my_child_ids());

  return jsonb_build_object(
    'today', v_today,
    'daycare', jsonb_build_object(
      'id', v_daycare.id,
      'name', v_daycare.name,
      'timezone', v_daycare.timezone,
      'opens_at', to_char(v_daycare.opens_at, 'HH24:MI'),
      'closes_at', to_char(v_daycare.closes_at, 'HH24:MI')
    ),
    'closures', v_closures,
    'room_moves', v_moves
  );
end;
$$;

revoke all on function public.get_parent_schedule_hub() from public, anon;
grant execute on function public.get_parent_schedule_hub() to authenticated;

-- Keep Parent Group 22 settings in sync with the new family schedule channel.
create or replace function public.get_parent_notification_settings()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_preferences jsonb;
  v_delivery public.notification_delivery_settings%rowtype;
begin
  select * into v_profile
  from public.profiles
  where id = auth.uid() and role = 'parent' and archived_at is null;

  if v_profile.id is null or v_profile.daycare_id is null then
    raise exception 'A linked parent account is required';
  end if;

  insert into public.notification_preferences (
    profile_id, daycare_id, kind, in_app, push, email
  )
  select v_profile.id, v_profile.daycare_id, seed.kind, true, seed.enabled, false
  from (values
    ('parent_attendance', true),
    ('parent_moments', true),
    ('parent_routines', false),
    ('parent_messages', true),
    ('incident_report', true),
    ('parent_announcements', true),
    ('parent_billing', true),
    ('parent_schedule', true)
  ) as seed(kind, enabled)
  on conflict (profile_id, kind) do nothing;

  insert into public.notification_delivery_settings (
    profile_id, daycare_id, quiet_hours_enabled,
    quiet_hours_start, quiet_hours_end, email_mode
  ) values (
    v_profile.id, v_profile.daycare_id, true,
    time '20:00', time '07:00', 'off'
  )
  on conflict (profile_id) do nothing;

  update public.notification_preferences
  set in_app = true, push = true
  where profile_id = v_profile.id and kind = 'incident_report';

  select coalesce(jsonb_object_agg(preference.kind, preference.push), '{}'::jsonb)
  into v_preferences
  from public.notification_preferences preference
  where preference.profile_id = v_profile.id
    and preference.kind in (
      'parent_attendance', 'parent_moments', 'parent_routines',
      'parent_messages', 'incident_report', 'parent_announcements',
      'parent_billing', 'parent_schedule'
    );

  select * into v_delivery
  from public.notification_delivery_settings
  where profile_id = v_profile.id;

  return jsonb_build_object(
    'preferences', v_preferences,
    'quiet_hours_enabled', v_delivery.quiet_hours_enabled,
    'quiet_hours_start', to_char(v_delivery.quiet_hours_start, 'HH24:MI'),
    'quiet_hours_end', to_char(v_delivery.quiet_hours_end, 'HH24:MI')
  );
end;
$$;

create or replace function public.set_parent_notification_preference(
  p_kind text,
  p_enabled boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_daycare uuid;
  v_enabled boolean;
begin
  select daycare_id into v_daycare
  from public.profiles
  where id = auth.uid() and role = 'parent' and archived_at is null;

  if v_daycare is null then
    raise exception 'A linked parent account is required';
  end if;
  if p_kind not in (
    'parent_attendance', 'parent_moments', 'parent_routines',
    'parent_messages', 'incident_report', 'parent_announcements',
    'parent_billing', 'parent_schedule'
  ) then
    raise exception 'Unsupported parent notification preference';
  end if;

  v_enabled := case when p_kind = 'incident_report' then true else p_enabled end;
  insert into public.notification_preferences (
    profile_id, daycare_id, kind, in_app, push, email
  ) values (auth.uid(), v_daycare, p_kind, true, v_enabled, false)
  on conflict (profile_id, kind) do update
    set push = excluded.push, in_app = true, updated_at = now();

  return v_enabled;
end;
$$;

grant execute on function public.get_parent_notification_settings() to authenticated;
grant execute on function public.set_parent_notification_preference(text, boolean)
  to authenticated;
