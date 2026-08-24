-- Parent mobile Group 26 completion: let a family cancel a future tour without
-- losing the secure inquiry journey. The staffed slot is reopened atomically,
-- and unsent confirmation/reminder emails for the booking are removed.

create or replace function public.cancel_parent_enrollment_tour(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enrollment public.enrollments%rowtype;
  v_slot public.enrollment_tour_slots%rowtype;
begin
  if nullif(btrim(p_code), '') is null then
    raise exception 'A journey code is required';
  end if;

  perform public.assert_rate_limit(
    'parent_inquiry_cancel_tour', 10, 900, left(upper(btrim(p_code)), 16)
  );

  select * into v_enrollment
  from public.enrollments enrollment
  where upper(enrollment.offer_code) = upper(btrim(p_code))
  for update;

  if v_enrollment.id is null then
    raise exception 'This family link is invalid';
  end if;
  if v_enrollment.stage in ('enrolled', 'withdrawn')
     or v_enrollment.offer_status in ('sent', 'viewed', 'accepted') then
    raise exception 'Tour cancellation is no longer available for this application';
  end if;

  select * into v_slot
  from public.enrollment_tour_slots slot
  where slot.enrollment_id = v_enrollment.id
    and slot.status = 'booked'
  order by slot.starts_at desc
  limit 1
  for update;

  if v_slot.id is null then
    raise exception 'There is no booked tour to cancel';
  end if;
  if v_slot.starts_at <= now() then
    raise exception 'A past tour cannot be cancelled';
  end if;

  update public.enrollment_tour_slots
  set status = 'open', enrollment_id = null
  where id = v_slot.id
    and status = 'booked'
    and enrollment_id = v_enrollment.id;

  if not found then
    raise exception 'That tour booking has already changed';
  end if;

  update public.enrollments
  set stage = case when stage = 'tour' then 'inquiry' else stage end,
      stage_changed_at = now(),
      tour_at = null,
      tour_host_id = null,
      tour_outcome = null
  where id = v_enrollment.id;

  delete from public.notification_outbox
  where daycare_id = v_enrollment.daycare_id
    and status = 'pending'
    and kind = 'tour_confirmation'
    and payload->>'enrollment_id' = v_enrollment.id::text
    and payload->>'slot_id' = v_slot.id::text;

  return public.get_parent_inquiry_journey(p_code);
end;
$$;

revoke all on function public.cancel_parent_enrollment_tour(text) from public;
grant execute on function public.cancel_parent_enrollment_tour(text) to anon, authenticated;
