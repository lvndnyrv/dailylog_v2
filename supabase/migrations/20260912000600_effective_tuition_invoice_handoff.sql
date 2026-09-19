-- Group 7e -> Billing: recurring enrollment invoices resolve the effective
-- child tuition rate for each service period. Planned rates do not bill early,
-- and already-issued invoices remain immutable historical records.

create or replace function public.process_due_enrollment_invoices(
  p_daycare_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_worker boolean := auth.role() = 'service_role'
    or (auth.uid() is null and auth.role() is null);
  v_center_id uuid;
  v_schedule public.enrollment_billing_schedules%rowtype;
  v_family public.families%rowtype;
  v_source_payment public.enrollment_offer_payments%rowtype;
  v_today date;
  v_period_start date;
  v_period_end date;
  v_year text;
  v_invoice_number text;
  v_invoice_id uuid;
  v_payment_id uuid;
  v_invoice_amount integer;
  v_invoice_currency text;
  v_credit integer;
  v_due integer;
  v_created boolean;
  v_iterations integer;
  v_count integer := 0;
begin
  if not v_worker then
    if not public.is_admin() or not public.has_permission('billing', 'edit') then
      raise exception 'Administrator billing edit permission required';
    end if;
    v_center_id := public.get_my_daycare_id();
    if p_daycare_id is not null and p_daycare_id <> v_center_id then
      raise exception 'Cannot generate another center''s invoices';
    end if;
  else
    v_center_id := p_daycare_id;
  end if;

  for v_schedule in
    select schedule.*
      from public.enrollment_billing_schedules schedule
     where schedule.status in ('pending', 'active')
       and (v_center_id is null or schedule.daycare_id = v_center_id)
     order by schedule.daycare_id, schedule.next_invoice_on, schedule.id
     for update skip locked
  loop
    select (now() at time zone coalesce(daycare.timezone, 'UTC'))::date
      into v_today from public.daycares daycare where daycare.id = v_schedule.daycare_id;
    if v_schedule.next_invoice_on > v_today then continue; end if;

    if v_schedule.family_id is null then
      select family_child.family_id into v_schedule.family_id
        from public.family_children family_child
        join public.families family on family.id = family_child.family_id
       where family_child.child_id = v_schedule.child_id
         and family.daycare_id = v_schedule.daycare_id
         and family.archived_at is null
       order by family_child.is_primary desc, family_child.created_at
       limit 1;
      if v_schedule.family_id is null then continue; end if;
      update public.enrollment_billing_schedules
         set family_id = v_schedule.family_id where id = v_schedule.id;
    end if;

    select * into v_family from public.families where id = v_schedule.family_id;
    if v_family.id is null then continue; end if;
    v_source_payment := null;
    if v_schedule.source_payment_id is not null then
      select * into v_source_payment from public.enrollment_offer_payments
       where id = v_schedule.source_payment_id and status = 'succeeded';
    end if;

    v_period_start := v_schedule.next_invoice_on;
    v_iterations := 0;
    while v_period_start <= v_today and v_iterations < 24 loop
      v_iterations := v_iterations + 1;
      v_period_end := public._next_monthly_invoice_date(v_period_start, v_schedule.anchor_day) - 1;
      v_created := false;
      v_invoice_id := null;
      v_payment_id := null;

      -- Only a completed/effective rate can supersede the enrollment amount.
      -- Effective dating also keeps catch-up invoices historically accurate.
      select rate.amount_cents, rate.currency
        into v_invoice_amount, v_invoice_currency
        from public.child_tuition_rates rate
       where rate.child_id = v_schedule.child_id
         and rate.daycare_id = v_schedule.daycare_id
         and rate.status = 'effective'
         and rate.effective_from <= v_period_start
         and (rate.effective_to is null or rate.effective_to >= v_period_start)
       order by rate.effective_from desc, rate.created_at desc
       limit 1;
      if v_invoice_amount is null then
        v_invoice_amount := v_schedule.amount_cents;
        v_invoice_currency := v_schedule.currency;
      end if;

      v_year := to_char(v_today, 'YYYY');
      perform pg_advisory_xact_lock(hashtextextended(v_schedule.daycare_id::text || ':inv:' || v_year, 0));

      select invoice.id into v_invoice_id
        from public.invoices invoice
       where invoice.enrollment_billing_schedule_id = v_schedule.id
         and invoice.service_period_start = v_period_start;
      if v_invoice_id is null then
        select 'INV-' || v_year || '-' || lpad((count(*) + 1)::text, 3, '0')
          into v_invoice_number
          from public.invoices invoice
         where invoice.daycare_id = v_schedule.daycare_id
           and invoice.number like 'INV-' || v_year || '-%';
        insert into public.invoices (
          daycare_id, family_id, child_id, billed_to, number, status,
          issued_on, due_on, subtotal_cents, total_cents, currency,
          enrollment_billing_schedule_id, service_period_start, service_period_end
        ) values (
          v_schedule.daycare_id, v_schedule.family_id, v_schedule.child_id,
          v_family.primary_contact_id, v_invoice_number, 'open', v_today,
          greatest(v_today, v_period_start) + 7, v_invoice_amount,
          v_invoice_amount, v_invoice_currency, v_schedule.id,
          v_period_start, v_period_end
        ) returning id into v_invoice_id;
        insert into public.invoice_lines (
          daycare_id, invoice_id, description, quantity, unit_amount_cents, amount_cents
        ) values (
          v_schedule.daycare_id, v_invoice_id,
          'Tuition · ' || to_char(v_period_start, 'FMMonth YYYY'),
          1, v_invoice_amount, v_invoice_amount
        );
        v_created := true;
      end if;

      v_credit := least(v_schedule.remaining_credit_cents, v_invoice_amount);
      if v_credit > 0 then
        insert into public.payments (
          daycare_id, family_id, invoice_id, paid_by, amount_cents, currency,
          method, status, external_ref, paid_at
        ) values (
          v_schedule.daycare_id, v_schedule.family_id, v_invoice_id,
          v_family.primary_contact_id, v_credit, v_invoice_currency, 'card',
          'succeeded', 'enrollment-credit:' || v_schedule.id || ':' || v_period_start,
          coalesce(v_source_payment.settled_at, now())
        ) on conflict (external_ref) where external_ref like 'enrollment-credit:%'
        do nothing returning id into v_payment_id;
        if v_payment_id is not null then
          v_schedule.remaining_credit_cents := v_schedule.remaining_credit_cents - v_credit;
        end if;
      end if;

      select greatest(invoice.total_cents - coalesce(sum(payment.amount_cents)
        filter (where payment.status = 'succeeded'), 0), 0)::integer
        into v_due
        from public.invoices invoice
        left join public.payments payment on payment.invoice_id = invoice.id
       where invoice.id = v_invoice_id
       group by invoice.total_cents;

      if v_created and v_due > 0 then
        insert into public.notifications(daycare_id, profile_id, kind, title, body, payload)
        select v_schedule.daycare_id, member.profile_id, 'invoice',
               'Tuition invoice available',
               format('%s is due by %s.', to_char(v_due / 100.0, 'FML999G999G990D00'), to_char(greatest(v_today, v_period_start) + 7, 'FMMonth FMDD')),
               jsonb_build_object('type', 'billing_invoice', 'invoiceId', v_invoice_id)
          from public.family_members member
         where member.family_id = v_schedule.family_id and member.receives_billing
           and not exists (
             select 1 from public.notifications notice
              where notice.profile_id = member.profile_id
                and notice.payload->>'invoiceId' = v_invoice_id::text
           );
        insert into public.notification_outbox(
          daycare_id, recipient_id, channel, kind, title, body, payload, dedupe_key
        )
        select v_schedule.daycare_id, member.profile_id, 'push', 'invoice',
               'Tuition invoice available',
               format('%s is due.', to_char(v_due / 100.0, 'FML999G999G990D00')),
               jsonb_build_object('type', 'billing_invoice', 'invoiceId', v_invoice_id),
               'enrollment-invoice:' || v_invoice_id
          from public.family_members member
         where member.family_id = v_schedule.family_id and member.receives_billing
        on conflict do nothing;
        if nullif(btrim(coalesce(v_family.billing_email, '')), '') is not null then
          insert into public.notification_outbox(
            daycare_id, recipient_email, channel, kind, title, body, payload, dedupe_key
          ) values (
            v_schedule.daycare_id, lower(btrim(v_family.billing_email)), 'email', 'invoice',
            'Tuition invoice available',
            format('%s is due by %s.', to_char(v_due / 100.0, 'FML999G999G990D00'), to_char(greatest(v_today, v_period_start) + 7, 'FMMonth FMDD, YYYY')),
            jsonb_build_object('type', 'billing_invoice', 'invoiceId', v_invoice_id),
            'enrollment-invoice:' || v_invoice_id
          ) on conflict do nothing;
        end if;
      end if;

      v_schedule.last_invoice_id := v_invoice_id;
      v_schedule.next_invoice_on := public._next_monthly_invoice_date(v_period_start, v_schedule.anchor_day);
      v_schedule.amount_cents := v_invoice_amount;
      v_schedule.currency := v_invoice_currency;
      v_schedule.status := 'active';
      update public.enrollment_billing_schedules
         set last_invoice_id = v_schedule.last_invoice_id,
             next_invoice_on = v_schedule.next_invoice_on,
             amount_cents = v_schedule.amount_cents,
             currency = v_schedule.currency,
             remaining_credit_cents = v_schedule.remaining_credit_cents,
             status = 'active'
       where id = v_schedule.id;
      update public.enrollments
         set onboarding_steps = coalesce(onboarding_steps, '{}'::jsonb)
           || jsonb_build_object(
             'billing_status', 'effective',
             'billing_amount_cents', v_invoice_amount,
             'first_invoice_id', coalesce(onboarding_steps->>'first_invoice_id', v_invoice_id::text),
             'billing_next_invoice_on', v_schedule.next_invoice_on,
             'billing_credit_remaining_cents', v_schedule.remaining_credit_cents
           )
       where id = v_schedule.enrollment_id;
      v_period_start := v_schedule.next_invoice_on;
      if v_created then v_count := v_count + 1; end if;
    end loop;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.process_due_enrollment_invoices(uuid)
  from public, anon;
grant execute on function public.process_due_enrollment_invoices(uuid)
  to authenticated, service_role;

notify pgrst, 'reload schema';
