-- Parent Mobile Group 25: durable receipts, real email-outbox delivery, and a
-- secure app-link recovery path. Payment processing remains demo-only until a
-- production provider settles charges server-side.

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
  where payment.id = p_payment_id and payment.status = 'succeeded';

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
    where method.id = v_payment.payment_method_id
      and method.family_id = v_payment.family_id;
  end if;

  select outbox.status into v_email_status
  from public.notification_outbox outbox
  where outbox.dedupe_key = 'parent-payment-receipt:' || v_payment.id
    and outbox.channel = 'email'
  order by outbox.created_at desc
  limit 1;

  return jsonb_build_object(
    'payment_id', v_payment.id,
    'invoice_id', v_invoice.id,
    'invoice_number', v_invoice.number,
    'invoice_label', to_char(coalesce(v_invoice.issued_on, current_date), 'FMMonth YYYY'),
    'amount_cents', v_payment.amount_cents,
    'currency', v_payment.currency,
    'paid_at', v_payment.paid_at,
    'receipt_number', v_payment.receipt_number,
    'receipt_email', v_payment.receipt_emailed_to,
    'email_status', coalesce(
      v_email_status,
      case when v_payment.receipt_emailed_to is null then 'not_requested' else 'not_queued' end
    ),
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

-- The billing trigger sets this transaction-local marker only after validating
-- an exact outstanding-balance payment made with a family-owned demo method.
-- Permit only the matching receipt email through the central outbox trigger.
create or replace function public.enforce_notification_enqueue_permission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_area text;
  v_marker text;
  v_family_id uuid;
  v_payment_id uuid;
begin
  if auth.role() = 'service_role' or (auth.uid() is null and auth.role() is null) then
    return new;
  end if;

  if auth.role() = 'anon' and new.kind in (
    'enrollment_inquiry_received', 'tour_confirmation', 'waitlist_confirmation'
  ) then
    return new;
  end if;

  if auth.uid() is not null and new.kind = 'parent_payment_receipt'
     and new.channel = 'email' and new.recipient_id is null then
    v_marker := current_setting('dailylog.parent_demo_payment_family', true);
    begin
      v_family_id := nullif(new.payload->>'familyId', '')::uuid;
      v_payment_id := nullif(new.payload->>'paymentId', '')::uuid;
    exception when invalid_text_representation then
      v_family_id := null;
      v_payment_id := null;
    end;

    if v_marker = v_family_id::text
       and coalesce(public.can_manage_family_billing(v_family_id), false)
       and exists (
         select 1
         from public.payments payment
         where payment.id = v_payment_id
           and payment.family_id = v_family_id
           and payment.status = 'succeeded'
           and lower(payment.receipt_emailed_to) = lower(new.recipient_email)
       ) then
      return new;
    end if;
  end if;

  v_area := case
    when new.kind in (
      'enrollment_inquiry_received', 'tour_confirmation', 'enrollment_application',
      'enrollment_documents', 'waitlist_offer', 'offer_reminder',
      'offer_withdrawn', 'inquiry_closed', 'waitlist_checkin',
      'waitlist_confirmation', 'waitlist_position_changed'
    ) then 'enrollment'
    when new.kind = 'announcement' then 'broadcasts'
    when new.kind = 'incident' then 'incidents'
    when new.kind = 'medication' then 'medications'
    when new.kind in ('invoice', 'payment', 'parent_payment_receipt') then 'billing'
    when new.kind = 'staff_invite' then 'staff'
    when new.kind = 'parent_invite' then 'children'
    else 'daily_logs'
  end;
  if not public.has_permission(v_area, 'edit') then
    raise exception '% edit permission required', v_area;
  end if;
  return new;
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
  if v_invoice.id is null
     or v_invoice.family_id is null
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
    if v_payment.payment_method_id is not null then
      select * into v_method from public.family_payment_methods
      where id = v_payment.payment_method_id and family_id = v_invoice.family_id;
    end if;
  else
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
    update public.invoices set status = 'paid', updated_at = now() where id = v_invoice.id;
  end if;

  -- The idempotent retry path did not insert a payment in this transaction, so
  -- restore the same narrowly scoped marker before the deduplicated email row.
  perform set_config('dailylog.parent_demo_payment_family', v_invoice.family_id::text, true);

  if v_payment.receipt_emailed_to is not null then
    insert into public.notification_outbox (
      daycare_id, recipient_email, channel, kind, title, body, payload, dedupe_key
    ) values (
      v_invoice.daycare_id,
      v_payment.receipt_emailed_to,
      'email',
      'parent_payment_receipt',
      'Payment receipt ' || coalesce(v_payment.receipt_number, v_invoice.number),
      'We received your payment of ' || v_payment.currency || ' '
        || to_char(v_payment.amount_cents / 100.0, 'FM9999990.00')
        || ' for invoice ' || v_invoice.number || E'.\n\nView your receipt securely in DailyLog: dailylog://receipt?payment_id='
        || v_payment.id,
      jsonb_build_object(
        'type', 'parent_payment_receipt',
        'screen', 'PaymentReceipt',
        'paymentId', v_payment.id,
        'invoiceId', v_invoice.id,
        'familyId', v_invoice.family_id,
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

revoke all on function public.get_parent_payment_receipt(uuid) from public;
revoke all on function public.complete_demo_parent_invoice_payment(uuid, uuid) from public;
grant execute on function public.get_parent_payment_receipt(uuid) to authenticated;
grant execute on function public.complete_demo_parent_invoice_payment(uuid, uuid) to authenticated;
