-- Group 2l: closing an inquiry also releases any future tour, closes an open
-- offer, removes the family from ranking and queues the optional goodbye. All
-- effects commit together so the pipeline cannot end in a half-closed state.

create or replace function public.close_enrollment_inquiry(
  p_enrollment_id uuid,
  p_reason text,
  p_send_goodbye boolean default true,
  p_keep_on_file boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_center_id uuid := public.get_my_daycare_id();
  v_enrollment public.enrollments%rowtype;
  v_reason text := regexp_replace(btrim(coalesce(p_reason, '')), '\s+', ' ', 'g');
  v_closed_at timestamptz := now();
  v_released_tours integer := 0;
begin
  if auth.uid() is null
     or not public.is_admin()
     or not public.has_permission('enrollment', 'edit') then
    raise exception 'Administrator enrollment-edit permission required';
  end if;
  if p_enrollment_id is null then
    raise exception 'Choose an inquiry to close';
  end if;
  if v_reason = '' then
    raise exception 'Choose a closure reason';
  end if;
  if length(v_reason) > 500 then
    raise exception 'Closure reason is too long';
  end if;
  if p_send_goodbye is null or p_keep_on_file is null then
    raise exception 'Closure choices are required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_center_id::text, 0));

  select * into v_enrollment
    from public.enrollments enrollment
   where enrollment.id = p_enrollment_id
     and enrollment.daycare_id = v_center_id
   for update;
  if v_enrollment.id is null then
    raise exception 'Inquiry not found in this center';
  end if;

  if v_enrollment.stage = 'withdrawn' then
    return jsonb_build_object(
      'status', 'closed', 'retry', true,
      'enrollment_id', v_enrollment.id,
      'closed_at', v_enrollment.closed_at
    );
  end if;
  if v_enrollment.stage = 'enrolled' or v_enrollment.child_id is not null then
    raise exception 'Schedule a child withdrawal instead of closing an enrolled family';
  end if;
  if v_enrollment.offer_status = 'accepted' then
    raise exception 'Withdraw or complete the accepted offer before closing this inquiry';
  end if;
  if p_send_goodbye and (
    v_enrollment.guardian_email is null
    or v_enrollment.guardian_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ) then
    raise exception 'Add a valid guardian email or turn off the goodbye note';
  end if;

  update public.enrollment_tour_slots slot
     set status = 'open',
         enrollment_id = null,
         updated_at = v_closed_at
   where slot.daycare_id = v_center_id
     and slot.enrollment_id = v_enrollment.id
     and slot.status = 'booked'
     and slot.starts_at > v_closed_at;
  get diagnostics v_released_tours = row_count;

  update public.enrollments
     set stage = 'withdrawn',
         stage_changed_at = v_closed_at,
         closed_reason = v_reason,
         closed_at = v_closed_at,
         keep_on_file = p_keep_on_file,
         waitlist_status = 'archived',
         waitlist_position = null,
         waitlist_response_due_at = null,
         offer_status = case
           when v_enrollment.offer_status in ('sent', 'viewed') then 'withdrawn'
           else v_enrollment.offer_status
         end
   where id = v_enrollment.id;

  perform public.reindex_center_waitlist(v_center_id);

  if p_send_goodbye then
    insert into public.notification_outbox (
      daycare_id, recipient_email, channel, kind, title, body, payload, dedupe_key
    ) values (
      v_center_id,
      lower(v_enrollment.guardian_email),
      'email',
      'inquiry_closed',
      'Thank you for considering our center',
      coalesce(v_enrollment.guardian_name, 'Hello')
        || ', thank you for considering our center. We have closed this inquiry for now.'
        || case when p_keep_on_file
          then ' Your family remains on file if your plans change.'
          else ''
        end,
      jsonb_build_object(
        'type', 'inquiry_closed',
        'screen', 'ParentInquiryJourney',
        'journeyCode', upper(v_enrollment.offer_code),
        'enrollmentId', v_enrollment.id,
        'reason', v_reason,
        'keptOnFile', p_keep_on_file
      ),
      'inquiry-closed:' || v_enrollment.id || ':'
        || extract(epoch from v_closed_at)::bigint
    ) on conflict do nothing;
  end if;

  return jsonb_build_object(
    'status', 'closed', 'retry', false,
    'enrollment_id', v_enrollment.id,
    'closed_at', v_closed_at,
    'released_tour_slots', v_released_tours,
    'released_offer', v_enrollment.offer_status in ('sent', 'viewed'),
    'kept_on_file', p_keep_on_file
  );
end;
$$;

revoke all on function public.close_enrollment_inquiry(uuid, text, boolean, boolean)
  from public, anon;
grant execute on function public.close_enrollment_inquiry(uuid, text, boolean, boolean)
  to authenticated;

notify pgrst, 'reload schema';
