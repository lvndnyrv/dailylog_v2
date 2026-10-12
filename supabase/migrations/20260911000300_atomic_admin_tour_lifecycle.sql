-- Group 2m: reuse the secure parent-tour transaction for admin bookings, then
-- make cancellation and outcome logging equally atomic. This closes the gaps
-- where a slot, pipeline card and family notice could disagree.

alter table public.enrollments
  drop constraint if exists enrollments_tour_outcome_check;
alter table public.enrollments
  add constraint enrollments_tour_outcome_check check (
    tour_outcome is null
    or tour_outcome in ('attended', 'no_show', 'rescheduled', 'cancelled')
  );

create or replace function public.book_admin_enrollment_tour(
  p_enrollment_id uuid,
  p_slot_id uuid,
  p_host_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_center_id uuid := public.get_my_daycare_id();
  v_enrollment public.enrollments%rowtype;
  v_slot public.enrollment_tour_slots%rowtype;
  v_payload jsonb;
begin
  if auth.uid() is null
     or not public.is_admin()
     or not public.has_permission('enrollment', 'edit') then
    raise exception 'Administrator enrollment-edit permission required';
  end if;
  if p_enrollment_id is null or p_slot_id is null then
    raise exception 'Choose a family and an open tour slot';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_center_id::text, 0));

  select * into v_enrollment
    from public.enrollments enrollment
   where enrollment.id = p_enrollment_id
     and enrollment.daycare_id = v_center_id
   for update;
  if v_enrollment.id is null then
    raise exception 'Enrollment family not found in this center';
  end if;
  if v_enrollment.stage in ('enrolled', 'withdrawn')
     or v_enrollment.offer_status in ('sent', 'viewed', 'accepted') then
    raise exception 'Tour booking is no longer available for this family';
  end if;

  select * into v_slot
    from public.enrollment_tour_slots slot
   where slot.id = p_slot_id
     and slot.daycare_id = v_center_id
   for update;
  if v_slot.id is null or v_slot.starts_at <= now() then
    raise exception 'That tour time is no longer available';
  end if;
  if v_slot.status <> 'open'
     and not (v_slot.status = 'booked' and v_slot.enrollment_id = v_enrollment.id) then
    raise exception 'That tour time was just booked';
  end if;

  if p_host_id is not null and not exists (
    select 1 from public.profiles host
     where host.id = p_host_id
       and host.daycare_id = v_center_id
       and host.role in ('owner_admin', 'admin', 'educator')
       and host.archived_at is null
  ) then
    raise exception 'Choose an active host from this center';
  end if;

  if v_slot.classroom_id is not null
     and v_enrollment.classroom_id is distinct from v_slot.classroom_id then
    if v_enrollment.waitlist_status in ('active', 'offer') then
      raise exception 'Choose a tour slot for the family''s waitlisted room';
    end if;
    update public.enrollments
       set classroom_id = v_slot.classroom_id
     where id = v_enrollment.id;
  end if;

  update public.enrollment_tour_slots
     set host_id = p_host_id
   where id = v_slot.id;

  v_payload := public.book_parent_enrollment_tour(
    v_enrollment.offer_code,
    v_slot.id
  );

  return jsonb_build_object(
    'status', 'booked',
    'retry', v_slot.status = 'booked',
    'enrollment_id', v_enrollment.id,
    'slot_id', v_slot.id,
    'starts_at', v_slot.starts_at,
    'journey', v_payload
  );
end;
$$;

revoke all on function public.book_admin_enrollment_tour(uuid, uuid, uuid)
  from public, anon;
grant execute on function public.book_admin_enrollment_tour(uuid, uuid, uuid)
  to authenticated;

create or replace function public.cancel_admin_enrollment_tour(
  p_enrollment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_center_id uuid := public.get_my_daycare_id();
  v_enrollment public.enrollments%rowtype;
  v_slot public.enrollment_tour_slots%rowtype;
  v_cancelled_at timestamptz := now();
begin
  if auth.uid() is null
     or not public.is_admin()
     or not public.has_permission('enrollment', 'edit') then
    raise exception 'Administrator enrollment-edit permission required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_center_id::text, 0));

  select * into v_enrollment
    from public.enrollments enrollment
   where enrollment.id = p_enrollment_id
     and enrollment.daycare_id = v_center_id
   for update;
  if v_enrollment.id is null then
    raise exception 'Enrollment family not found in this center';
  end if;
  if v_enrollment.stage in ('enrolled', 'withdrawn') then
    raise exception 'An inactive family cannot cancel a tour';
  end if;

  select * into v_slot
    from public.enrollment_tour_slots slot
   where slot.daycare_id = v_center_id
     and slot.enrollment_id = v_enrollment.id
     and slot.status = 'booked'
     and slot.starts_at > v_cancelled_at
   order by slot.starts_at
   limit 1
   for update;

  if v_slot.id is null then
    if v_enrollment.tour_at is null and v_enrollment.tour_outcome = 'cancelled' then
      return jsonb_build_object(
        'status', 'cancelled', 'retry', true,
        'enrollment_id', v_enrollment.id
      );
    end if;
    raise exception 'No upcoming booked tour was found';
  end if;

  update public.enrollment_tour_slots
     set enrollment_id = null,
         host_id = null,
         status = 'open'
   where id = v_slot.id;

  update public.enrollments
     set stage = case when stage = 'tour' then 'inquiry' else stage end,
         stage_changed_at = case when stage = 'tour' then v_cancelled_at else stage_changed_at end,
         tour_at = null,
         tour_host_id = null,
         tour_outcome = 'cancelled'
   where id = v_enrollment.id;

  delete from public.notification_outbox outbox
   where outbox.daycare_id = v_center_id
     and outbox.status = 'pending'
     and outbox.kind = 'tour_confirmation'
     and outbox.payload->>'enrollment_id' = v_enrollment.id::text;

  if v_enrollment.guardian_email is not null
     and v_enrollment.guardian_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    insert into public.notification_outbox (
      daycare_id, recipient_email, channel, kind, title, body, payload, dedupe_key
    ) values (
      v_center_id,
      lower(v_enrollment.guardian_email),
      'email',
      'tour_confirmation',
      'Your daycare tour was cancelled',
      coalesce(v_enrollment.guardian_name, 'Hello')
        || ', your tour has been cancelled. You can choose another open time from your secure DailyLog family link.',
      jsonb_build_object(
        'type', 'tour_cancelled',
        'screen', 'ParentInquiryJourney',
        'journeyCode', upper(v_enrollment.offer_code),
        'enrollment_id', v_enrollment.id,
        'slot_id', v_slot.id
      ),
      'admin-tour-cancelled:' || v_enrollment.id || ':' || v_slot.id
    ) on conflict do nothing;
  end if;

  return jsonb_build_object(
    'status', 'cancelled', 'retry', false,
    'enrollment_id', v_enrollment.id,
    'slot_id', v_slot.id
  );
end;
$$;

revoke all on function public.cancel_admin_enrollment_tour(uuid)
  from public, anon;
grant execute on function public.cancel_admin_enrollment_tour(uuid)
  to authenticated;

create or replace function public.record_admin_enrollment_tour_outcome(
  p_enrollment_id uuid,
  p_outcome text,
  p_notes text default null,
  p_send_application boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_center_id uuid := public.get_my_daycare_id();
  v_enrollment public.enrollments%rowtype;
  v_outcome text := lower(btrim(coalesce(p_outcome, '')));
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_recorded_at timestamptz := now();
begin
  if auth.uid() is null
     or not public.is_admin()
     or not public.has_permission('enrollment', 'edit') then
    raise exception 'Administrator enrollment-edit permission required';
  end if;
  if v_outcome not in ('attended', 'no_show', 'rescheduled') then
    raise exception 'Choose a valid tour outcome';
  end if;
  if length(coalesce(v_notes, '')) > 2000 then
    raise exception 'Tour notes are too long';
  end if;
  if p_send_application and v_outcome <> 'attended' then
    raise exception 'An application can only follow an attended tour';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_center_id::text, 0));

  select * into v_enrollment
    from public.enrollments enrollment
   where enrollment.id = p_enrollment_id
     and enrollment.daycare_id = v_center_id
   for update;
  if v_enrollment.id is null then
    raise exception 'Enrollment family not found in this center';
  end if;
  if v_enrollment.stage in ('enrolled', 'withdrawn') then
    raise exception 'Tour outcome is no longer available for this family';
  end if;
  if v_enrollment.tour_at is null then
    raise exception 'Book the family tour before logging its outcome';
  end if;
  if v_enrollment.tour_at > v_recorded_at + interval '15 minutes'
     and v_outcome <> 'rescheduled' then
    raise exception 'This tour has not started yet';
  end if;
  if p_send_application and (
    v_enrollment.guardian_email is null
    or v_enrollment.guardian_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ) then
    raise exception 'Add a valid guardian email before sending the application';
  end if;

  if v_enrollment.tour_outcome = v_outcome
     and (not p_send_application or v_enrollment.stage = 'application') then
    return jsonb_build_object(
      'status', 'recorded', 'retry', true,
      'enrollment_id', v_enrollment.id,
      'outcome', v_outcome
    );
  end if;

  if v_outcome = 'rescheduled' then
    update public.enrollment_tour_slots slot
       set status = 'open', enrollment_id = null, host_id = null
     where slot.daycare_id = v_center_id
       and slot.enrollment_id = v_enrollment.id
       and slot.status = 'booked'
       and slot.starts_at > v_recorded_at;

    delete from public.notification_outbox outbox
     where outbox.daycare_id = v_center_id
       and outbox.status = 'pending'
       and outbox.kind = 'tour_confirmation'
       and outbox.payload->>'enrollment_id' = v_enrollment.id::text;
  end if;

  update public.enrollments
     set tour_outcome = v_outcome,
         tour_notes = v_notes,
         tour_at = case when v_outcome = 'rescheduled' then null else tour_at end,
         tour_host_id = case when v_outcome = 'rescheduled' then null else tour_host_id end,
         stage = case
           when v_outcome = 'attended' and p_send_application then 'application'
           else stage
         end,
         stage_changed_at = case
           when v_outcome = 'attended' and p_send_application then v_recorded_at
           else stage_changed_at
         end,
         application_progress = case
           when v_outcome = 'attended' and p_send_application
             then greatest(application_progress, 20)
           else application_progress
         end
   where id = v_enrollment.id;

  if v_outcome = 'attended' and p_send_application then
    insert into public.notification_outbox (
      daycare_id, recipient_email, channel, kind, title, body, payload, dedupe_key
    ) values (
      v_center_id,
      lower(v_enrollment.guardian_email),
      'email',
      'enrollment_application',
      'Your enrollment application is ready',
      coalesce(v_enrollment.guardian_name, 'Hello')
        || ', thanks for visiting. Complete your enrollment application from your secure DailyLog family link.',
      jsonb_build_object(
        'type', 'enrollment_application',
        'screen', 'ParentInquiryJourney',
        'journeyCode', upper(v_enrollment.offer_code),
        'enrollment_id', v_enrollment.id
      ),
      'application:' || v_enrollment.id
    ) on conflict do nothing;
  end if;

  return jsonb_build_object(
    'status', 'recorded', 'retry', false,
    'enrollment_id', v_enrollment.id,
    'outcome', v_outcome,
    'application_sent', v_outcome = 'attended' and p_send_application
  );
end;
$$;

revoke all on function public.record_admin_enrollment_tour_outcome(uuid, text, text, boolean)
  from public, anon;
grant execute on function public.record_admin_enrollment_tour_outcome(uuid, text, text, boolean)
  to authenticated;

notify pgrst, 'reload schema';
