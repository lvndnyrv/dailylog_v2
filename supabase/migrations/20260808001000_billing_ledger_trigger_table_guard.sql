-- PostgreSQL does not guarantee short-circuit evaluation for trigger records.
-- The shared billing ledger trigger previously referenced NEW.invoice_id while
-- running on invoices/statements, whose records do not have that field.

create or replace function public.set_billing_ledger_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family uuid;
  v_daycare uuid;
begin
  if tg_table_name = 'payment_allocations' then
    select invoice.family_id, invoice.daycare_id into v_family, v_daycare
    from public.invoices invoice
    where invoice.id = new.invoice_id;

    if v_family is null or not exists (
      select 1
      from public.payments payment
      where payment.id = new.payment_id
        and payment.family_id = v_family
        and payment.daycare_id = v_daycare
    ) then
      raise exception 'Payment and invoice must belong to the same family';
    end if;

    new.family_id := v_family;
    new.daycare_id := v_daycare;
    return new;
  end if;

  if tg_table_name = 'payments' then
    if new.family_id is null and new.invoice_id is not null then
      select invoice.family_id into new.family_id
      from public.invoices invoice
      where invoice.id = new.invoice_id;
    end if;
  end if;

  if new.family_id is not null then
    new.account_id := public.ensure_family_ledger_account(new.family_id);
  end if;
  return new;
end;
$$;
