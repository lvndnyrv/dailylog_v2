-- Allow the validated parent demo-payment RPC through the existing billing
-- enforcement trigger. Direct table writes remain blocked by RLS, and the
-- trigger accepts only an exact outstanding balance using a family-owned demo
-- payment method. The transaction-local marker covers the resulting ledger and
-- invoice status writes without weakening normal billing RBAC.

create or replace function public.enforce_billing_edit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family uuid;
  v_expected_cents int;
  v_marker text;
begin
  if auth.role() = 'service_role' or (auth.uid() is null and auth.role() is null) then
    return coalesce(new, old);
  end if;

  if tg_table_name = 'payments' and tg_op = 'INSERT' then
    if new.family_id is not null
       and new.invoice_id is not null
       and new.payment_method_id is not null
       and new.paid_by = auth.uid()
       and new.status = 'succeeded'
       and new.external_ref like 'demo_%'
       and public.can_manage_family_billing(new.family_id)
       and exists (
         select 1
         from public.family_payment_methods method
         where method.id = new.payment_method_id
           and method.family_id = new.family_id
           and method.daycare_id = new.daycare_id
           and method.provider = 'demo'
           and method.status = 'active'
           and method.method_type = new.method
       ) then
      select greatest(invoice.total_cents - coalesce((
        select sum(payment.amount_cents)
        from public.payments payment
        where payment.invoice_id = invoice.id and payment.status = 'succeeded'
      ), 0), 0)::int
      into v_expected_cents
      from public.invoices invoice
      where invoice.id = new.invoice_id
        and invoice.family_id = new.family_id
        and invoice.daycare_id = new.daycare_id
        and invoice.currency = new.currency
        and invoice.status in ('open', 'overdue');

      if v_expected_cents > 0 and new.amount_cents = v_expected_cents then
        perform set_config('dailylog.parent_demo_payment_family', new.family_id::text, true);
        return new;
      end if;
    end if;
  end if;

  v_marker := current_setting('dailylog.parent_demo_payment_family', true);
  if v_marker is not null and v_marker <> '' then
    if tg_table_name = 'invoices' and tg_op = 'UPDATE' then
      v_family := new.family_id;
    elsif tg_table_name = 'family_ledger_entries' and tg_op = 'INSERT' then
      v_family := new.family_id;
    end if;

    if v_family is not null
       and v_marker = v_family::text
       and public.can_manage_family_billing(v_family) then
      return coalesce(new, old);
    end if;
  end if;

  if not public.has_permission('billing', 'edit') then
    raise exception 'Billing edit permission required';
  end if;
  return coalesce(new, old);
end;
$$;
