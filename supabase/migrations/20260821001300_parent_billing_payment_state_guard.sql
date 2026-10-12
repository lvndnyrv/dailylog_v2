-- Restore payment-method expiry validation after the Group 25 receipt rewrite
-- and prevent draft or void invoices from entering the payment workflow.

create or replace function public.complete_demo_parent_invoice_payment(
  p_invoice_id uuid,
  p_payment_method_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.invoices%rowtype;
  v_method public.family_payment_methods%rowtype;
  v_payment public.payments%rowtype;
  v_paid int;
  v_due int;
  v_email text;
  v_receipt text;
begin
  if auth.uid() is null then raise exception 'Sign in to pay an invoice'; end if;

  select * into v_invoice
  from public.invoices
  where id = p_invoice_id
  for update;

  if v_invoice.id is null or v_invoice.family_id is null
     or not coalesce(public.can_manage_family_billing(v_invoice.family_id), false) then
    raise exception 'Invoice not found';
  end if;

  select coalesce(sum(amount_cents), 0)::int into v_paid
  from public.payments
  where invoice_id = v_invoice.id and status = 'succeeded';
  v_due := greatest(v_invoice.total_cents - v_paid, 0);

  -- A retry after a successful transaction returns the durable receipt rather
  -- than creating a second charge.
  if v_due = 0 or v_invoice.status = 'paid' then
    select * into v_payment
    from public.payments
    where invoice_id = v_invoice.id and status = 'succeeded'
    order by paid_at desc
    limit 1;
    if v_payment.id is null then raise exception 'This invoice is already settled'; end if;
    return public.get_parent_payment_receipt(v_payment.id);
  end if;

  if v_invoice.status not in ('open', 'overdue') then
    raise exception 'This invoice is not available for payment';
  end if;

  select * into v_method
  from public.family_payment_methods
  where id = p_payment_method_id
    and family_id = v_invoice.family_id
    and status = 'active';
  if v_method.id is null then raise exception 'Payment method not found'; end if;
  if v_method.provider <> 'demo' then
    raise exception 'This payment method must be confirmed by the configured payment provider';
  end if;
  if v_method.method_type = 'card'
     and (
       v_method.expiry_month is null
       or v_method.expiry_year is null
       or (make_date(v_method.expiry_year, v_method.expiry_month, 1) + interval '1 month')::date <= current_date
     ) then
    raise exception 'This card has expired. Choose another payment method';
  end if;

  if coalesce(v_method.provider_payment_method_ref, '') like 'demo_decline_%' then
    insert into public.payments (
      daycare_id, family_id, invoice_id, paid_by, amount_cents, currency,
      method, status, external_ref, payment_method_id, paid_at
    ) values (
      v_invoice.daycare_id, v_invoice.family_id, v_invoice.id, auth.uid(), v_due,
      v_invoice.currency, v_method.method_type, 'failed',
      'demo_decline:insufficient_funds', v_method.id, now()
    ) returning * into v_payment;
    return jsonb_build_object(
      'status', 'failed',
      'payment_id', v_payment.id,
      'invoice_id', v_invoice.id,
      'failure_code', 'insufficient_funds',
      'failure_message', 'This test card was declined. Choose another payment method and try again.'
    );
  end if;

  v_email := coalesce(
    (select billing_email from public.families where id = v_invoice.family_id),
    (select email from public.profiles where id = auth.uid())
  );
  v_receipt := 'DL-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into public.payments (
    daycare_id, family_id, invoice_id, paid_by, amount_cents, currency,
    method, status, external_ref, payment_method_id, receipt_number,
    receipt_emailed_to, paid_at
  ) values (
    v_invoice.daycare_id, v_invoice.family_id, v_invoice.id, auth.uid(), v_due,
    v_invoice.currency, v_method.method_type, 'succeeded',
    'demo_' || replace(gen_random_uuid()::text, '-', ''), v_method.id,
    v_receipt, v_email, now()
  ) returning * into v_payment;

  perform set_config('dailylog.parent_demo_payment_family', v_invoice.family_id::text, true);
  if v_payment.receipt_emailed_to is not null then
    insert into public.notification_outbox (
      daycare_id, recipient_email, channel, kind, title, body, payload, dedupe_key
    ) values (
      v_invoice.daycare_id, v_payment.receipt_emailed_to, 'email', 'parent_payment_receipt',
      'Payment receipt ' || coalesce(v_payment.receipt_number, v_invoice.number),
      'We received your payment of ' || v_payment.currency || ' '
        || to_char(v_payment.amount_cents / 100.0, 'FM9999990.00')
        || ' for invoice ' || v_invoice.number
        || E'.\n\nView your receipt securely in DailyLog: dailylog://receipt?payment_id=' || v_payment.id,
      jsonb_build_object(
        'type', 'parent_payment_receipt', 'screen', 'PaymentReceipt',
        'paymentId', v_payment.id, 'invoiceId', v_invoice.id,
        'familyId', v_invoice.family_id, 'receiptNumber', v_payment.receipt_number,
        'amountCents', v_payment.amount_cents, 'currency', v_payment.currency
      ),
      'parent-payment-receipt:' || v_payment.id
    ) on conflict do nothing;
  end if;

  return public.get_parent_payment_receipt(v_payment.id);
end;
$$;

revoke all on function public.complete_demo_parent_invoice_payment(uuid, uuid) from public, anon;
grant execute on function public.complete_demo_parent_invoice_payment(uuid, uuid) to authenticated;
