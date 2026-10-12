-- Route late-pickup events created before Group 8 billing was connected.

update public.late_pickup_events
   set billing_status = 'waived'
 where billing_status = 'pending'
   and (conversation_required or fee_cents <= 0);

do $$
declare
  v_event record;
  v_invoice_id uuid;
begin
  for v_event in
    select event.id, event.child_id, event.daycare_id
      from public.late_pickup_events event
     where event.billing_status = 'pending' and event.fee_cents > 0
     order by event.occurred_on, event.created_at
  loop
    select invoice.id into v_invoice_id
      from public.family_children link
      join public.invoices invoice on invoice.family_id = link.family_id
     where link.child_id = v_event.child_id
       and invoice.daycare_id = v_event.daycare_id
       and invoice.status in ('draft', 'open')
     order by invoice.issued_on desc nulls last, invoice.created_at desc
     limit 1;
    if v_invoice_id is not null then
      perform public.attach_late_pickup_fee_to_invoice(v_event.id, v_invoice_id);
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
