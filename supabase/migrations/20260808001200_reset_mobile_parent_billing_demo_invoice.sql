-- Leave the linked development fixture ready for the iOS payment flow after
-- automated idempotency verification paid it once.

do $$
declare
  v_invoice constant uuid := '52000000-0000-4000-a000-000000000001';
begin
  delete from public.payment_allocations where invoice_id = v_invoice;
  delete from public.family_ledger_entries
  where source_payment_id in (
    select payment.id from public.payments payment where payment.invoice_id = v_invoice
  );
  delete from public.payments where invoice_id = v_invoice;
  update public.invoices set status = 'open', updated_at = now() where id = v_invoice;
end;
$$;
