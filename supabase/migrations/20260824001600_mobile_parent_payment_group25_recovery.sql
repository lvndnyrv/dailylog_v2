-- Parent Mobile Group 25 recovery completion.
--
-- Keep payment attempts bounded, and let an authorized billing guardian retry a
-- receipt email that exhausted the delivery worker's normal retry policy.

alter function public.complete_demo_parent_invoice_payment(uuid, uuid)
  rename to complete_demo_parent_invoice_payment_internal;

revoke all on function public.complete_demo_parent_invoice_payment_internal(uuid, uuid)
  from public, anon, authenticated;

create or replace function public.complete_demo_parent_invoice_payment(
  p_invoice_id uuid,
  p_payment_method_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Sign in to pay an invoice'; end if;

  perform public.assert_rate_limit(
    'parent_invoice_payment',
    12,
    900,
    auth.uid()::text || ':' || coalesce(p_invoice_id::text, 'missing')
  );

  return public.complete_demo_parent_invoice_payment_internal(
    p_invoice_id,
    p_payment_method_id
  );
end;
$$;

revoke all on function public.complete_demo_parent_invoice_payment(uuid, uuid)
  from public, anon;
grant execute on function public.complete_demo_parent_invoice_payment(uuid, uuid)
  to authenticated;

create or replace function public.resend_parent_payment_receipt(p_payment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments%rowtype;
  v_invoice public.invoices%rowtype;
  v_status text;
begin
  if auth.uid() is null then raise exception 'Sign in to resend a receipt'; end if;

  perform public.assert_rate_limit(
    'parent_payment_receipt_resend',
    3,
    3600,
    auth.uid()::text || ':' || coalesce(p_payment_id::text, 'missing')
  );

  select * into v_payment
  from public.payments payment
  where payment.id = p_payment_id
    and payment.status in ('succeeded', 'refunded');

  if v_payment.id is null
     or v_payment.family_id is null
     or not coalesce(public.can_manage_family_billing(v_payment.family_id), false) then
    raise exception 'Receipt not found';
  end if;
  if nullif(btrim(v_payment.receipt_emailed_to), '') is null then
    raise exception 'No receipt email address is available';
  end if;

  select * into v_invoice
  from public.invoices invoice
  where invoice.id = v_payment.invoice_id
    and invoice.family_id = v_payment.family_id;
  if v_invoice.id is null then raise exception 'Receipt not found'; end if;

  select outbox.status into v_status
  from public.notification_outbox outbox
  where outbox.dedupe_key = 'parent-payment-receipt:' || v_payment.id
    and outbox.channel = 'email'
  order by outbox.created_at desc
  limit 1;

  if v_status = 'failed' then
    update public.notification_outbox
    set status = 'pending',
        attempts = 0,
        available_at = now(),
        locked_at = null,
        delivered_at = null,
        last_error = null,
        provider_response = null
    where dedupe_key = 'parent-payment-receipt:' || v_payment.id
      and channel = 'email'
      and status = 'failed';
  elsif v_status is null then
    perform set_config('dailylog.parent_demo_payment_family', v_payment.family_id::text, true);
    insert into public.notification_outbox (
      daycare_id, recipient_email, channel, kind, title, body, payload, dedupe_key
    ) values (
      v_payment.daycare_id,
      v_payment.receipt_emailed_to,
      'email',
      'parent_payment_receipt',
      'Payment receipt ' || coalesce(v_payment.receipt_number, v_invoice.number),
      'We received your payment of ' || v_payment.currency || ' '
        || to_char(v_payment.amount_cents / 100.0, 'FM9999990.00')
        || ' for invoice ' || v_invoice.number
        || E'.\n\nView your receipt securely in DailyLog: dailylog://receipt?payment_id='
        || v_payment.id,
      jsonb_build_object(
        'type', 'parent_payment_receipt',
        'screen', 'PaymentReceipt',
        'paymentId', v_payment.id,
        'invoiceId', v_invoice.id,
        'familyId', v_payment.family_id,
        'receiptNumber', v_payment.receipt_number,
        'amountCents', v_payment.amount_cents,
        'currency', v_payment.currency
      ),
      'parent-payment-receipt:' || v_payment.id
    ) on conflict do nothing;
  end if;

  return public.get_parent_payment_receipt(v_payment.id);
end;
$$;

revoke all on function public.resend_parent_payment_receipt(uuid)
  from public, anon;
grant execute on function public.resend_parent_payment_receipt(uuid)
  to authenticated;

comment on function public.resend_parent_payment_receipt(uuid) is
  'Requeues a failed or missing receipt email for an authorized billing guardian.';
