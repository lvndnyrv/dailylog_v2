-- Restore the linked demo family after simulator payment verification so the
-- next tester starts with the Group 21 due-balance state from the handoff.

do $$
declare
  v_invoice constant uuid := '52000000-0000-4000-a000-000000000001';
  v_family uuid;
begin
  select invoice.family_id into v_family
  from public.invoices invoice
  where invoice.id = v_invoice;

  delete from public.payment_allocations where invoice_id = v_invoice;
  delete from public.family_ledger_entries
  where source_payment_id in (
    select payment.id from public.payments payment where payment.invoice_id = v_invoice
  );
  delete from public.payments where invoice_id = v_invoice;
  update public.invoices set status = 'open', updated_at = now() where id = v_invoice;

  update public.family_billing_preferences
  set autopay_enabled = true,
      default_payment_method_id = '51000000-0000-4000-a000-000000000001',
      updated_at = now()
  where family_id = v_family;
end;
$$;
