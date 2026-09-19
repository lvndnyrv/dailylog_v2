-- Group 2f -> Billing: first-day invoices consume each enrollment payment once
-- and preserve excess deposit credit for the next tuition period.
begin;
set local statement_timeout = '30s';

create function pg_temp.impersonate(p_role text, p_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('role', p_role, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', p_id, 'role', p_role)::text,
    true
  );
end;
$$;

do $$
declare
  center uuid := '10000000-0000-4000-a000-000000000001';
  owner_id uuid := '00000000-0000-4000-a000-000000000001';
  parent_id uuid := gen_random_uuid();
  room_id uuid;
  partial_child_id uuid;
  prepaid_child_id uuid;
  partial_enrollment_id uuid;
  prepaid_enrollment_id uuid;
  partial_offer_payment_id uuid;
  prepaid_offer_payment_id uuid;
  partial_schedule_id uuid;
  prepaid_schedule_id uuid;
  partial_invoice_id uuid;
  prepaid_invoice_id uuid;
  v_family_id uuid;
  generated integer;
  row_count integer;
  notice_count integer;
  member_count integer;
  remaining_due integer;
  failed boolean := false;
begin
  perform pg_temp.impersonate('postgres', owner_id);
  insert into public.classrooms (
    daycare_id, name, min_age_months, max_age_months, capacity,
    ratio_children_per_educator
  ) values (center, 'Rollback first invoice room', 18, 72, 12, 6)
  returning id into room_id;

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    parent_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated', 'first-invoice-parent-' || parent_id || '@dailylog.invalid', '', now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Rollback First Invoice Parent"}', now(), now()
  );
  update public.profiles set role = 'parent', daycare_id = center where id = parent_id;

  insert into public.children (
    daycare_id, classroom_id, first_name, last_name, date_of_birth, enrolled_on
  ) values (
    center, room_id, 'Partial', 'Credit', public.center_today() - 1200, public.center_today()
  ) returning id into partial_child_id;
  insert into public.children (
    daycare_id, classroom_id, first_name, last_name, date_of_birth, enrolled_on
  ) values (
    center, room_id, 'Prepaid', 'Credit', public.center_today() - 1200, public.center_today()
  ) returning id into prepaid_child_id;
  insert into public.parent_children(parent_id, child_id, relationship, is_primary)
  values (parent_id, partial_child_id, 'Parent', true),
         (parent_id, prepaid_child_id, 'Parent', true);
  select family_child.family_id into v_family_id
    from public.family_children family_child where family_child.child_id = partial_child_id;
  if v_family_id is null then raise exception 'FAIL: parent/child family was not created'; end if;

  insert into public.enrollments (
    daycare_id, child_id, classroom_id, child_first_name, child_last_name,
    child_date_of_birth, guardian_name, guardian_email, stage,
    desired_start_date, offer_status, offer_tuition_cents, offer_deposit_cents
  ) values (
    center, partial_child_id, room_id, 'Partial', 'Credit', public.center_today() - 1200,
    'First Invoice Family', 'first-invoice-parent-' || parent_id || '@dailylog.invalid',
    'offer', public.center_today(), 'accepted', 118000, 50000
  ) returning id into partial_enrollment_id;
  insert into public.enrollment_offer_payments (
    enrollment_id, daycare_id, amount_cents, currency, provider,
    provider_reference, status, include_first_month, settled_at
  ) values (
    partial_enrollment_id, center, 50000, 'CAD', 'demo',
    'rollback-partial-credit', 'succeeded', false, now()
  ) returning id into partial_offer_payment_id;
  update public.enrollments
     set stage = 'enrolled', deposit_status = 'paid',
         deposit_payment_id = partial_offer_payment_id, parent_account_linked_at = now()
   where id = partial_enrollment_id;

  select schedule.id into partial_schedule_id
    from public.enrollment_billing_schedules schedule
   where schedule.enrollment_id = partial_enrollment_id
     and schedule.family_id = v_family_id
     and schedule.remaining_credit_cents = 50000
     and schedule.next_invoice_on = public.center_today();
  if partial_schedule_id is null then
    raise exception 'FAIL: partial-deposit billing schedule was not created';
  end if;

  insert into public.enrollments (
    daycare_id, child_id, classroom_id, child_first_name, child_last_name,
    child_date_of_birth, guardian_name, guardian_email, stage,
    desired_start_date, offer_status, offer_tuition_cents, offer_deposit_cents
  ) values (
    center, prepaid_child_id, room_id, 'Prepaid', 'Credit', public.center_today() - 1200,
    'First Invoice Family', 'first-invoice-parent-' || parent_id || '@dailylog.invalid',
    'offer', public.center_today(), 'accepted', 118000, 50000
  ) returning id into prepaid_enrollment_id;
  insert into public.enrollment_offer_payments (
    enrollment_id, daycare_id, amount_cents, currency, provider,
    provider_reference, status, include_first_month, settled_at
  ) values (
    prepaid_enrollment_id, center, 168000, 'CAD', 'demo',
    'rollback-prepaid-credit', 'succeeded', true, now()
  ) returning id into prepaid_offer_payment_id;
  update public.enrollments
     set stage = 'enrolled', deposit_status = 'paid',
         deposit_payment_id = prepaid_offer_payment_id, parent_account_linked_at = now()
   where id = prepaid_enrollment_id;
  select schedule.id into prepaid_schedule_id
    from public.enrollment_billing_schedules schedule
   where schedule.enrollment_id = prepaid_enrollment_id
     and schedule.remaining_credit_cents = 168000;
  if prepaid_schedule_id is null then
    raise exception 'FAIL: prepaid-month billing schedule was not created';
  end if;

  perform pg_temp.impersonate('authenticated', owner_id);
  generated := public.process_due_enrollment_invoices(center);
  if generated <> 2 then raise exception 'FAIL: generated % first invoices, expected 2', generated; end if;

  select invoice.id into partial_invoice_id
    from public.invoices invoice
   where invoice.enrollment_billing_schedule_id = partial_schedule_id
     and invoice.service_period_start = public.center_today();
  if partial_invoice_id is null then raise exception 'FAIL: partial-credit invoice missing'; end if;
  if not exists (
    select 1 from public.invoices invoice
     where invoice.id = partial_invoice_id and invoice.total_cents = 118000 and invoice.status = 'open'
  ) then raise exception 'FAIL: partial-credit invoice total/status is wrong'; end if;
  if not exists (
    select 1 from public.payments payment
     where payment.invoice_id = partial_invoice_id and payment.family_id = v_family_id
       and payment.amount_cents = 50000 and payment.status = 'succeeded'
       and payment.external_ref = 'enrollment-credit:' || partial_schedule_id || ':' || public.center_today()
  ) then raise exception 'FAIL: deposit was not applied to the first invoice'; end if;
  if not exists (
    select 1 from public.family_ledger_entries entry
     where entry.family_id = v_family_id and entry.source_invoice_id = partial_invoice_id
       and entry.entry_type = 'invoice' and entry.amount_cents = 118000
  ) or not exists (
    select 1 from public.family_ledger_entries entry
     join public.payments payment on payment.id = entry.source_payment_id
     where payment.invoice_id = partial_invoice_id and entry.entry_type = 'payment'
       and entry.amount_cents = -50000
  ) then raise exception 'FAIL: invoice/deposit did not reach the family ledger'; end if;

  select invoice.id into prepaid_invoice_id
    from public.invoices invoice
   where invoice.enrollment_billing_schedule_id = prepaid_schedule_id
     and invoice.service_period_start = public.center_today();
  if prepaid_invoice_id is null then raise exception 'FAIL: prepaid first invoice missing'; end if;
  if not exists (
    select 1 from public.invoices invoice where invoice.id = prepaid_invoice_id and invoice.status = 'paid'
  ) then raise exception 'FAIL: prepaid first month was charged again'; end if;
  if not exists (
    select 1 from public.enrollment_billing_schedules schedule
     where schedule.id = prepaid_schedule_id and schedule.remaining_credit_cents = 50000
       and schedule.status = 'active' and schedule.next_invoice_on > public.center_today()
  ) then raise exception 'FAIL: remaining deposit credit did not carry forward'; end if;

  generated := public.process_due_enrollment_invoices(center);
  if generated <> 0 then raise exception 'FAIL: retry generated % duplicate invoices', generated; end if;
  select count(*) into row_count from public.invoices
   where enrollment_billing_schedule_id in (partial_schedule_id, prepaid_schedule_id);
  if row_count <> 2 then raise exception 'FAIL: retry left % invoices, expected 2', row_count; end if;

  perform pg_temp.impersonate('postgres', owner_id);
  select count(*) into notice_count from public.notifications notice
   where notice.profile_id = parent_id and notice.payload->>'invoiceId' = partial_invoice_id::text;
  select count(*) into member_count from public.family_members member
   where member.family_id = v_family_id and member.receives_billing;
  select invoice.total_cents - coalesce(sum(payment.amount_cents)
    filter (where payment.status = 'succeeded'), 0)::integer
    into remaining_due
    from public.invoices invoice
    left join public.payments payment on payment.invoice_id = invoice.id
   where invoice.id = partial_invoice_id group by invoice.total_cents;
  if notice_count = 0 then
    raise exception 'FAIL: family was not notified about the balance-due invoice (members %, due %)', member_count, remaining_due;
  end if;
  if exists (
    select 1 from public.notifications notice
     where notice.profile_id = parent_id and notice.payload->>'invoiceId' = prepaid_invoice_id::text
  ) then raise exception 'FAIL: family was told a fully prepaid invoice was due'; end if;

  perform pg_temp.impersonate('authenticated', parent_id);
  select count(*) into row_count from public.enrollment_billing_schedules
   where id in (partial_schedule_id, prepaid_schedule_id);
  if row_count <> 2 then raise exception 'FAIL: parent saw % of 2 family billing schedules', row_count; end if;
  failed := false;
  begin
    perform public.process_due_enrollment_invoices(center);
  exception when others then failed := true;
  end;
  if not failed then raise exception 'FAIL: parent invoked invoice worker'; end if;

  perform pg_temp.impersonate('postgres', owner_id);
  if not exists (select 1 from cron.job where jobname = 'dailylog-enrollment-invoices') then
    raise exception 'FAIL: enrollment invoice worker is not scheduled';
  end if;
end;
$$;

rollback;
select 'PASS: first-day invoices are generated once, deposits/prepaid tuition are applied exactly once, excess credit carries, ledger and family notices agree, and the worker is protected; rolled back' result;
