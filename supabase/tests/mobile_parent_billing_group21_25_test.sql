-- Parent Mobile Group 21/25 billing security and payment workflow tests.
-- Requires the standard demo seed and rolls every mutation back.
begin;

create or replace function pg_temp.impersonate(p_role text, p_user_id uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('role', p_role, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id, 'role', p_role)::text,
    true
  );
end;
$$;

do $$
declare
  v_parent constant uuid := '00000000-0000-4000-a000-000000000023';
  v_invoice constant uuid := '52000000-0000-4000-a000-000000000001';
  v_method constant uuid := '51000000-0000-4000-a000-000000000001';
  v_declined_method constant uuid := '51000000-0000-4000-a000-000000000003';
  v_refunded_payment constant uuid := '53000000-0000-4000-a000-000000000003';
  v_home jsonb;
  v_detail jsonb;
  v_first jsonb;
  v_second jsonb;
  v_receipt jsonb;
  v_resend jsonb;
  v_decline jsonb;
  v_foreign uuid;
  v_foreign_payment uuid;
  v_count int;
  v_failed boolean := false;
begin
  perform pg_temp.impersonate('authenticated', v_parent);

  begin
    insert into public.family_payment_methods (
      daycare_id, family_id, method_type, brand, last4, provider
    ) values (
      '10000000-0000-4000-a000-000000000001',
      (select family_id from public.family_members where profile_id = v_parent limit 1),
      'card', 'Unsafe direct card', '9999', 'demo'
    );
  exception when others then
    v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL: parent directly inserted a payment method'; end if;
  raise notice 'PASS: payment methods are read-only outside secure server workflows';

  v_home := public.get_parent_billing_home();
  if (v_home->>'current_balance_cents')::int <> 242000
     or jsonb_array_length(v_home->'payment_methods') <> 3 then
    raise exception 'FAIL: family billing home is incomplete: %', v_home;
  end if;
  raise notice 'PASS: family-scoped balance, invoices and payment methods load';

  v_detail := public.get_parent_billing_invoice(v_invoice);
  if jsonb_array_length(v_detail->'lines') <> 4
     or (v_detail->>'balance_cents')::int <> 124000 then
    raise exception 'FAIL: itemized invoice is incomplete: %', v_detail;
  end if;
  raise notice 'PASS: itemized invoice returns the exact outstanding balance';

  perform pg_temp.impersonate('postgres');
  select invoice.id into v_foreign
  from public.invoices invoice
  where invoice.family_id is not null
    and invoice.family_id <> (v_home->>'family_id')::uuid
  limit 1;
  perform pg_temp.impersonate('authenticated', v_parent);
  if v_foreign is not null then
    v_failed := false;
    begin
      perform public.get_parent_billing_invoice(v_foreign);
    exception when others then
      v_failed := true;
    end;
    if not v_failed then raise exception 'FAIL: cross-family invoice was exposed'; end if;
  end if;
  raise notice 'PASS: cross-family invoice access is rejected';

  v_decline := public.complete_demo_parent_invoice_payment(v_invoice, v_declined_method);
  if v_decline->>'status' <> 'failed'
     or v_decline->>'failure_code' <> 'insufficient_funds'
     or not exists (
       select 1 from public.payments
       where id = (v_decline->>'payment_id')::uuid
         and invoice_id = v_invoice and status = 'failed'
     ) then
    raise exception 'FAIL: deterministic decline was not recorded safely: %', v_decline;
  end if;
  if exists (
    select 1 from public.notification_outbox
    where dedupe_key = 'parent-payment-receipt:' || (v_decline->>'payment_id')
  ) then
    raise exception 'FAIL: failed payment queued a receipt';
  end if;
  raise notice 'PASS: declined payment remains unpaid, visible, and retryable without a receipt';

  v_first := public.complete_demo_parent_invoice_payment(v_invoice, v_method);
  v_second := public.complete_demo_parent_invoice_payment(v_invoice, v_method);
  if v_first->>'payment_id' is null
     or v_first->>'payment_id' <> v_second->>'payment_id'
     or (v_first->>'amount_cents')::int <> 124000
     or v_first->>'email_status' <> 'pending' then
    raise exception 'FAIL: payment retry was not exact and idempotent';
  end if;

  -- Email-address recipients intentionally cannot read the internal outbox via
  -- RLS. Inspect it as the database owner, then return to the parent session.
  perform pg_temp.impersonate('postgres');
  select count(*) into v_count
  from public.notification_outbox outbox
  where outbox.dedupe_key = 'parent-payment-receipt:' || (v_first->>'payment_id')
    and outbox.kind = 'parent_payment_receipt'
    and outbox.recipient_email = 'lucia.castillo@parent.test'
    and outbox.body like ('%dailylog://receipt?payment_id=' || (v_first->>'payment_id') || '%');
  if v_count <> 1 then
    select coalesce(jsonb_agg(jsonb_build_object(
      'dedupe_key', outbox.dedupe_key,
      'kind', outbox.kind,
      'recipient_email', outbox.recipient_email,
      'body', outbox.body
    )), '[]'::jsonb) into v_detail
    from public.notification_outbox outbox
    where outbox.dedupe_key = 'parent-payment-receipt:' || (v_first->>'payment_id');
    raise exception 'FAIL: payment did not queue exactly one deep-linked email receipt: %', v_detail;
  end if;

  perform pg_temp.impersonate('authenticated', v_parent);
  v_receipt := public.get_parent_payment_receipt((v_first->>'payment_id')::uuid);
  if v_receipt->>'receipt_number' is null
     or v_receipt->>'invoice_id' <> v_invoice::text
     or v_receipt->'payment_method'->>'last4' <> '4242' then
    raise exception 'FAIL: durable receipt recovery is incomplete: %', v_receipt;
  end if;
  raise notice 'PASS: exact-balance payment is idempotent, durable, and queues one receipt email';

  perform pg_temp.impersonate('postgres');
  update public.notification_outbox
  set status = 'failed',
      attempts = max_attempts,
      last_error = 'Simulated permanent provider failure'
  where dedupe_key = 'parent-payment-receipt:' || (v_first->>'payment_id')
    and channel = 'email';
  perform pg_temp.impersonate('authenticated', v_parent);
  v_resend := public.resend_parent_payment_receipt((v_first->>'payment_id')::uuid);
  if v_resend->>'email_status' <> 'pending' then
    raise exception 'FAIL: failed receipt email was not safely requeued: %', v_resend;
  end if;
  perform pg_temp.impersonate('postgres');
  if not exists (
    select 1 from public.notification_outbox
    where dedupe_key = 'parent-payment-receipt:' || (v_first->>'payment_id')
      and channel = 'email'
      and status = 'pending'
      and attempts = 0
      and last_error is null
  ) then
    raise exception 'FAIL: receipt resend did not clear exhausted delivery state';
  end if;
  raise notice 'PASS: an authorized parent can requeue a failed receipt email';

  perform pg_temp.impersonate('authenticated', v_parent);
  v_receipt := public.get_parent_payment_receipt(v_refunded_payment);
  if v_receipt->>'status' <> 'refunded'
     or v_receipt->>'refunded_at' is null
     or v_receipt->>'refund_reason' is null then
    raise exception 'FAIL: refunded receipt is incomplete: %', v_receipt;
  end if;
  raise notice 'PASS: refunded payments retain a family-visible durable receipt';

  v_failed := false;
  begin
    insert into public.notification_outbox (
      daycare_id, recipient_email, channel, kind, title, payload, dedupe_key
    ) values (
      '10000000-0000-4000-a000-000000000001',
      'attacker@example.test', 'email', 'parent_payment_receipt', 'Forged receipt',
      jsonb_build_object(
        'familyId', v_home->>'family_id',
        'paymentId', v_first->>'payment_id'
      ),
      'forged-parent-receipt'
    );
  exception when others then
    v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL: parent directly forged a receipt email'; end if;
  raise notice 'PASS: only the validated payment transaction can enqueue its matching receipt';

  perform pg_temp.impersonate('postgres');
  select payment.id into v_foreign_payment
  from public.payments payment
  where payment.family_id is not null
    and payment.family_id <> (v_home->>'family_id')::uuid
    and payment.status = 'succeeded'
  limit 1;
  perform pg_temp.impersonate('authenticated', v_parent);
  if v_foreign_payment is not null then
    v_failed := false;
    begin
      perform public.get_parent_payment_receipt(v_foreign_payment);
    exception when others then
      v_failed := true;
    end;
    if not v_failed then raise exception 'FAIL: cross-family receipt was exposed'; end if;

    v_failed := false;
    begin
      perform public.resend_parent_payment_receipt(v_foreign_payment);
    exception when others then
      v_failed := true;
    end;
    if not v_failed then raise exception 'FAIL: cross-family receipt email was requeued'; end if;
  end if;
  raise notice 'PASS: durable receipt lookup and resend remain family-scoped';
end;
$$;

rollback;
select 'MOBILE PARENT GROUP 21/25 TESTS: ALL PASSED' as result;
