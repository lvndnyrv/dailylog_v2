-- Resettable Parent Mobile Group 21/25 billing demo for Lucia Castillo.
-- Login: lucia.castillo@parent.test / password123

do $$
declare
  v_daycare constant uuid := '10000000-0000-4000-a000-000000000001';
  v_parent constant uuid := '00000000-0000-4000-a000-000000000023';
  v_child constant uuid := '30000000-0000-4000-a000-000000000013';
  v_card constant uuid := '51000000-0000-4000-a000-000000000001';
  v_bank constant uuid := '51000000-0000-4000-a000-000000000002';
  v_declined_card constant uuid := '51000000-0000-4000-a000-000000000003';
  v_open_invoice constant uuid := '52000000-0000-4000-a000-000000000001';
  v_paid_invoice constant uuid := '52000000-0000-4000-a000-000000000002';
  v_older_invoice constant uuid := '52000000-0000-4000-a000-000000000003';
  v_tax_invoice constant uuid := '52000000-0000-4000-a000-000000000004';
  v_family uuid;
  v_month date := date_trunc('month', current_date)::date;
begin
  select member.family_id into v_family
  from public.family_members member
  where member.profile_id = v_parent and member.receives_billing
  order by (member.role = 'primary') desc, member.created_at
  limit 1;

  if v_family is null then
    raise notice 'Skipping Group 21/25 demo: Lucia Castillo family is not seeded';
    return;
  end if;

  update public.families
  set billing_email = 'lucia.castillo@parent.test'
  where id = v_family;

  insert into public.family_payment_methods (
    id, daycare_id, family_id, method_type, brand, last4,
    expiry_month, expiry_year, provider, provider_payment_method_ref, status
  ) values
    (v_card, v_daycare, v_family, 'card', 'Visa', '4242', 4,
      extract(year from current_date)::int + 2, 'demo', 'demo_visa_4242', 'active'),
    (v_bank, v_daycare, v_family, 'bank', 'Checking', '8891', null,
      null, 'demo', 'demo_bank_8891', 'active'),
    (v_declined_card, v_daycare, v_family, 'card', 'Visa test decline', '0002', 12,
      extract(year from current_date)::int + 2, 'demo', 'demo_decline_insufficient_funds', 'active')
  on conflict (id) do update set
    family_id = excluded.family_id,
    expiry_year = excluded.expiry_year,
    provider_payment_method_ref = excluded.provider_payment_method_ref,
    status = 'active',
    updated_at = now();

  insert into public.family_billing_preferences (
    family_id, daycare_id, autopay_enabled, default_payment_method_id, updated_by
  ) values (v_family, v_daycare, true, v_card, v_parent)
  on conflict (family_id) do update set
    autopay_enabled = excluded.autopay_enabled,
    default_payment_method_id = excluded.default_payment_method_id,
    updated_by = excluded.updated_by,
    updated_at = now();

  delete from public.payment_allocations
  where invoice_id in (v_open_invoice, v_paid_invoice, v_older_invoice, v_tax_invoice);
  delete from public.family_ledger_entries
  where source_payment_id in (
    select payment.id from public.payments payment
    where payment.invoice_id in (v_open_invoice, v_paid_invoice, v_older_invoice, v_tax_invoice)
  );
  delete from public.payments
  where invoice_id in (v_open_invoice, v_paid_invoice, v_older_invoice, v_tax_invoice);
  delete from public.family_ledger_entries
  where source_invoice_id in (v_open_invoice, v_paid_invoice, v_older_invoice, v_tax_invoice);
  delete from public.invoice_lines
  where invoice_id in (v_open_invoice, v_paid_invoice, v_older_invoice, v_tax_invoice);
  delete from public.invoices
  where id in (v_open_invoice, v_paid_invoice, v_older_invoice, v_tax_invoice);

  insert into public.invoices (
    id, daycare_id, family_id, child_id, billed_to, number, status,
    issued_on, due_on, subtotal_cents, total_cents, currency
  ) values
    (v_open_invoice, v_daycare, v_family, v_child, v_parent,
      'MOBILE-' || to_char(v_month, 'YYYY-MM') || '-CASTILLO', 'open',
      v_month, current_date + 7, 124000, 124000, 'CAD'),
    (v_paid_invoice, v_daycare, v_family, v_child, v_parent,
      'MOBILE-' || to_char(v_month - interval '1 month', 'YYYY-MM') || '-CASTILLO', 'paid',
      (v_month - interval '1 month')::date, (v_month - interval '1 month' + interval '14 days')::date,
      124000, 124000, 'CAD'),
    (v_older_invoice, v_daycare, v_family, v_child, v_parent,
      'MOBILE-' || to_char(v_month - interval '2 months', 'YYYY-MM') || '-CASTILLO', 'paid',
      (v_month - interval '2 months')::date, (v_month - interval '2 months' + interval '14 days')::date,
      118000, 118000, 'CAD'),
    (v_tax_invoice, v_daycare, v_family, v_child, v_parent,
      'MOBILE-' || (extract(year from current_date)::int - 1) || '-TAX-CASTILLO', 'paid',
      make_date(extract(year from current_date)::int - 1, 12, 1),
      make_date(extract(year from current_date)::int - 1, 12, 15),
      1398000, 1398000, 'CAD');

  insert into public.invoice_lines (
    daycare_id, invoice_id, description, quantity, unit_amount_cents, amount_cents
  ) values
    (v_daycare, v_open_invoice, 'Tuition (' || to_char(v_month, 'Mon 1') || '–' || to_char((v_month + interval '1 month - 1 day')::date, 'DD') || ')', 1, 115000, 115000),
    (v_daycare, v_open_invoice, 'Late pickup (' || to_char(v_month + 1, 'Mon DD') || ')', 1, 2500, 2500),
    (v_daycare, v_open_invoice, 'Field trip — aquarium', 1, 9000, 9000),
    (v_daycare, v_open_invoice, 'Sibling discount', 1, -2500, -2500),
    (v_daycare, v_paid_invoice, 'Monthly tuition · Preschool', 1, 124000, 124000),
    (v_daycare, v_older_invoice, 'Monthly tuition · Preschool', 1, 118000, 118000),
    (v_daycare, v_tax_invoice, (extract(year from current_date)::int - 1) || ' childcare tuition', 1, 1398000, 1398000);

  insert into public.payments (
    id, daycare_id, family_id, invoice_id, paid_by, amount_cents, currency,
    method, status, external_ref, payment_method_id, receipt_number,
    receipt_emailed_to, paid_at, refunded_at, refund_reason
  ) values
    ('53000000-0000-4000-a000-000000000002', v_daycare, v_family, v_paid_invoice,
      v_parent, 124000, 'CAD', 'card', 'succeeded', 'demo_previous_month', v_card,
      'DL-DEMO-PREV', 'lucia.castillo@parent.test', v_month - interval '16 days', null, null),
    ('53000000-0000-4000-a000-000000000003', v_daycare, v_family, v_older_invoice,
      v_parent, 118000, 'CAD', 'bank', 'refunded', 'demo_two_months_ago', v_bank,
      'DL-DEMO-OLDER', 'lucia.castillo@parent.test', v_month - interval '46 days',
      v_month - interval '40 days', 'Schedule changed before care began'),
    ('53000000-0000-4000-a000-000000000004', v_daycare, v_family, v_tax_invoice,
      v_parent, 1398000, 'CAD', 'bank', 'succeeded', 'demo_prior_year', v_bank,
      'DL-DEMO-TAX', 'lucia.castillo@parent.test',
      make_timestamptz(extract(year from current_date)::int - 1, 12, 15, 10, 0, 0, 'America/Toronto'), null, null);

  delete from public.statements
  where id in (
    '54000000-0000-4000-a000-000000000001',
    '54000000-0000-4000-a000-000000000002',
    '54000000-0000-4000-a000-000000000003',
    '54000000-0000-4000-a000-000000000004'
  );
  insert into public.statements (
    id, daycare_id, family_id, child_id, period_start, period_end, total_cents, storage_path
  )
  select
    ('54000000-0000-4000-a000-00000000000' || offset_month)::uuid,
    v_daycare,
    v_family,
    v_child,
    (v_month - make_interval(months => offset_month))::date,
    (v_month - make_interval(months => offset_month - 1) - interval '1 day')::date,
    case offset_month when 1 then 124000 when 2 then 118000 else 115000 end,
    null
  from generate_series(1, 4) as offset_month;
end;
$$;
