-- Internal, exact payment/refund-to-invoice-line reconciliation. These records
-- are never exposed to families and do not authorize receipt publication.
create table public.billing_annual_payment_allocations (
  payment_id uuid not null references public.payments(id) on delete restrict,
  event_kind text not null check (event_kind in ('received', 'refunded')),
  invoice_line_id uuid not null references public.invoice_lines(id) on delete restrict,
  review_year integer not null check (review_year between 2000 and 2100),
  daycare_id uuid not null references public.daycares(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  allocated_by uuid not null references public.profiles(id),
  allocated_at timestamptz not null default now(),
  primary key (payment_id, event_kind, invoice_line_id)
);
create index billing_annual_allocations_family_year_idx
  on public.billing_annual_payment_allocations (family_id, review_year);

alter table public.billing_annual_payment_allocations enable row level security;
revoke all on public.billing_annual_payment_allocations from anon, authenticated;
grant select on public.billing_annual_payment_allocations to authenticated;
create policy "billing editors read own annual allocations"
  on public.billing_annual_payment_allocations for select to authenticated
  using (public.is_admin() and public.has_permission('billing', 'edit')
    and daycare_id = public.get_my_daycare_id());

create or replace function public.save_billing_annual_payment_allocation(
  p_payment_id uuid,
  p_event_kind text,
  p_allocations jsonb
)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_payment public.payments%rowtype;
  v_invoice public.invoices%rowtype;
  v_line public.invoice_lines%rowtype;
  v_review public.billing_annual_line_reviews%rowtype;
  v_event_at timestamptz;
  v_year integer;
  v_item jsonb;
  v_line_id uuid;
  v_amount integer;
  v_total bigint := 0;
  v_ids uuid[] := '{}';
  v_amounts integer[] := '{}';
  v_existing jsonb;
  v_new jsonb := '[]'::jsonb;
  v_received integer;
  v_refunded integer;
  v_line_total bigint;
  v_existing_net bigint;
  v_old_amount integer;
  v_resulting_net bigint;
  v_index integer;
begin
  if not public.is_admin() or not public.has_permission('billing', 'edit') then
    raise exception 'Billing edit access is required';
  end if;
  if p_event_kind not in ('received', 'refunded')
     or jsonb_typeof(p_allocations) is distinct from 'array'
     or jsonb_array_length(p_allocations) < 1
     or jsonb_array_length(p_allocations) > 100 then
    raise exception 'Provide one to 100 invoice-line allocations';
  end if;

  select * into v_payment from public.payments where id = p_payment_id for update;
  if v_payment.id is null or v_payment.daycare_id <> public.get_my_daycare_id()
     or v_payment.family_id is null or v_payment.invoice_id is null
     or v_payment.currency <> 'CAD' or v_payment.amount_cents <= 0
     or v_payment.status not in ('succeeded', 'refunded') then
    raise exception 'Payment is not available for annual review';
  end if;
  select * into v_invoice from public.invoices where id = v_payment.invoice_id for update;
  if v_invoice.id is null or v_invoice.daycare_id <> v_payment.daycare_id
     or v_invoice.family_id <> v_payment.family_id or v_invoice.child_id is null
     or v_invoice.status = 'void' then
    raise exception 'Payment must belong to an active child-linked family invoice';
  end if;
  v_event_at := case when p_event_kind = 'received' then v_payment.paid_at
    else v_payment.refunded_at end;
  if v_event_at is null or (p_event_kind = 'refunded' and v_payment.status <> 'refunded') then
    raise exception 'Payment event has no valid date';
  end if;
  select extract(year from v_event_at at time zone coalesce(d.timezone, 'America/Toronto'))::integer
  into v_year from public.daycares d where d.id = v_payment.daycare_id;
  if v_year not between 2000 and 2100 then raise exception 'Invalid review year'; end if;
  select coalesce(sum(amount_cents), 0) into v_line_total
  from public.invoice_lines where invoice_id = v_invoice.id;
  if v_line_total <> v_invoice.total_cents then
    raise exception 'Invoice lines do not match the invoice total';
  end if;
  if exists (
    select 1 from public.invoice_lines l
    left join public.billing_annual_line_reviews r
      on r.invoice_line_id = l.id and r.review_year = v_year
    where l.invoice_id = v_invoice.id
      and (r.invoice_line_id is null or r.classification = 'needs_review'
        or r.reviewed_line_description <> l.description
        or r.reviewed_line_amount_cents <> l.amount_cents)
  ) then
    raise exception 'Classify every current invoice line before allocating this event';
  end if;

  for v_item in select value from jsonb_array_elements(p_allocations) loop
    if jsonb_typeof(v_item) <> 'object'
       or jsonb_typeof(v_item->'invoice_line_id') <> 'string'
       or jsonb_typeof(v_item->'amount_cents') <> 'number' then
      raise exception 'Invalid allocation entry';
    end if;
    v_line_id := (v_item->>'invoice_line_id')::uuid;
    v_amount := (v_item->>'amount_cents')::integer;
    if v_amount <= 0 or v_line_id = any(v_ids) then
      raise exception 'Allocations must be positive and use each line once';
    end if;
    select * into v_line from public.invoice_lines where id = v_line_id;
    if v_line.id is null or v_line.invoice_id <> v_invoice.id
       or v_line.daycare_id <> v_invoice.daycare_id then
      raise exception 'Allocation line does not belong to this invoice';
    end if;
    if v_amount > v_line.amount_cents then
      raise exception 'Allocation exceeds its invoice line amount';
    end if;
    select * into v_review from public.billing_annual_line_reviews
    where invoice_line_id = v_line_id and review_year = v_year;
    if v_review.invoice_line_id is null or v_review.daycare_id <> v_invoice.daycare_id
       or v_review.family_id <> v_invoice.family_id
       or v_review.classification = 'needs_review'
       or v_review.reviewed_line_description <> v_line.description
       or v_review.reviewed_line_amount_cents <> v_line.amount_cents then
      raise exception 'Classify the current invoice line before allocating its payment';
    end if;

    if p_event_kind = 'refunded' then
      select coalesce(sum(amount_cents), 0)::integer into v_received
      from public.billing_annual_payment_allocations
      where payment_id = p_payment_id and event_kind = 'received'
        and invoice_line_id = v_line_id;
      if v_amount > v_received then
        raise exception 'Refund allocation exceeds the original receipt allocation for a line';
      end if;
    else
      select coalesce(sum(amount_cents), 0)::integer into v_refunded
      from public.billing_annual_payment_allocations
      where payment_id = p_payment_id and event_kind = 'refunded'
        and invoice_line_id = v_line_id;
      if v_amount < v_refunded then
        raise exception 'Receipt allocation cannot be below an existing refund allocation';
      end if;
    end if;
    select coalesce(sum(case when event_kind = 'received' then amount_cents else -amount_cents end), 0)
    into v_existing_net from public.billing_annual_payment_allocations
    where invoice_line_id = v_line_id;
    select coalesce(sum(amount_cents), 0)::integer into v_old_amount
    from public.billing_annual_payment_allocations
    where payment_id = p_payment_id and event_kind = p_event_kind
      and invoice_line_id = v_line_id;
    v_resulting_net := v_existing_net
      + case when p_event_kind = 'received' then v_amount - v_old_amount
        else v_old_amount - v_amount end;
    if v_resulting_net < 0 or v_resulting_net > v_line.amount_cents then
      raise exception 'Net line allocations exceed the invoice line or fall below zero';
    end if;
    v_ids := array_append(v_ids, v_line_id);
    v_amounts := array_append(v_amounts, v_amount);
    v_total := v_total + v_amount;
    v_new := v_new || jsonb_build_array(jsonb_build_object(
      'invoice_line_id', v_line_id, 'amount_cents', v_amount));
  end loop;
  if v_total <> v_payment.amount_cents then
    raise exception 'Allocations must equal the recorded payment or refund amount';
  end if;
  if p_event_kind = 'received' and exists (
    select 1 from public.billing_annual_payment_allocations a
    where a.payment_id = p_payment_id and a.event_kind = 'refunded'
      and not (a.invoice_line_id = any(v_ids))
  ) then
    raise exception 'Receipt allocation must retain every line with a recorded refund';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'invoice_line_id', invoice_line_id, 'amount_cents', amount_cents)
    order by invoice_line_id), '[]'::jsonb) into v_existing
  from public.billing_annual_payment_allocations
  where payment_id = p_payment_id and event_kind = p_event_kind;
  delete from public.billing_annual_payment_allocations
  where payment_id = p_payment_id and event_kind = p_event_kind;
  for v_index in 1..array_length(v_ids, 1) loop
    insert into public.billing_annual_payment_allocations (
      payment_id, event_kind, invoice_line_id, review_year, daycare_id,
      family_id, amount_cents, allocated_by
    ) values (
      p_payment_id, p_event_kind, v_ids[v_index], v_year, v_invoice.daycare_id,
      v_invoice.family_id, v_amounts[v_index], auth.uid()
    );
  end loop;
  insert into public.audit_log (
    daycare_id, actor_id, action, entity_type, entity_id, before, after
  ) values (
    v_invoice.daycare_id, auth.uid(), 'annual_allocation_replaced',
    'billing_annual_payment_allocations', p_payment_id,
    jsonb_build_object('event_kind', p_event_kind, 'review_year', v_year, 'lines', v_existing),
    jsonb_build_object('event_kind', p_event_kind, 'review_year', v_year, 'lines', v_new)
  );
  return v_year;
end;
$$;
revoke all on function public.save_billing_annual_payment_allocation(uuid, text, jsonb) from public, anon;
grant execute on function public.save_billing_annual_payment_allocation(uuid, text, jsonb) to authenticated;
