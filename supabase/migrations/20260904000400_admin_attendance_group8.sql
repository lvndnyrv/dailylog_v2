-- ============================================================================
-- Admin Group 8 — attendance corrections, follow-ups and late-pickup billing
-- ============================================================================

create table if not exists public.attendance_corrections (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references public.daycares(id) on delete cascade,
  attendance_id uuid not null references public.attendance_records(id) on delete cascade,
  previous_checked_in_at timestamptz,
  previous_checked_out_at timestamptz,
  corrected_checked_in_at timestamptz,
  corrected_checked_out_at timestamptz,
  source text not null check (source in ('parent_confirmed', 'staff_witnessed', 'kiosk_review', 'other')),
  reason text not null check (length(btrim(reason)) between 3 and 500),
  corrected_by uuid not null references public.profiles(id) on delete restrict,
  corrected_at timestamptz not null default now()
);

create index if not exists attendance_corrections_record_idx
  on public.attendance_corrections (attendance_id, corrected_at desc);
create index if not exists attendance_corrections_center_idx
  on public.attendance_corrections (daycare_id, corrected_at desc);

alter table public.attendance_corrections enable row level security;

drop policy if exists "admins read attendance corrections" on public.attendance_corrections;
create policy "admins read attendance corrections"
  on public.attendance_corrections for select
  using (
    public.is_admin()
    and public.has_permission('attendance', 'view')
    and daycare_id = public.get_my_daycare_id()
  );

drop trigger if exists audit_attendance_corrections on public.attendance_corrections;
create trigger audit_attendance_corrections
  after insert on public.attendance_corrections
  for each row execute function public.audit_write();

create or replace function public.correct_attendance_record(
  p_attendance_id uuid,
  p_checked_in_at timestamptz,
  p_checked_out_at timestamptz,
  p_source text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_record public.attendance_records%rowtype;
  v_correction_id uuid;
begin
  if auth.uid() is null
     or not public.is_admin()
     or not public.has_permission('attendance', 'edit') then
    raise exception 'Attendance edit permission is required';
  end if;
  if p_source not in ('parent_confirmed', 'staff_witnessed', 'kiosk_review', 'other') then
    raise exception 'Choose how the correction was confirmed';
  end if;
  if length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception 'Add a correction note between 3 and 500 characters';
  end if;
  if p_checked_in_at is null and p_checked_out_at is not null then
    raise exception 'A check-out cannot exist without a check-in';
  end if;
  if p_checked_in_at is not null and p_checked_out_at is not null
     and p_checked_out_at < p_checked_in_at then
    raise exception 'Check-out must be after check-in';
  end if;

  select * into v_record
    from public.attendance_records attendance
   where attendance.id = p_attendance_id
     and attendance.daycare_id = public.get_my_daycare_id()
   for update;
  if v_record.id is null then raise exception 'Attendance record not found'; end if;

  if v_record.checked_in_at is not distinct from p_checked_in_at
     and v_record.checked_out_at is not distinct from p_checked_out_at then
    raise exception 'Change at least one attendance time';
  end if;

  insert into public.attendance_corrections (
    daycare_id, attendance_id,
    previous_checked_in_at, previous_checked_out_at,
    corrected_checked_in_at, corrected_checked_out_at,
    source, reason, corrected_by
  ) values (
    v_record.daycare_id, v_record.id,
    v_record.checked_in_at, v_record.checked_out_at,
    p_checked_in_at, p_checked_out_at,
    p_source, btrim(p_reason), auth.uid()
  ) returning id into v_correction_id;

  update public.attendance_records
     set checked_in_at = p_checked_in_at,
         checked_out_at = p_checked_out_at,
         checked_out_by = case
           when p_checked_out_at is distinct from v_record.checked_out_at then auth.uid()
           else checked_out_by
         end,
         checked_in_by = case
           when p_checked_in_at is distinct from v_record.checked_in_at then auth.uid()
           else checked_in_by
         end
   where id = v_record.id;

  return v_correction_id;
end;
$$;

revoke all on function public.correct_attendance_record(uuid, timestamptz, timestamptz, text, text)
  from public, anon;
grant execute on function public.correct_attendance_record(uuid, timestamptz, timestamptz, text, text)
  to authenticated;

create table if not exists public.attendance_followups (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references public.daycares(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  attendance_date date not null,
  message text not null check (length(btrim(message)) between 3 and 1000),
  sent_by uuid not null references public.profiles(id) on delete restrict,
  sent_at timestamptz not null default now(),
  queued_recipients integer not null default 0 check (queued_recipients >= 0),
  escalation_due_at timestamptz,
  resolved_at timestamptz,
  resolution text,
  unique (child_id, attendance_date, sent_at)
);

create index if not exists attendance_followups_center_date_idx
  on public.attendance_followups (daycare_id, attendance_date desc, sent_at desc);
create index if not exists attendance_followups_pending_escalation_idx
  on public.attendance_followups (escalation_due_at)
  where resolved_at is null and escalation_due_at is not null;

alter table public.attendance_followups enable row level security;

drop policy if exists "staff read attendance followups" on public.attendance_followups;
create policy "staff read attendance followups"
  on public.attendance_followups for select
  using (
    public.is_staff()
    and public.has_permission('attendance', 'view')
    and daycare_id = public.get_my_daycare_id()
  );

drop trigger if exists audit_attendance_followups on public.attendance_followups;
create trigger audit_attendance_followups
  after insert or update on public.attendance_followups
  for each row execute function public.audit_write();

create or replace function public.send_attendance_followup(
  p_child_id uuid,
  p_attendance_date date,
  p_message text
)
returns table (followup_id uuid, queued_recipients integer, escalation_due_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_daycare_id uuid := public.get_my_daycare_id();
  v_child_name text;
  v_followup public.attendance_followups%rowtype;
  v_queued integer := 0;
begin
  if auth.uid() is null
     or not public.is_admin()
     or not public.has_permission('attendance', 'edit') then
    raise exception 'Attendance edit permission is required';
  end if;
  if p_attendance_date is null or p_attendance_date > public.center_today() then
    raise exception 'Choose today or an earlier attendance day';
  end if;
  if length(btrim(coalesce(p_message, ''))) not between 3 and 1000 then
    raise exception 'Write a message between 3 and 1000 characters';
  end if;

  select child.first_name || ' ' || child.last_name into v_child_name
    from public.children child
   where child.id = p_child_id
     and child.daycare_id = v_daycare_id
     and child.archived_at is null;
  if v_child_name is null then raise exception 'Child not found'; end if;
  if exists (
    select 1 from public.attendance_records attendance
     where attendance.child_id = p_child_id
       and attendance.date = p_attendance_date
       and attendance.checked_in_at is not null
  ) then raise exception 'This child has already arrived'; end if;

  insert into public.attendance_followups (
    daycare_id, child_id, attendance_date, message, sent_by, escalation_due_at
  ) values (
    v_daycare_id, p_child_id, p_attendance_date, btrim(p_message), auth.uid(), now() + interval '1 hour'
  ) returning * into v_followup;

  v_queued := public.enqueue_child_notification(
    p_child_id,
    'attendance_followup',
    'Is ' || v_child_name || ' coming today?',
    btrim(p_message),
    jsonb_build_object(
      'type', 'attendance_followup', 'screen', 'ReportAbsence',
      'childId', p_child_id, 'date', p_attendance_date,
      'followupId', v_followup.id
    ),
    'attendance-followup:' || v_followup.id,
    array['push', 'email']::text[]
  );

  update public.attendance_followups
     set queued_recipients = v_queued
   where id = v_followup.id;

  -- If the family has not answered in an hour, surface a durable admin task.
  insert into public.notification_outbox (
    daycare_id, recipient_id, channel, kind, title, body, payload,
    dedupe_key, available_at
  )
  select v_daycare_id, admin.id, 'push', 'attendance_escalation',
         'No attendance reply for ' || v_child_name,
         'Use the child''s emergency contacts if the family still has not replied.',
         jsonb_build_object(
           'type', 'attendance_escalation', 'screen', 'Attendance',
           'childId', p_child_id, 'date', p_attendance_date,
           'followupId', v_followup.id
         ),
         'attendance-escalation:' || v_followup.id || ':' || admin.id,
         v_followup.escalation_due_at
    from public.profiles admin
   where admin.daycare_id = v_daycare_id
     and admin.role in ('owner_admin', 'admin')
     and admin.archived_at is null
  on conflict do nothing;

  return query select v_followup.id, v_queued, v_followup.escalation_due_at;
end;
$$;

revoke all on function public.send_attendance_followup(uuid, date, text) from public, anon;
grant execute on function public.send_attendance_followup(uuid, date, text) to authenticated;

create or replace function public.resolve_attendance_followups()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_followup_id uuid;
begin
  if new.checked_in_at is null and new.status not in ('absent', 'late', 'excused') then
    return new;
  end if;

  for v_followup_id in
    update public.attendance_followups followup
       set resolved_at = now(),
           resolution = case
             when new.checked_in_at is not null then 'arrived'
             else new.status
           end
     where followup.child_id = new.child_id
       and followup.attendance_date = new.date
       and followup.resolved_at is null
     returning followup.id
  loop
    update public.notification_outbox outbox
       set status = 'failed',
           last_error = 'Cancelled because the family responded',
           locked_at = null
     where outbox.kind = 'attendance_escalation'
       and outbox.status = 'pending'
       and outbox.payload ->> 'followupId' = v_followup_id::text;
  end loop;
  return new;
end;
$$;

drop trigger if exists attendance_records_resolve_followups on public.attendance_records;
create trigger attendance_records_resolve_followups
  after insert or update of checked_in_at, status on public.attendance_records
  for each row execute function public.resolve_attendance_followups();

alter table public.late_pickup_events
  add column if not exists billing_status text not null default 'pending',
  add column if not exists invoice_id uuid references public.invoices(id) on delete set null,
  add column if not exists invoice_line_id uuid references public.invoice_lines(id) on delete set null,
  add column if not exists family_notified_at timestamptz;

alter table public.late_pickup_events
  drop constraint if exists late_pickup_events_billing_status_check;
alter table public.late_pickup_events
  add constraint late_pickup_events_billing_status_check
  check (billing_status in ('pending', 'billed', 'waived'));

create index if not exists late_pickup_events_pending_billing_idx
  on public.late_pickup_events (daycare_id, occurred_on)
  where billing_status = 'pending' and fee_cents > 0;

create or replace function public.attach_late_pickup_fee_to_invoice(
  p_event_id uuid,
  p_invoice_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.late_pickup_events%rowtype;
  v_invoice public.invoices%rowtype;
  v_line_id uuid;
  v_child_name text;
begin
  select * into v_event from public.late_pickup_events event
   where event.id = p_event_id for update;
  if v_event.id is null or v_event.billing_status <> 'pending' or v_event.fee_cents <= 0 then
    return false;
  end if;

  select * into v_invoice from public.invoices invoice
   where invoice.id = p_invoice_id
     and invoice.daycare_id = v_event.daycare_id
     and invoice.status in ('draft', 'open')
   for update;
  if v_invoice.id is null or v_invoice.family_id is null then return false; end if;
  if not exists (
    select 1 from public.family_children link
     where link.family_id = v_invoice.family_id and link.child_id = v_event.child_id
  ) then return false; end if;

  select child.first_name || ' ' || child.last_name into v_child_name
    from public.children child where child.id = v_event.child_id;

  insert into public.invoice_lines (
    daycare_id, invoice_id, description, quantity, unit_amount_cents, amount_cents
  ) values (
    v_event.daycare_id, v_invoice.id,
    'Late pickup · ' || coalesce(v_child_name, 'child') || ' · ' ||
      to_char(v_event.occurred_on, 'Mon FMDD') || ' · ' || v_event.late_minutes || ' min',
    1, v_event.fee_cents, v_event.fee_cents
  ) returning id into v_line_id;

  update public.late_pickup_events
     set billing_status = 'billed', invoice_id = v_invoice.id, invoice_line_id = v_line_id
   where id = v_event.id;

  update public.invoices
     set subtotal_cents = subtotal_cents + v_event.fee_cents,
         total_cents = total_cents + v_event.fee_cents
   where id = v_invoice.id;
  return true;
end;
$$;

create or replace function public.route_late_pickup_fee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice_id uuid;
begin
  if new.conversation_required or new.fee_cents <= 0 then
    update public.late_pickup_events
       set billing_status = 'waived'
     where id = new.id;
    return new;
  end if;

  select invoice.id into v_invoice_id
    from public.family_children link
    join public.invoices invoice on invoice.family_id = link.family_id
   where link.child_id = new.child_id
     and invoice.daycare_id = new.daycare_id
     and invoice.status in ('draft', 'open')
   order by invoice.issued_on desc nulls last, invoice.created_at desc
   limit 1;
  if v_invoice_id is not null then
    perform public.attach_late_pickup_fee_to_invoice(new.id, v_invoice_id);
  end if;
  return new;
end;
$$;

drop trigger if exists late_pickup_events_route_fee on public.late_pickup_events;
create trigger late_pickup_events_route_fee
  after insert on public.late_pickup_events
  for each row execute function public.route_late_pickup_fee();

create or replace function public.attach_pending_late_pickup_fees()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
begin
  if new.family_id is null or new.status not in ('draft', 'open') or new.total_cents <= 0 then
    return new;
  end if;
  for v_event_id in
    select event.id
      from public.late_pickup_events event
      join public.family_children link on link.child_id = event.child_id
     where link.family_id = new.family_id
       and event.daycare_id = new.daycare_id
       and event.billing_status = 'pending'
       and event.fee_cents > 0
     order by event.occurred_on, event.created_at
  loop
    perform public.attach_late_pickup_fee_to_invoice(v_event_id, new.id);
  end loop;
  return new;
end;
$$;

drop trigger if exists invoices_attach_pending_late_pickup_fees on public.invoices;
create trigger invoices_attach_pending_late_pickup_fees
  after update of total_cents, status on public.invoices
  for each row
  when (new.status in ('draft', 'open') and new.total_cents > 0)
  execute function public.attach_pending_late_pickup_fees();

revoke all on function public.attach_late_pickup_fee_to_invoice(uuid, uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
