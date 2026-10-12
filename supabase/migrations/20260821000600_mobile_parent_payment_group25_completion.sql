-- Parent Mobile Group 25 completion: durable refund receipts, failed-attempt
-- history, invoice reconciliation, and a deterministic decline fixture for QA.

alter table public.payments
  add column if not exists refunded_at timestamptz,
  add column if not exists refund_reason text;

create or replace function public.refresh_invoice_status_from_payments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice_id uuid := coalesce(new.invoice_id, old.invoice_id);
  v_total int;
  v_paid int;
  v_due_on date;
  v_status text;
begin
  if v_invoice_id is null then return coalesce(new, old); end if;

  select total_cents, due_on, status
  into v_total, v_due_on, v_status
  from public.invoices
  where id = v_invoice_id
  for update;

  if v_status is null or v_status in ('draft', 'void') then
    return coalesce(new, old);
  end if;

  select coalesce(sum(amount_cents), 0)::int
  into v_paid
  from public.payments
  where invoice_id = v_invoice_id and status = 'succeeded';

  update public.invoices
  set status = case
      when v_paid >= v_total and v_total > 0 then 'paid'
      when v_due_on < current_date then 'overdue'
      else 'open'
    end,
    updated_at = now()
  where id = v_invoice_id;

  return coalesce(new, old);
end;
$$;

drop trigger if exists payments_refresh_invoice_status on public.payments;
create trigger payments_refresh_invoice_status
  after insert or delete or update of amount_cents, status, invoice_id on public.payments
  for each row execute function public.refresh_invoice_status_from_payments();

create or replace function public.get_parent_invoice_payment_history(p_invoice_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_family_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to view payment history'; end if;

  select family_id into v_family_id
  from public.invoices
  where id = p_invoice_id;
  if v_family_id is null
     or not coalesce(public.can_manage_family_billing(v_family_id), false) then
    raise exception 'Invoice not found';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', payment.id,
      'status', payment.status,
      'amount_cents', payment.amount_cents,
      'currency', payment.currency,
      'paid_at', payment.paid_at,
      'refunded_at', payment.refunded_at,
      'refund_reason', payment.refund_reason,
      'receipt_number', payment.receipt_number,
      'receipt_emailed_to', payment.receipt_emailed_to,
      'payment_method_id', payment.payment_method_id,
      'method', payment.method,
      'failure_code', case
        when payment.status = 'failed' then nullif(split_part(coalesce(payment.external_ref, ''), ':', 2), '')
        else null
      end,
      'payment_method', jsonb_build_object(
        'id', method.id,
        'method_type', coalesce(method.method_type, payment.method),
        'brand', coalesce(method.brand, initcap(payment.method)),
        'last4', method.last4,
        'provider', method.provider
      )
    ) order by coalesce(payment.refunded_at, payment.paid_at, payment.created_at) desc)
    from public.payments payment
    left join public.family_payment_methods method
      on method.id = payment.payment_method_id and method.family_id = payment.family_id
    where payment.invoice_id = p_invoice_id and payment.family_id = v_family_id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.get_parent_payment_receipt(p_payment_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_payment public.payments%rowtype;
  v_invoice public.invoices%rowtype;
  v_method public.family_payment_methods%rowtype;
  v_email_status text;
begin
  if auth.uid() is null then raise exception 'Sign in to view a receipt'; end if;

  select * into v_payment
  from public.payments payment
  where payment.id = p_payment_id and payment.status in ('succeeded', 'refunded');

  if v_payment.id is null or v_payment.family_id is null
     or not coalesce(public.can_manage_family_billing(v_payment.family_id), false) then
    raise exception 'Receipt not found';
  end if;

  select * into v_invoice
  from public.invoices invoice
  where invoice.id = v_payment.invoice_id and invoice.family_id = v_payment.family_id;
  if v_invoice.id is null then raise exception 'Receipt not found'; end if;

  if v_payment.payment_method_id is not null then
    select * into v_method
    from public.family_payment_methods method
    where method.id = v_payment.payment_method_id and method.family_id = v_payment.family_id;
  end if;

  select outbox.status into v_email_status
  from public.notification_outbox outbox
  where outbox.dedupe_key = 'parent-payment-receipt:' || v_payment.id
    and outbox.channel = 'email'
  order by outbox.created_at desc limit 1;

  return jsonb_build_object(
    'payment_id', v_payment.id,
    'status', v_payment.status,
    'invoice_id', v_invoice.id,
    'invoice_number', v_invoice.number,
    'invoice_label', to_char(coalesce(v_invoice.issued_on, current_date), 'FMMonth YYYY'),
    'amount_cents', v_payment.amount_cents,
    'currency', v_payment.currency,
    'paid_at', v_payment.paid_at,
    'refunded_at', v_payment.refunded_at,
    'refund_reason', v_payment.refund_reason,
    'receipt_number', v_payment.receipt_number,
    'receipt_email', v_payment.receipt_emailed_to,
    'email_status', coalesce(v_email_status,
      case when v_payment.receipt_emailed_to is null then 'not_requested' else 'not_queued' end),
    'daycare_name', (select name from public.daycares where id = v_payment.daycare_id),
    'family_name', (select display_name from public.families where id = v_payment.family_id),
    'payment_method', jsonb_build_object(
      'id', v_method.id,
      'method_type', coalesce(v_method.method_type, v_payment.method),
      'brand', coalesce(v_method.brand, initcap(v_payment.method)),
      'last4', v_method.last4,
      'provider', v_method.provider
    )
  );
end;
$$;

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
  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if v_invoice.id is null or v_invoice.family_id is null
     or not coalesce(public.can_manage_family_billing(v_invoice.family_id), false) then
    raise exception 'Invoice not found';
  end if;

  select * into v_method from public.family_payment_methods
  where id = p_payment_method_id and family_id = v_invoice.family_id and status = 'active';
  if v_method.id is null then raise exception 'Payment method not found'; end if;
  if v_method.provider <> 'demo' then
    raise exception 'This payment method must be confirmed by the configured payment provider';
  end if;

  select coalesce(sum(amount_cents), 0)::int into v_paid
  from public.payments where invoice_id = v_invoice.id and status = 'succeeded';
  v_due := greatest(v_invoice.total_cents - v_paid, 0);

  if v_due = 0 or v_invoice.status = 'paid' then
    select * into v_payment from public.payments
    where invoice_id = v_invoice.id and status = 'succeeded'
    order by paid_at desc limit 1;
    if v_payment.id is null then raise exception 'This invoice is already settled'; end if;
    return public.get_parent_payment_receipt(v_payment.id);
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

revoke all on function public.get_parent_invoice_payment_history(uuid) from public;
revoke all on function public.get_parent_payment_receipt(uuid) from public;
revoke all on function public.complete_demo_parent_invoice_payment(uuid, uuid) from public;
grant execute on function public.get_parent_invoice_payment_history(uuid) to authenticated;
grant execute on function public.get_parent_payment_receipt(uuid) to authenticated;
grant execute on function public.complete_demo_parent_invoice_payment(uuid, uuid) to authenticated;
