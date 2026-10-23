-- Keep manual payments and invoice voids consistent with the family ledger.
create or replace function public.record_invoice_payment(
  p_invoice_id uuid,
  p_amount_cents int,
  p_method text default 'cash'
)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_invoice public.invoices%rowtype;
  v_paid int;
begin
  if not public.is_admin() then
    raise exception 'Only admins can record payments';
  end if;

  select * into v_invoice
  from public.invoices
  where id = p_invoice_id and daycare_id = public.get_my_daycare_id()
  for update;
  if v_invoice.id is null then raise exception 'Invoice not found'; end if;
  if v_invoice.status not in ('open', 'overdue') then
    raise exception 'Only open invoices can receive a payment';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'Amount must be positive';
  end if;
  if p_method is null or p_method not in ('card', 'bank', 'etransfer', 'cash', 'cheque', 'other') then
    raise exception 'Choose a valid payment method';
  end if;

  select coalesce(sum(amount_cents), 0)::int into v_paid
  from public.payments
  where invoice_id = v_invoice.id and status = 'succeeded';
  if p_amount_cents > v_invoice.total_cents - v_paid then
    raise exception 'Payment exceeds the remaining invoice balance';
  end if;

  insert into public.payments (
    daycare_id, family_id, invoice_id, paid_by, amount_cents,
    currency, method, status
  ) values (
    v_invoice.daycare_id, v_invoice.family_id, v_invoice.id, v_invoice.billed_to,
    p_amount_cents, v_invoice.currency, p_method, 'succeeded'
  );

  -- The payments trigger refreshes invoice status using settled payments.
  if v_paid + p_amount_cents = v_invoice.total_cents then return 'paid'; end if;
  return 'open';
end;
$$;

create or replace function public.prevent_void_invoice_with_payment()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.status = 'void' and old.status is distinct from 'void'
     and exists (
       select 1 from public.payments
       where invoice_id = old.id and status = 'succeeded'
     ) then
    raise exception 'This invoice has a recorded payment; refund or reconcile it before voiding';
  end if;
  return new;
end;
$$;

drop trigger if exists invoices_prevent_void_with_payment on public.invoices;
create trigger invoices_prevent_void_with_payment
  before update of status on public.invoices
  for each row execute function public.prevent_void_invoice_with_payment();
