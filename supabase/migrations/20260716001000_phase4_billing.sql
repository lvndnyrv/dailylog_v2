-- ============================================================================
-- DailyLog — Phase 4: manual-first billing (6a)
-- ============================================================================
-- Record-keeping first: plans, invoices, recorded payments. Stripe autopay,
-- payouts and parent-side flows arrive with the payments integration.

-- e-Transfer is how Canadian families actually pay — add it to the method set
alter table payments drop constraint if exists payments_method_check;
alter table payments add constraint payments_method_check
  check (method in ('card', 'bank', 'etransfer', 'cash', 'cheque', 'other'));

-- Atomic invoice creation: per-center number (INV-YYYY-NNN), lines, totals.
-- p_lines: [{"description": text, "quantity": num, "unit_amount_cents": int}]
create or replace function create_invoice(
  p_child_id uuid,
  p_billed_to uuid,
  p_due_on date,
  p_lines jsonb
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_daycare uuid;
  v_number text;
  v_invoice uuid;
  v_line jsonb;
  v_total int := 0;
begin
  if not is_admin() then
    raise exception 'Only admins can create invoices';
  end if;
  v_daycare := get_my_daycare_id();

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'An invoice needs at least one line';
  end if;

  select 'INV-' || to_char(current_date, 'YYYY') || '-' ||
         lpad((count(*) + 1)::text, 3, '0')
    into v_number
  from invoices
  where daycare_id = v_daycare
    and number like 'INV-' || to_char(current_date, 'YYYY') || '-%';

  insert into invoices (daycare_id, child_id, billed_to, number, status,
                        issued_on, due_on, subtotal_cents, total_cents)
  values (v_daycare, p_child_id, p_billed_to, v_number, 'open',
          current_date, p_due_on, 0, 0)
  returning id into v_invoice;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into invoice_lines (daycare_id, invoice_id, description, quantity,
                               unit_amount_cents, amount_cents)
    values (
      v_daycare, v_invoice,
      v_line->>'description',
      coalesce((v_line->>'quantity')::numeric, 1),
      coalesce((v_line->>'unit_amount_cents')::int, 0),
      round(coalesce((v_line->>'quantity')::numeric, 1)
            * coalesce((v_line->>'unit_amount_cents')::int, 0))::int
    );
    v_total := v_total + round(coalesce((v_line->>'quantity')::numeric, 1)
                               * coalesce((v_line->>'unit_amount_cents')::int, 0))::int;
  end loop;

  update invoices set subtotal_cents = v_total, total_cents = v_total
   where id = v_invoice;

  return v_invoice;
end;
$$;

-- Recording a payment settles the invoice once fully covered.
create or replace function record_invoice_payment(
  p_invoice_id uuid,
  p_amount_cents int,
  p_method text default 'cash'
)
returns text  -- resulting invoice status
language plpgsql security definer
set search_path = public
as $$
declare
  v_invoice invoices%rowtype;
  v_paid int;
begin
  if not is_admin() then
    raise exception 'Only admins can record payments';
  end if;

  select * into v_invoice from invoices
   where id = p_invoice_id and daycare_id = get_my_daycare_id();
  if v_invoice.id is null then
    raise exception 'Invoice not found';
  end if;
  if p_amount_cents <= 0 then
    raise exception 'Amount must be positive';
  end if;

  insert into payments (daycare_id, invoice_id, paid_by, amount_cents,
                        currency, method, status)
  values (v_invoice.daycare_id, v_invoice.id, v_invoice.billed_to,
          p_amount_cents, v_invoice.currency, p_method, 'succeeded');

  select coalesce(sum(amount_cents), 0) into v_paid
  from payments
  where invoice_id = v_invoice.id and status = 'succeeded';

  if v_paid >= v_invoice.total_cents then
    update invoices set status = 'paid' where id = v_invoice.id;
    return 'paid';
  end if;
  return v_invoice.status;
end;
$$;

-- The 6a tiles + the dashboard's outstanding-balances tile.
create or replace function get_billing_summary()
returns table (
  collected_month_cents bigint,
  expected_month_cents bigint,
  outstanding_cents bigint,
  overdue_count bigint,
  open_count bigint
)
language sql security definer stable
set search_path = public
as $$
  select
    (select coalesce(sum(p.amount_cents), 0) from payments p
      where p.daycare_id = get_my_daycare_id() and p.status = 'succeeded'
        and date_trunc('month', p.paid_at) = date_trunc('month', now())),
    (select coalesce(sum(i.total_cents), 0) from invoices i
      where i.daycare_id = get_my_daycare_id() and i.status <> 'void'
        and date_trunc('month', i.issued_on) = date_trunc('month', now())),
    (select coalesce(sum(i.total_cents - coalesce(paid.cents, 0)), 0)
       from invoices i
       left join lateral (
         select sum(amount_cents) as cents from payments
         where invoice_id = i.id and status = 'succeeded'
       ) paid on true
      where i.daycare_id = get_my_daycare_id() and i.status = 'open'),
    (select count(*) from invoices i
      where i.daycare_id = get_my_daycare_id() and i.status = 'open'
        and i.due_on < current_date),
    (select count(*) from invoices i
      where i.daycare_id = get_my_daycare_id() and i.status = 'open')
  where is_admin()
$$;
