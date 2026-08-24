-- =============================================================================
-- Parent mobile Group 26 — secure pre-account inquiry journey.
--
-- One opaque code follows a family from public inquiry through tour, waitlist,
-- check-ins and the eventual offer. The code grants access only to a deliberately
-- narrow JSON snapshot and trusted transition RPCs; enrollment tables remain
-- unavailable to anonymous clients.
-- =============================================================================

alter table public.enrollments
  add column if not exists waitlist_response_due_at timestamptz,
  add column if not exists waitlist_last_response_at timestamptz;

create index if not exists enrollments_waitlist_response_due_idx
  on public.enrollments (waitlist_response_due_at)
  where waitlist_status = 'active' and waitlist_response_due_at is not null;

-- Group 24 originally assigned the code only when an offer was sent. Assign it
-- at inquiry creation instead so every family link keeps the same identity.
create or replace function public.ensure_parent_offer_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.offer_code is null then
    new.offer_code := public.generate_parent_offer_code();
  end if;
  return new;
end;
$$;

update public.enrollments
set offer_code = public.generate_parent_offer_code()
where offer_code is null;

create or replace function public.get_parent_inquiry_center(p_daycare_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
begin
  perform public.assert_rate_limit(
    'parent_inquiry_center', 60, 900, coalesce(p_daycare_id::text, 'missing')
  );

  select jsonb_build_object(
    'id', daycare.id,
    'name', daycare.name,
    'address', daycare.address,
    'phone', daycare.phone,
    'timezone', daycare.timezone,
    'reply_hours', coalesce(settings.inquiry_reply_hours, 24),
    'programs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', room.id,
        'name', room.name,
        'age_group', room.age_group
      ) order by room.min_age_months nulls last, room.name)
      from public.classrooms room
      where room.daycare_id = daycare.id and room.archived_at is null
    ), '[]'::jsonb)
  ) into v_payload
  from public.daycares daycare
  left join public.enrollment_settings settings on settings.daycare_id = daycare.id
  where daycare.id = p_daycare_id and daycare.active;

  if v_payload is null then raise exception 'This inquiry link is invalid'; end if;
  return v_payload;
end;
$$;

create or replace function public.submit_parent_enrollment_inquiry(
  p_daycare_id uuid,
  p_guardian_name text,
  p_guardian_email text,
  p_guardian_phone text,
  p_child_first_name text,
  p_child_date_of_birth date,
  p_classroom_id uuid,
  p_desired_start date,
  p_days_per_week int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enrollment_id uuid;
  v_code text;
begin
  v_enrollment_id := public.submit_enrollment_inquiry_v2(
    p_daycare_id,
    p_guardian_name,
    p_guardian_email,
    p_guardian_phone,
    p_child_first_name,
    p_child_date_of_birth,
    p_classroom_id,
    p_desired_start,
    p_days_per_week
  );

  select enrollment.offer_code into v_code
  from public.enrollments enrollment
  where enrollment.id = v_enrollment_id;

  update public.notification_outbox
  set body = coalesce(body, '') || E'\n\nTrack the next steps securely in DailyLog: dailylog://inquiry?code=' || v_code,
      payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
        'type', 'parent_inquiry',
        'screen', 'ParentInquiryJourney',
        'journeyCode', v_code
      )
  where dedupe_key = 'public-inquiry:' || v_enrollment_id;

  return jsonb_build_object(
    'enrollment_id', v_enrollment_id,
    'journey_code', v_code
  );
end;
$$;

create or replace function public.get_parent_inquiry_journey(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enrollment public.enrollments%rowtype;
  v_payload jsonb;
  v_room_position int;
  v_room_total int;
begin
  if nullif(btrim(p_code), '') is null then raise exception 'A journey code is required'; end if;
  perform public.assert_rate_limit(
    'parent_inquiry_journey', 80, 900, left(upper(btrim(p_code)), 16)
  );

  select * into v_enrollment
  from public.enrollments enrollment
  where upper(enrollment.offer_code) = upper(btrim(p_code));

  if v_enrollment.id is null then raise exception 'This family link is invalid'; end if;

  if v_enrollment.classroom_id is not null
     and v_enrollment.waitlist_status in ('active', 'offer') then
    select
      count(*) filter (
        where coalesce(candidate.waitlist_position, 2147483647)
          <= coalesce(v_enrollment.waitlist_position, 2147483647)
      )::int,
      count(*)::int
    into v_room_position, v_room_total
    from public.enrollments candidate
    where candidate.daycare_id = v_enrollment.daycare_id
      and candidate.classroom_id = v_enrollment.classroom_id
      and candidate.waitlist_status in ('active', 'offer');
  end if;

  select jsonb_build_object(
    'id', v_enrollment.id,
    'journey_code', v_enrollment.offer_code,
    'stage', v_enrollment.stage,
    'child', jsonb_build_object(
      'first_name', v_enrollment.child_first_name,
      'last_name', v_enrollment.child_last_name,
      'date_of_birth', v_enrollment.child_date_of_birth,
      'desired_start_date', v_enrollment.desired_start_date,
      'days_per_week', coalesce((v_enrollment.schedule->>'days_per_week')::int, 5)
    ),
    'guardian', jsonb_build_object(
      'name', v_enrollment.guardian_name,
      'email', v_enrollment.guardian_email,
      'phone', v_enrollment.guardian_phone
    ),
    'daycare', jsonb_build_object(
      'id', daycare.id,
      'name', daycare.name,
      'address', daycare.address,
      'phone', daycare.phone,
      'timezone', daycare.timezone,
      'reply_hours', coalesce(settings.inquiry_reply_hours, 24)
    ),
    'program', case when room.id is null then null else jsonb_build_object(
      'id', room.id,
      'name', room.name,
      'age_group', room.age_group
    ) end,
    'tour', (
      select jsonb_build_object(
        'id', slot.id,
        'starts_at', slot.starts_at,
        'ends_at', slot.ends_at,
        'host_name', host.full_name,
        'host_title', host.job_title,
        'status', slot.status
      )
      from public.enrollment_tour_slots slot
      left join public.profiles host on host.id = slot.host_id
      where slot.enrollment_id = v_enrollment.id and slot.status = 'booked'
      order by slot.starts_at desc
      limit 1
    ),
    'open_tour_slots', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', slot.id,
        'starts_at', slot.starts_at,
        'ends_at', slot.ends_at,
        'host_name', host.full_name,
        'host_title', host.job_title
      ) order by slot.starts_at)
      from public.enrollment_tour_slots slot
      left join public.profiles host on host.id = slot.host_id
      where slot.daycare_id = v_enrollment.daycare_id
        and slot.status = 'open'
        and slot.starts_at > now()
        and (slot.classroom_id is null or slot.classroom_id = v_enrollment.classroom_id)
    ), '[]'::jsonb),
    'waitlist', jsonb_build_object(
      'status', v_enrollment.waitlist_status,
      'position', v_room_position,
      'total', coalesce(v_room_total, 0),
      'joined_at', v_enrollment.waitlist_joined_at,
      'priority', v_enrollment.waitlist_priority,
      'unanswered_checkins', v_enrollment.waitlist_unanswered_checkins,
      'response_due_at', v_enrollment.waitlist_response_due_at,
      'checkin_due', v_enrollment.waitlist_response_due_at is not null,
      'archive_after', coalesce(settings.auto_archive_checkins, 2)
    ),
    'offer', jsonb_build_object(
      'status', v_enrollment.offer_status,
      'available', v_enrollment.offer_status in ('sent', 'viewed')
    )
  ) into v_payload
  from public.daycares daycare
  left join public.classrooms room on room.id = v_enrollment.classroom_id
  left join public.enrollment_settings settings on settings.daycare_id = daycare.id
  where daycare.id = v_enrollment.daycare_id;

  return v_payload;
end;
$$;

create or replace function public.book_parent_enrollment_tour(
  p_code text,
  p_slot_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enrollment public.enrollments%rowtype;
  v_slot public.enrollment_tour_slots%rowtype;
  v_daycare public.daycares%rowtype;
  v_reminder_at timestamptz;
begin
  perform public.assert_rate_limit(
    'parent_inquiry_book_tour', 20, 900, left(upper(btrim(p_code)), 16)
  );

  select * into v_enrollment
  from public.enrollments enrollment
  where upper(enrollment.offer_code) = upper(btrim(p_code))
  for update;
  if v_enrollment.id is null then raise exception 'This family link is invalid'; end if;
  if v_enrollment.stage in ('enrolled', 'withdrawn')
     or v_enrollment.offer_status in ('sent', 'viewed', 'accepted') then
    raise exception 'Tour booking is no longer available for this application';
  end if;

  select * into v_slot
  from public.enrollment_tour_slots slot
  where slot.id = p_slot_id
  for update;
  if v_slot.id is null
     or v_slot.daycare_id <> v_enrollment.daycare_id
     or v_slot.starts_at <= now()
     or (v_slot.classroom_id is not null
       and v_enrollment.classroom_id is not null
       and v_slot.classroom_id <> v_enrollment.classroom_id)
     or (v_slot.status <> 'open'
       and not (v_slot.status = 'booked' and v_slot.enrollment_id = v_enrollment.id)) then
    raise exception 'That tour time is no longer available';
  end if;

  if v_slot.status = 'open' then
    update public.enrollment_tour_slots
    set status = 'booked', enrollment_id = v_enrollment.id
    where id = v_slot.id and status = 'open';
    if not found then raise exception 'That tour time was just booked'; end if;

    update public.enrollment_tour_slots
    set status = 'open', enrollment_id = null, host_id = null
    where enrollment_id = v_enrollment.id
      and status = 'booked'
      and id <> v_slot.id;
  end if;

  update public.enrollments
  set stage = case when stage = 'inquiry' then 'tour' else stage end,
      stage_changed_at = now(),
      tour_at = v_slot.starts_at,
      tour_host_id = v_slot.host_id,
      classroom_id = coalesce(v_slot.classroom_id, classroom_id),
      tour_outcome = null
  where id = v_enrollment.id;

  select * into v_daycare from public.daycares where id = v_enrollment.daycare_id;
  v_reminder_at := greatest(
    now(),
    (((v_slot.starts_at at time zone v_daycare.timezone)::date - 1) + time '18:00')
      at time zone v_daycare.timezone
  );

  delete from public.notification_outbox
  where daycare_id = v_enrollment.daycare_id
    and status = 'pending'
    and kind = 'tour_confirmation'
    and payload->>'enrollment_id' = v_enrollment.id::text;

  insert into public.notification_outbox (
    daycare_id, recipient_email, channel, kind, title, body, payload,
    dedupe_key, available_at
  ) values
  (
    v_enrollment.daycare_id,
    v_enrollment.guardian_email,
    'email',
    'tour_confirmation',
    'Your ' || v_daycare.name || ' tour is booked',
    coalesce(v_enrollment.guardian_name, 'Hello') || ', your tour is confirmed. Track or reschedule it in DailyLog: dailylog://inquiry?code=' || v_enrollment.offer_code,
    jsonb_build_object(
      'type', 'tour_confirmation', 'screen', 'ParentInquiryJourney',
      'journeyCode', v_enrollment.offer_code, 'enrollment_id', v_enrollment.id,
      'slot_id', v_slot.id
    ),
    'parent-tour:' || v_enrollment.id || ':' || v_slot.id || ':confirmation',
    now()
  ),
  (
    v_enrollment.daycare_id,
    v_enrollment.guardian_email,
    'email',
    'tour_confirmation',
    'Reminder: your daycare tour is tomorrow',
    'We look forward to meeting your family. Open the details in DailyLog: dailylog://inquiry?code=' || v_enrollment.offer_code,
    jsonb_build_object(
      'type', 'tour_reminder', 'screen', 'ParentInquiryJourney',
      'journeyCode', v_enrollment.offer_code, 'enrollment_id', v_enrollment.id,
      'slot_id', v_slot.id
    ),
    'parent-tour:' || v_enrollment.id || ':' || v_slot.id || ':reminder',
    v_reminder_at
  ) on conflict do nothing;

  return public.get_parent_inquiry_journey(p_code);
end;
$$;

create or replace function public.reindex_center_waitlist(p_daycare_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  with ranked as (
    select enrollment.id,
      row_number() over (
        order by
          case enrollment.waitlist_priority
            when 'sibling' then 0 when 'staff' then 1 else 2
          end,
          coalesce(enrollment.waitlist_joined_at, enrollment.created_at),
          enrollment.id
      )::int as next_position
    from public.enrollments enrollment
    where enrollment.daycare_id = p_daycare_id
      and enrollment.waitlist_status in ('active', 'offer')
  )
  update public.enrollments enrollment
  set waitlist_position = ranked.next_position
  from ranked
  where enrollment.id = ranked.id
    and enrollment.waitlist_position is distinct from ranked.next_position
$$;

revoke all on function public.reindex_center_waitlist(uuid)
  from public, anon, authenticated;

create or replace function public.respond_parent_waitlist_checkin(
  p_code text,
  p_keep_spot boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enrollment public.enrollments%rowtype;
begin
  perform public.assert_rate_limit(
    'parent_waitlist_response', 15, 900, left(upper(btrim(p_code)), 16)
  );

  select * into v_enrollment
  from public.enrollments enrollment
  where upper(enrollment.offer_code) = upper(btrim(p_code))
  for update;
  if v_enrollment.id is null then raise exception 'This family link is invalid'; end if;
  if v_enrollment.waitlist_status <> 'active' then
    raise exception 'This waitlist entry is no longer active';
  end if;

  if p_keep_spot then
    update public.enrollments
    set waitlist_unanswered_checkins = 0,
        waitlist_response_due_at = null,
        waitlist_last_response_at = now()
    where id = v_enrollment.id;
  else
    update public.enrollments
    set stage = 'withdrawn',
        stage_changed_at = now(),
        waitlist_status = 'archived',
        waitlist_position = null,
        waitlist_response_due_at = null,
        waitlist_last_response_at = now(),
        closed_reason = 'Family left the waitlist',
        closed_at = now()
    where id = v_enrollment.id;
    perform public.reindex_center_waitlist(v_enrollment.daycare_id);
  end if;

  insert into public.notification_outbox (
    daycare_id, recipient_email, channel, kind, title, body, payload, dedupe_key
  ) values (
    v_enrollment.daycare_id,
    v_enrollment.guardian_email,
    'email',
    'waitlist_confirmation',
    case when p_keep_spot then 'Your waitlist place is confirmed' else 'You have left the waitlist' end,
    case when p_keep_spot
      then 'Thanks — your family remains on the waitlist.'
      else 'Your family has been removed from the active waitlist. The center can restore it if your plans change.'
    end,
    jsonb_build_object(
      'type', 'waitlist_response', 'screen', 'ParentInquiryJourney',
      'journeyCode', v_enrollment.offer_code, 'keepSpot', p_keep_spot
    ),
    'parent-waitlist-response:' || v_enrollment.id || ':' || txid_current()
  ) on conflict do nothing;

  return public.get_parent_inquiry_journey(p_code);
end;
$$;

create or replace function public.process_overdue_waitlist_checkins()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_archived int := 0;
  v_daycare_id uuid;
begin
  with due as (
    select enrollment.id,
      enrollment.daycare_id,
      enrollment.waitlist_unanswered_checkins,
      coalesce(settings.auto_archive_checkins, 2) as archive_after
    from public.enrollments enrollment
    left join public.enrollment_settings settings
      on settings.daycare_id = enrollment.daycare_id
    where enrollment.waitlist_status = 'active'
      and enrollment.waitlist_response_due_at <= now()
  ), archived as (
    update public.enrollments enrollment
    set waitlist_status = case
          when due.waitlist_unanswered_checkins >= due.archive_after then 'archived'
          else enrollment.waitlist_status
        end,
        waitlist_position = case
          when due.waitlist_unanswered_checkins >= due.archive_after then null
          else enrollment.waitlist_position
        end,
        waitlist_response_due_at = null,
        closed_reason = case
          when due.waitlist_unanswered_checkins >= due.archive_after
            then 'Archived after unanswered waitlist check-ins'
          else enrollment.closed_reason
        end,
        closed_at = case
          when due.waitlist_unanswered_checkins >= due.archive_after then now()
          else enrollment.closed_at
        end
    from due
    where enrollment.id = due.id
    returning enrollment.daycare_id,
      enrollment.waitlist_status = 'archived' as was_archived
  )
  select count(*) filter (where was_archived)::int into v_archived from archived;

  for v_daycare_id in
    select distinct enrollment.daycare_id
    from public.enrollments enrollment
    where enrollment.waitlist_status in ('active', 'offer')
  loop
    perform public.reindex_center_waitlist(v_daycare_id);
  end loop;

  return coalesce(v_archived, 0);
end;
$$;

-- Anonymous writes still pass through narrow definer RPCs; these kinds need to
-- survive the central outbox permission trigger after the RPC validates a code.
create or replace function public.enforce_notification_enqueue_permission()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare v_area text;
begin
  if auth.role() = 'service_role' or (auth.uid() is null and auth.role() is null) then
    return new;
  end if;
  if auth.role() = 'anon' and new.kind in (
    'enrollment_inquiry_received', 'tour_confirmation', 'waitlist_confirmation'
  ) then
    return new;
  end if;
  v_area := case
    when new.kind in (
      'enrollment_inquiry_received', 'tour_confirmation', 'enrollment_application',
      'enrollment_documents', 'waitlist_offer', 'offer_reminder',
      'offer_withdrawn', 'inquiry_closed', 'waitlist_checkin',
      'waitlist_confirmation', 'waitlist_position_changed'
    ) then 'enrollment'
    when new.kind = 'announcement' then 'broadcasts'
    when new.kind = 'incident' then 'incidents'
    when new.kind = 'medication' then 'medications'
    when new.kind in ('invoice', 'payment') then 'billing'
    when new.kind = 'staff_invite' then 'staff'
    when new.kind = 'parent_invite' then 'children'
    else 'daily_logs'
  end;
  if not public.has_permission(v_area, 'edit') then
    raise exception '% edit permission required', v_area;
  end if;
  return new;
end;
$$;

revoke all on function public.get_parent_inquiry_center(uuid) from public;
revoke all on function public.submit_parent_enrollment_inquiry(
  uuid, text, text, text, text, date, uuid, date, int
) from public;
revoke all on function public.get_parent_inquiry_journey(text) from public;
revoke all on function public.book_parent_enrollment_tour(text, uuid) from public;
revoke all on function public.respond_parent_waitlist_checkin(text, boolean) from public;
revoke all on function public.process_overdue_waitlist_checkins() from public;

grant execute on function public.get_parent_inquiry_center(uuid) to anon, authenticated;
grant execute on function public.submit_parent_enrollment_inquiry(
  uuid, text, text, text, text, date, uuid, date, int
) to anon, authenticated;
grant execute on function public.get_parent_inquiry_journey(text) to anon, authenticated;
grant execute on function public.book_parent_enrollment_tour(text, uuid) to anon, authenticated;
grant execute on function public.respond_parent_waitlist_checkin(text, boolean) to anon, authenticated;
grant execute on function public.process_overdue_waitlist_checkins() to service_role;
