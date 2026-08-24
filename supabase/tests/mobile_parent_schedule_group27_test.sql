-- Parent Mobile Group 27 publication, reminder, and isolation tests.
-- Requires the standard demo seed and Group 27 demo seed. Every mutation rolls back.
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
  v_parent constant uuid := '00000000-0000-4000-a000-000000000023';
  v_admin constant uuid := '00000000-0000-4000-a000-000000000001';
  v_child constant uuid := '30000000-0000-4000-a000-000000000013';
  v_foreign_child constant uuid := '30000000-0000-4000-a000-000000000002';
  v_plan constant uuid := '42710000-0000-4000-a000-000000000001';
  v_closure constant uuid := '42790000-0000-4000-a000-000000000001';
  v_open_slot constant uuid := '42790000-0000-4000-a000-000000000002';
  v_booked_slot constant uuid := '42790000-0000-4000-a000-000000000003';
  v_chain_closure constant uuid := '42790000-0000-4000-a000-000000000004';
  v_chain_followup constant uuid := '42790000-0000-4000-a000-000000000005';
  v_chain_friday date;
  v_chain_monday date;
  v_reopens_on date;
  v_hub jsonb;
  v_count int;
  v_failed boolean := false;
begin
  perform pg_temp.impersonate('authenticated', v_parent);
  v_hub := public.get_parent_schedule_hub();
  if v_hub->'daycare'->>'opens_at' <> '07:00'
     or jsonb_array_length(v_hub->'closures') < 3
     or not jsonb_path_exists(
       v_hub,
       '$.room_moves[*] ? (@.id == "42710000-0000-4000-a000-000000000001" && @.to_room_name == "Kindergarten" && @.new_tuition_cents == 118000)'
     ) then
    raise exception 'FAIL: family schedule hub is incomplete: %', v_hub;
  end if;
  raise notice 'PASS: parent hub includes hours, closures, transition visits, and rate snapshot';

  select count(*) into v_count
  from public.room_transition_plans
  where child_id = v_foreign_child;
  if v_count <> 0 then
    raise exception 'FAIL: parent can read another family''s room plan';
  end if;
  raise notice 'PASS: room move rows are isolated by linked child';

  update public.room_transition_plans
  set family_message = 'Parent bypass attempt'
  where id = v_plan;
  get diagnostics v_count = row_count;
  if v_count <> 0 then
    raise exception 'FAIL: parent directly changed the office room move plan';
  end if;

  v_failed := false;
  begin
    insert into public.center_closures (
      daycare_id, starts_on, ends_on, reason
    ) values (v_daycare, current_date + 20, current_date + 20, 'Parent bypass');
  exception when others then
    v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL: parent created a center closure'; end if;
  raise notice 'PASS: family schedule is read-only for parents';

  v_chain_friday := current_date + 200
    + ((5 - extract(dow from current_date + 200)::int + 7) % 7);
  v_chain_monday := v_chain_friday + 3;
  perform pg_temp.impersonate('authenticated', v_admin);
  insert into public.center_closures (
    id, daycare_id, starts_on, ends_on, reason, family_visible,
    billing_treatment, reminder_days_before, published_at
  ) values
  (
    v_chain_closure, v_daycare, v_chain_friday, v_chain_friday,
    'Reopening chain Friday', true, 'no_charge', 0, now()
  ),
  (
    v_chain_followup, v_daycare, v_chain_monday, v_chain_monday,
    'Reopening chain Monday', true, 'no_charge', 0, now()
  );

  perform pg_temp.impersonate('authenticated', v_parent);
  v_hub := public.get_parent_schedule_hub();
  select (entry->>'reopens_on')::date into v_reopens_on
  from jsonb_array_elements(v_hub->'closures') entry
  where entry->>'id' = v_chain_closure::text;
  if v_reopens_on <> v_chain_monday + 1 then
    raise exception 'FAIL: reopening date did not skip weekend and consecutive closure: %', v_reopens_on;
  end if;
  raise notice 'PASS: closure details resolve the next genuinely open center day';

  perform pg_temp.impersonate('authenticated', v_admin);
  v_failed := false;
  begin
    update public.center_closures
    set billing_treatment = 'standard_tuition'
    where id = v_chain_closure;
  exception when others then
    v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL: a closed day could still be marked as billable'; end if;

  v_failed := false;
  begin
    update public.room_transition_plans
    set move_on = v_chain_friday
    where id = v_plan;
  exception when others then
    v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL: a room move was scheduled on a closure day'; end if;
  raise notice 'PASS: closure billing and room-move dates are enforced by the database';

  perform pg_temp.impersonate('authenticated', v_parent);
  perform public.set_parent_notification_preference('parent_schedule', true);
  perform pg_temp.impersonate('authenticated', v_admin);
  insert into public.center_closures (
    id, daycare_id, starts_on, ends_on, reason, family_message,
    family_visible, billing_treatment, reminder_days_before, published_at
  ) values (
    v_closure, v_daycare, current_date + 20, current_date + 20,
    'Group 27 test closure', 'Families receive this message.',
    true, 'no_charge', 3, now()
  );

  perform pg_temp.impersonate('authenticated', v_parent);
  select count(*) into v_count
  from public.notifications notification
  where notification.profile_id = v_parent
    and notification.kind = 'parent_schedule'
    and notification.payload->>'closureId' = v_closure::text
    and notification.payload->>'type' = 'center_closure';
  if v_count <> 1 then
    raise exception 'FAIL: published closure did not create one in-app notice';
  end if;

  select count(*) into v_count
  from public.notification_outbox outbox
  where outbox.recipient_id = v_parent
    and outbox.dedupe_key = 'closure:' || v_closure || ':reminder:' || (current_date + 20);
  if v_count <> 1 then
    raise exception 'FAIL: three-day closure reminder was not scheduled';
  end if;
  raise notice 'PASS: closure publication creates a deep-linked notice and future reminder';

  perform public.set_parent_notification_preference('parent_schedule', false);
  perform pg_temp.impersonate('authenticated', v_admin);
  update public.center_closures
  set family_message = 'Updated while push is muted.'
  where id = v_closure;

  perform pg_temp.impersonate('authenticated', v_parent);
  select count(*) into v_count
  from public.notification_outbox outbox
  where outbox.recipient_id = v_parent
    and outbox.payload->>'closureId' = v_closure::text
    and outbox.dedupe_key like '%:updated:%';
  if v_count <> 0 then
    raise exception 'FAIL: muted schedule preference still queued push';
  end if;
  select count(*) into v_count
  from public.notifications notification
  where notification.profile_id = v_parent
    and notification.payload->>'closureId' = v_closure::text;
  if v_count < 2 then
    raise exception 'FAIL: muted push removed the persistent in-app update';
  end if;
  raise notice 'PASS: schedule preference mutes push without hiding in-app history';

  perform public.set_parent_notification_preference('parent_schedule', true);
  perform pg_temp.impersonate('authenticated', v_admin);
  delete from public.center_closures where id = v_closure;

  perform pg_temp.impersonate('authenticated', v_parent);
  select count(*) into v_count
  from public.notification_outbox outbox
  where outbox.recipient_id = v_parent
    and outbox.status = 'pending'
    and outbox.dedupe_key like 'closure:' || v_closure || ':reminder:%';
  if v_count <> 0 then
    raise exception 'FAIL: cancelled closure left a stale reminder';
  end if;
  select count(*) into v_count
  from public.notifications notification
  where notification.profile_id = v_parent
    and notification.payload->>'closureId' = v_closure::text
    and notification.payload->>'type' = 'closure_cancelled';
  if v_count <> 1 then
    raise exception 'FAIL: closure cancellation was not published';
  end if;
  raise notice 'PASS: cancellation removes stale reminder and informs the family';

  perform pg_temp.impersonate('authenticated', v_admin);
  update public.room_transition_plans
  set family_message = 'Mateo will meet the Kindergarten team each morning.'
  where id = v_plan;

  perform pg_temp.impersonate('authenticated', v_parent);
  select count(*) into v_count
  from public.notifications notification
  where notification.profile_id = v_parent
    and notification.kind = 'parent_schedule'
    and notification.payload->>'transitionId' = v_plan::text
    and notification.payload->>'type' = 'room_move';
  if v_count <> 1 then
    raise exception 'FAIL: room move update did not notify linked guardian';
  end if;
  raise notice 'PASS: room move updates publish only to linked guardians';

  perform pg_temp.impersonate('authenticated', v_admin);
  insert into public.enrollment_tour_slots (
    id, daycare_id, starts_at, ends_at, status
  ) values (
    v_open_slot,
    v_daycare,
    (current_date + 120 + time '10:00') at time zone 'America/Toronto',
    (current_date + 120 + time '10:45') at time zone 'America/Toronto',
    'open'
  );
  insert into public.center_closures (
    daycare_id, starts_on, ends_on, reason, family_visible
  ) values (
    v_daycare, current_date + 120, current_date + 120,
    'Tour availability guard', false
  );
  select count(*) into v_count
  from public.enrollment_tour_slots
  where id = v_open_slot and status = 'cancelled';
  if v_count <> 1 then
    raise exception 'FAIL: adding a closure left open tour availability active';
  end if;

  insert into public.enrollment_tour_slots (
    id, daycare_id, starts_at, ends_at, status
  ) values (
    v_booked_slot,
    v_daycare,
    (current_date + 121 + time '10:00') at time zone 'America/Toronto',
    (current_date + 121 + time '10:45') at time zone 'America/Toronto',
    'booked'
  );
  v_failed := false;
  begin
    insert into public.center_closures (
      daycare_id, starts_on, ends_on, reason, family_visible
    ) values (
      v_daycare, current_date + 121, current_date + 121,
      'Booked tour conflict', false
    );
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: a closure silently overrode an already-booked family tour';
  end if;

  insert into public.center_closures (
    daycare_id, starts_on, ends_on, reason, family_visible
  ) values (
    v_daycare, current_date + 122, current_date + 122,
    'Closed-day action guard', false
  );
  v_failed := false;
  begin
    insert into public.enrollment_tour_slots (
      daycare_id, starts_at, ends_at, status
    ) values (
      v_daycare,
      (current_date + 122 + time '10:00') at time zone 'America/Toronto',
      (current_date + 122 + time '10:45') at time zone 'America/Toronto',
      'open'
    );
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: a tour slot was created on a center closure day';
  end if;

  v_failed := false;
  begin
    insert into public.attendance_records (
      daycare_id, child_id, date, checked_in_at, status
    ) values (
      v_daycare, v_child, current_date + 122, now(), 'present'
    );
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: a child was checked in on a center closure day';
  end if;
  raise notice 'PASS: closures remove open tours, protect booked tours, and block closed-day actions';
end;
$$;

rollback;
select 'MOBILE PARENT GROUP 27 TESTS: ALL PASSED' as result;
