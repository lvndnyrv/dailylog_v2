-- Rollback-safe Group 8 attendance corrections, follow-ups and billing checks.
begin;

create or replace function pg_temp.impersonate(p_role text, p_user uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', p_user,
      'role', case when p_role = 'postgres' then 'service_role' else p_role end
    )::text,
    true
  );
  perform set_config('role', p_role, true);
end $$;

do $$
declare
  v_owner uuid := '00000000-0000-4000-a000-000000000001';
  v_parent uuid;
  v_daycare uuid;
  v_child uuid;
  v_attendance uuid;
  v_followup_attendance uuid;
  v_late_attendance uuid;
  v_correction uuid;
  v_followup uuid;
  v_invoice uuid;
  v_event uuid;
  v_invoice_before integer;
  v_invoice_after integer;
  v_test_day date := date '1999-01-15';
  v_followup_day date := date '1999-01-16';
  v_late_day date := date '1999-01-17';
begin
  select owner.daycare_id into v_daycare
    from public.profiles owner
   where owner.id = v_owner;

  select link.child_id, link.parent_id into v_child, v_parent
    from public.parent_children link
    join public.children child on child.id = link.child_id
   where child.daycare_id = v_daycare
     and child.archived_at is null
   order by child.created_at
   limit 1;

  if v_daycare is null or v_child is null or v_parent is null then
    raise exception 'Missing Group 8 dev fixtures';
  end if;

  -- Isolate the fixed historical dates. Everything is rolled back at the end.
  perform pg_temp.impersonate('postgres');
  update public.children
     set enrolled_on = least(coalesce(enrolled_on, v_test_day), v_test_day)
   where id = v_child;
  delete from public.attendance_records
   where child_id = v_child
     and date in (v_test_day, v_followup_day, v_late_day);

  insert into public.attendance_records (
    daycare_id, child_id, date, checked_in_at, checked_out_at,
    checked_in_by, checked_out_by, method, status
  ) values (
    v_daycare, v_child, v_test_day,
    timestamptz '1999-01-15 13:00:00+00', timestamptz '1999-01-15 21:00:00+00',
    v_owner, v_owner, 'kiosk', 'present'
  ) returning id into v_attendance;

  perform pg_temp.impersonate('authenticated', v_owner);
  v_correction := public.correct_attendance_record(
    v_attendance,
    timestamptz '1999-01-15 13:05:00+00',
    timestamptz '1999-01-15 21:10:00+00',
    'parent_confirmed',
    'Parent confirmed both corrected times.'
  );

  if not exists (
    select 1
      from public.attendance_corrections correction
     where correction.id = v_correction
       and correction.attendance_id = v_attendance
       and correction.previous_checked_in_at = timestamptz '1999-01-15 13:00:00+00'
       and correction.corrected_checked_out_at = timestamptz '1999-01-15 21:10:00+00'
       and correction.source = 'parent_confirmed'
       and correction.corrected_by = v_owner
  ) then
    raise exception 'FAIL: attendance correction did not retain its audit trail';
  end if;

  select sent.followup_id into v_followup
    from public.send_attendance_followup(
      v_child,
      v_followup_day,
      'We expected your child today. Please report an absence or arrival update.'
    ) sent;

  if not exists (
    select 1
      from public.attendance_followups followup
     where followup.id = v_followup
       and followup.child_id = v_child
       and followup.escalation_due_at > followup.sent_at
  ) then
    raise exception 'FAIL: attendance follow-up was not persisted with an escalation';
  end if;
  if not exists (
    select 1
      from public.notification_outbox outbox
     where outbox.payload ->> 'followupId' = v_followup::text
       and outbox.kind = 'attendance_followup'
  ) then
    raise exception 'FAIL: attendance follow-up did not queue a family delivery';
  end if;
  if not exists (
    select 1
      from public.notification_outbox outbox
     where outbox.payload ->> 'followupId' = v_followup::text
       and outbox.kind = 'attendance_escalation'
       and outbox.available_at > now()
  ) then
    raise exception 'FAIL: attendance follow-up did not queue the one-hour admin escalation';
  end if;

  -- A family response resolves the follow-up and cancels the pending escalation.
  insert into public.attendance_records (
    daycare_id, child_id, date, method, status, absence_reason
  ) values (
    v_daycare, v_child, v_followup_day, 'parent', 'absent', 'Sick'
  ) returning id into v_followup_attendance;

  if not exists (
    select 1 from public.attendance_followups followup
     where followup.id = v_followup
       and followup.resolved_at is not null
       and followup.resolution = 'absent'
  ) then
    raise exception 'FAIL: family absence did not resolve the attendance follow-up';
  end if;
  if exists (
    select 1 from public.notification_outbox outbox
     where outbox.payload ->> 'followupId' = v_followup::text
       and outbox.kind = 'attendance_escalation'
       and outbox.status = 'pending'
  ) then
    raise exception 'FAIL: resolved follow-up left its escalation active';
  end if;

  -- Parent accounts may answer attendance questions, but cannot alter the
  -- signed correction trail or send messages on behalf of the center.
  perform pg_temp.impersonate('authenticated', v_parent);
  begin
    perform public.correct_attendance_record(
      v_attendance,
      timestamptz '1999-01-15 13:10:00+00',
      timestamptz '1999-01-15 21:10:00+00',
      'other', 'Unauthorized parent correction.'
    );
    raise exception 'FAIL: parent corrected an attendance record';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  begin
    perform public.send_attendance_followup(v_child, v_late_day, 'Unauthorized follow-up.');
    raise exception 'FAIL: parent sent an attendance follow-up';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  -- A billable late pickup attaches exactly one line to the family's newest
  -- open invoice, while the transaction keeps production data untouched.
  perform pg_temp.impersonate('authenticated', v_owner);
  v_invoice := public.create_invoice(
    v_child,
    v_parent,
    public.center_today() + 14,
    '[{"description":"Group 8 verification tuition","quantity":1,"unit_amount_cents":100}]'::jsonb
  );
  select invoice.total_cents into v_invoice_before
    from public.invoices invoice where invoice.id = v_invoice;

  perform pg_temp.impersonate('postgres');
  insert into public.attendance_records (
    daycare_id, child_id, date, checked_in_at, checked_out_at,
    checked_in_by, checked_out_by, method, status
  ) values (
    v_daycare, v_child, v_late_day,
    timestamptz '1999-01-17 13:00:00+00', timestamptz '1999-01-17 23:12:00+00',
    v_owner, v_owner, 'educator', 'present'
  ) returning id into v_late_attendance;

  insert into public.late_pickup_events (
    daycare_id, child_id, attendance_id, occurred_on,
    expected_at, picked_up_at, late_minutes, billable_minutes, fee_cents,
    conversation_required, collected_by, notes, recorded_by
  ) values (
    v_daycare, v_child, v_late_attendance, v_late_day,
    timestamptz '1999-01-17 23:00:00+00', timestamptz '1999-01-17 23:12:00+00',
    12, 7, 700, false, 'Verified guardian', 'Group 8 billing verification', v_owner
  ) returning id into v_event;

  select invoice.total_cents into v_invoice_after
    from public.invoices invoice where invoice.id = v_invoice;
  if v_invoice_after <> v_invoice_before + 700 then
    raise exception 'FAIL: late-pickup fee did not update the open invoice total';
  end if;
  if not exists (
    select 1
      from public.late_pickup_events event
      join public.invoice_lines line on line.id = event.invoice_line_id
     where event.id = v_event
       and event.billing_status = 'billed'
       and event.invoice_id = v_invoice
       and line.invoice_id = v_invoice
       and line.amount_cents = 700
  ) then
    raise exception 'FAIL: late-pickup event is missing its linked invoice line';
  end if;
end $$;

rollback;
select 'PASS: Group 8 corrections, follow-ups, escalation cancellation, billing and parent boundaries are enforced' as result;
