-- Parent Mobile Group 26 inquiry, tour, waitlist and offer-handoff tests.
-- Self-contained and rollback-safe.
begin;

create or replace function pg_temp.impersonate(p_role text, p_user_id uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('role', p_role, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id, 'role', p_role)::text,
    true
  );
end;
$$;

do $$
declare
  v_daycare constant uuid := '10000000-0000-4000-a000-000000000001';
  v_room constant uuid := '20000000-0000-4000-a000-000000000003';
  v_host constant uuid := '00000000-0000-4000-a000-000000000008';
  v_slot_one constant uuid := '42690000-0000-4000-a000-000000000001';
  v_slot_two constant uuid := '42690000-0000-4000-a000-000000000002';
  v_center jsonb;
  v_first jsonb;
  v_second jsonb;
  v_journey jsonb;
  v_offer jsonb;
  v_first_id uuid;
  v_second_id uuid;
  v_code_one text;
  v_code_two text;
  v_count int;
  v_archived int;
  v_failed boolean := false;
begin
  perform pg_temp.impersonate('postgres');
  delete from public.rate_limit_windows
  where scope in (
    'enrollment_inquiry', 'parent_inquiry_center', 'parent_inquiry_journey',
    'parent_inquiry_book_tour', 'parent_inquiry_cancel_tour',
    'parent_waitlist_response', 'parent_offer_preview'
  );

  perform pg_temp.impersonate('anon');
  v_center := public.get_parent_inquiry_center(v_daycare);
  if v_center->>'name' <> 'Sunny Grove Early Learning'
     or jsonb_array_length(v_center->'programs') < 4 then
    raise exception 'FAIL: public center inquiry payload is incomplete: %', v_center;
  end if;
  raise notice 'PASS: public inquiry link returns only active center programs';

  v_first := public.submit_parent_enrollment_inquiry(
    v_daycare, 'Femi Adeyemi', 'femi.group26@family.test', '905-555-2601',
    'Nora Adeyemi', (current_date - interval '3 years')::date, v_room,
    current_date + 60, 5
  );
  v_second := public.submit_parent_enrollment_inquiry(
    v_daycare, 'Priya Singh', 'priya.group26@family.test', null,
    'Leila Singh', (current_date - interval '4 years')::date, v_room,
    current_date + 75, 3
  );
  v_first_id := (v_first->>'enrollment_id')::uuid;
  v_second_id := (v_second->>'enrollment_id')::uuid;
  v_code_one := v_first->>'journey_code';
  v_code_two := v_second->>'journey_code';

  perform pg_temp.impersonate('postgres');
  if not exists (
    select 1 from public.enrollments enrollment
    where enrollment.id = v_first_id
      and enrollment.child_first_name = 'Nora'
      and enrollment.child_last_name = 'Adeyemi'
      and enrollment.offer_code = v_code_one
  ) then
    raise exception 'FAIL: complete child name or journey code was not preserved';
  end if;
  if not exists (
    select 1 from public.notification_outbox outbox
    where outbox.dedupe_key = 'public-inquiry:' || v_first_id
      and outbox.body like '%dailylog://inquiry?code=' || v_code_one || '%'
  ) then
    raise exception 'FAIL: acknowledgement omitted the secure return link';
  end if;
  raise notice 'PASS: submission preserves full name and emails one opaque return code';

  insert into public.enrollment_tour_slots (
    id, daycare_id, starts_at, ends_at, classroom_id, host_id, status
  ) values
  (
    v_slot_one, v_daycare,
    (current_date + 180 + time '09:30') at time zone 'America/Toronto',
    (current_date + 180 + time '10:15') at time zone 'America/Toronto',
    v_room, v_host, 'open'
  ),
  (
    v_slot_two, v_daycare,
    (current_date + 181 + time '15:15') at time zone 'America/Toronto',
    (current_date + 181 + time '16:00') at time zone 'America/Toronto',
    v_room, v_host, 'open'
  );

  perform pg_temp.impersonate('anon');
  v_journey := public.get_parent_inquiry_journey(v_code_one);
  if v_journey->'guardian'->>'email' <> 'femi.group26@family.test'
     or v_journey->'child'->>'last_name' <> 'Adeyemi'
     or jsonb_array_length(v_journey->'open_tour_slots') < 2
     or v_journey::text like '%priya.group26@family.test%' then
    raise exception 'FAIL: secure journey payload is incomplete or crosses families: %', v_journey;
  end if;
  if not jsonb_path_exists(
    v_journey,
    '$.open_tour_slots[*] ? (@.host_name == "Grace Chen" && @.host_title != null)'
  ) then
    raise exception 'FAIL: tour host identity/title is missing: %', v_journey;
  end if;

  v_failed := false;
  begin
    perform public.get_parent_inquiry_journey('NOT-A-REAL-GROUP26-CODE');
  exception when others then
    v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL: an invalid bearer code returned a journey'; end if;

  update public.enrollments set notes = 'anonymous bypass' where id = v_first_id;
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'FAIL: anonymous caller directly updated enrollment'; end if;
  raise notice 'PASS: bearer payload is family-scoped while direct table writes remain blocked';

  v_journey := public.book_parent_enrollment_tour(v_code_one, v_slot_one);
  if v_journey->'tour'->>'id' <> v_slot_one::text then
    raise exception 'FAIL: family could not atomically book an open tour: %', v_journey;
  end if;

  v_failed := false;
  begin
    perform public.book_parent_enrollment_tour(v_code_two, v_slot_one);
  exception when others then
    v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL: two families booked the same tour slot'; end if;

  v_journey := public.book_parent_enrollment_tour(v_code_one, v_slot_two);
  perform pg_temp.impersonate('postgres');
  if not exists (
    select 1 from public.enrollment_tour_slots
    where id = v_slot_one and status = 'open'
      and enrollment_id is null and host_id = v_host
  ) or not exists (
    select 1 from public.enrollment_tour_slots
    where id = v_slot_two and status = 'booked' and enrollment_id = v_first_id
  ) then
    raise exception 'FAIL: rescheduling did not reopen the original staffed slot';
  end if;
  select count(*) into v_count
  from public.notification_outbox
  where kind = 'tour_confirmation'
    and payload->>'enrollment_id' = v_first_id::text
    and payload->>'slot_id' = v_slot_two::text;
  if v_count <> 2 then
    raise exception 'FAIL: confirmation and evening-before reminder were not replaced atomically';
  end if;
  raise notice 'PASS: tours book exclusively, reschedule cleanly, and refresh both emails';

  perform pg_temp.impersonate('anon');
  v_journey := public.cancel_parent_enrollment_tour(v_code_one);
  perform pg_temp.impersonate('postgres');
  if v_journey->'tour' <> 'null'::jsonb
     or v_journey->>'stage' <> 'inquiry'
     or not exists (
       select 1 from public.enrollment_tour_slots
       where id = v_slot_two and status = 'open'
         and enrollment_id is null and host_id = v_host
     )
     or exists (
       select 1 from public.notification_outbox
       where status = 'pending' and kind = 'tour_confirmation'
         and payload->>'enrollment_id' = v_first_id::text
         and payload->>'slot_id' = v_slot_two::text
     ) then
    raise exception 'FAIL: cancellation did not restore the staffed slot and clear pending reminders: %', v_journey;
  end if;
  raise notice 'PASS: family cancellation restores the staffed slot and keeps the inquiry journey open';

  update public.enrollments
  set stage = 'application', waitlist_status = 'active',
      waitlist_joined_at = now() - interval '5 months',
      waitlist_priority = 'public', waitlist_position = 1,
      waitlist_unanswered_checkins = 1,
      waitlist_response_due_at = now() + interval '5 days'
  where id = v_second_id;
  perform public.reindex_center_waitlist(v_daycare);

  perform pg_temp.impersonate('anon');
  v_journey := public.get_parent_inquiry_journey(v_code_two);
  if v_journey->'waitlist'->>'status' <> 'active'
     or (v_journey->'waitlist'->>'position')::int < 1
     or (v_journey->'waitlist'->>'total')::int < 1
     or (v_journey->'waitlist'->>'checkin_due')::boolean is not true then
    raise exception 'FAIL: live per-program waitlist state is incomplete: %', v_journey;
  end if;

  v_journey := public.respond_parent_waitlist_checkin(v_code_two, true);
  if (v_journey->'waitlist'->>'checkin_due')::boolean
     or (v_journey->'waitlist'->>'unanswered_checkins')::int <> 0 then
    raise exception 'FAIL: keep-my-place response did not reset check-in state';
  end if;

  v_journey := public.respond_parent_waitlist_checkin(v_code_two, false);
  if v_journey->'waitlist'->>'status' <> 'archived'
     or v_journey->>'stage' <> 'withdrawn' then
    raise exception 'FAIL: explicit removal did not archive the family record';
  end if;
  raise notice 'PASS: family can keep or release a waitlist place without deleting history';

  perform pg_temp.impersonate('postgres');
  update public.enrollments
  set stage = 'application', waitlist_status = 'active',
      waitlist_position = 1, closed_at = null, closed_reason = null,
      waitlist_unanswered_checkins = 1,
      waitlist_response_due_at = now() - interval '1 minute'
  where id = v_first_id;

  perform pg_temp.impersonate('service_role');
  v_archived := public.process_overdue_waitlist_checkins();
  perform pg_temp.impersonate('postgres');
  if v_archived <> 0 or not exists (
    select 1 from public.enrollments
    where id = v_first_id and waitlist_status = 'active'
      and waitlist_response_due_at is null
  ) then
    raise exception 'FAIL: first unanswered check-in incorrectly removed the family';
  end if;

  update public.enrollments
  set waitlist_unanswered_checkins = 2,
      waitlist_response_due_at = now() - interval '1 minute'
  where id = v_first_id;
  perform pg_temp.impersonate('service_role');
  v_archived := public.process_overdue_waitlist_checkins();
  perform pg_temp.impersonate('postgres');
  if v_archived <> 1 or not exists (
    select 1 from public.enrollments
    where id = v_first_id and waitlist_status = 'archived'
      and closed_reason = 'Archived after unanswered waitlist check-ins'
  ) then
    raise exception 'FAIL: configured unanswered threshold did not archive the entry';
  end if;
  raise notice 'PASS: overdue processor keeps the first miss and archives only at the configured threshold';

  update public.enrollments
  set stage = 'offer', waitlist_status = 'offer', offer_status = 'sent',
      offer_sent_at = now(), offer_expires_at = now() + interval '3 days',
      offer_tuition_cents = 132000, offer_deposit_cents = 50000
  where id = v_second_id;

  perform pg_temp.impersonate('anon');
  v_journey := public.get_parent_inquiry_journey(v_code_two);
  v_offer := public.get_parent_enrollment_offer(v_code_two);
  if (v_journey->'offer'->>'available')::boolean is not true
     or v_offer->>'child_first_name' <> 'Leila' then
    raise exception 'FAIL: waitlist journey did not hand off to the existing offer workflow';
  end if;
  raise notice 'PASS: one opaque code hands the family from inquiry into the Group 24 offer flow';
end;
$$;

rollback;
select 'MOBILE PARENT GROUP 26 TESTS: ALL PASSED' as result;
