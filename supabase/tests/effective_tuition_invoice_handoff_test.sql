-- Effective tuition rates drive new recurring invoices without billing a
-- merely planned change early. All fixtures roll back.
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
  planned_child_id uuid;
  effective_child_id uuid;
  planned_enrollment_id uuid;
  effective_enrollment_id uuid;
  planned_schedule_id uuid;
  effective_schedule_id uuid;
  generated integer;
begin
  perform pg_temp.impersonate('postgres', owner_id);
  insert into public.classrooms (
    daycare_id, name, min_age_months, max_age_months, capacity,
    ratio_children_per_educator
  ) values (center, 'Rollback effective invoice room', 18, 72, 12, 6)
  returning id into room_id;

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    parent_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated', 'effective-invoice-' || parent_id || '@dailylog.invalid', '', now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Rollback Effective Invoice Parent"}', now(), now()
  );
  update public.profiles set role = 'parent', daycare_id = center where id = parent_id;

  insert into public.children (
    daycare_id, classroom_id, first_name, last_name, date_of_birth, enrolled_on
  ) values (
    center, room_id, 'Planned', 'Rate', public.center_today() - 1200, public.center_today()
  ) returning id into planned_child_id;
  insert into public.children (
    daycare_id, classroom_id, first_name, last_name, date_of_birth, enrolled_on
  ) values (
    center, room_id, 'Effective', 'Rate', public.center_today() - 1200, public.center_today()
  ) returning id into effective_child_id;
  insert into public.parent_children(parent_id, child_id, relationship, is_primary)
  values (parent_id, planned_child_id, 'Parent', true),
         (parent_id, effective_child_id, 'Parent', true);

  insert into public.enrollments (
    daycare_id, child_id, classroom_id, child_first_name, child_last_name,
    child_date_of_birth, guardian_name, guardian_email, stage,
    desired_start_date, offer_status, offer_tuition_cents, offer_deposit_cents,
    deposit_status, parent_account_linked_at
  ) values (
    center, planned_child_id, room_id, 'Planned', 'Rate', public.center_today() - 1200,
    'Effective Rate Family', 'effective-invoice-' || parent_id || '@dailylog.invalid',
    'enrolled', public.center_today(), 'accepted', 128000, 0, 'paid', now()
  ) returning id into planned_enrollment_id;
  insert into public.enrollments (
    daycare_id, child_id, classroom_id, child_first_name, child_last_name,
    child_date_of_birth, guardian_name, guardian_email, stage,
    desired_start_date, offer_status, offer_tuition_cents, offer_deposit_cents,
    deposit_status, parent_account_linked_at
  ) values (
    center, effective_child_id, room_id, 'Effective', 'Rate', public.center_today() - 1200,
    'Effective Rate Family', 'effective-invoice-' || parent_id || '@dailylog.invalid',
    'enrolled', public.center_today(), 'accepted', 128000, 0, 'paid', now()
  ) returning id into effective_enrollment_id;

  select id into planned_schedule_id from public.enrollment_billing_schedules
   where enrollment_id = planned_enrollment_id;
  select id into effective_schedule_id from public.enrollment_billing_schedules
   where enrollment_id = effective_enrollment_id;
  if planned_schedule_id is null or effective_schedule_id is null then
    raise exception 'FAIL: enrollment billing schedules were not created';
  end if;

  -- A future/planned room rate must not alter billing until the move completes.
  insert into public.child_tuition_rates (
    daycare_id, child_id, classroom_id, amount_cents, currency,
    effective_from, status
  ) values (
    center, planned_child_id, room_id, 105000, 'CAD', public.center_today(), 'scheduled'
  );

  -- Mirror the result of completing a transition: close the old rate and make
  -- the new rate effective on this service period's start date.
  update public.child_tuition_rates
     set status = 'cancelled', effective_to = null
   where child_id = effective_child_id and status = 'effective' and effective_to is null;
  insert into public.child_tuition_rates (
    daycare_id, child_id, classroom_id, amount_cents, currency,
    effective_from, status
  ) values (
    center, effective_child_id, room_id, 105000, 'CAD', public.center_today(), 'effective'
  );

  perform pg_temp.impersonate('authenticated', owner_id);
  generated := public.process_due_enrollment_invoices(center);
  if generated <> 2 then
    raise exception 'FAIL: generated % invoices, expected 2', generated;
  end if;

  if not exists (
    select 1 from public.invoices invoice
     where invoice.enrollment_billing_schedule_id = planned_schedule_id
       and invoice.service_period_start = public.center_today()
       and invoice.total_cents = 128000
  ) then
    raise exception 'FAIL: a merely scheduled tuition rate was billed early';
  end if;
  if not exists (
    select 1 from public.invoices invoice
     join public.invoice_lines line on line.invoice_id = invoice.id
     where invoice.enrollment_billing_schedule_id = effective_schedule_id
       and invoice.service_period_start = public.center_today()
       and invoice.total_cents = 105000
       and line.amount_cents = 105000
  ) then
    raise exception 'FAIL: the effective transition rate did not reach the new invoice';
  end if;
  if not exists (
    select 1 from public.enrollment_billing_schedules schedule
     where schedule.id = effective_schedule_id and schedule.amount_cents = 105000
  ) then
    raise exception 'FAIL: the recurring schedule did not advance to the effective rate';
  end if;
  if (select onboarding_steps->>'billing_amount_cents'
        from public.enrollments where id = effective_enrollment_id) <> '105000' then
    raise exception 'FAIL: enrollment billing state did not reflect the effective rate';
  end if;

  generated := public.process_due_enrollment_invoices(center);
  if generated <> 0 then
    raise exception 'FAIL: retry generated % duplicate invoices', generated;
  end if;
end;
$$;

rollback;
select 'PASS: planned tuition stays unbilled, effective transition tuition reaches the correct future invoice and schedule, and retries remain idempotent; rolled back' result;
