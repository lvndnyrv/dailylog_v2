-- Rollback-only test against Sunny Grove development seed data.
begin;

select set_config('test.allocation_admin_id', id::text, true)
from public.profiles where email = 'amara@sunnygrove.test' limit 1;
select set_config('test.allocation_parent_id', id::text, true)
from public.profiles where email = 'lucia.castillo@parent.test' limit 1;
select set_config('test.allocation_payment_id', p.id::text, true)
from public.payments p join public.invoices i on i.id = p.invoice_id
where i.number = 'MOBILE-2025-TAX-CASTILLO' and p.status = 'succeeded' limit 1;
select set_config('test.allocation_line_id', l.id::text, true)
from public.invoice_lines l join public.invoices i on i.id = l.invoice_id
where i.number = 'MOBILE-2025-TAX-CASTILLO' limit 1;
select set_config('test.refunded_payment_id', p.id::text, true)
from public.payments p join public.invoices i on i.id = p.invoice_id
where i.number = 'MOBILE-2026-06-CASTILLO' and p.status = 'refunded' limit 1;
select set_config('test.replacement_payment_id', p.id::text, true)
from public.payments p join public.invoices i on i.id = p.invoice_id
where i.number = 'MOBILE-2026-06-CASTILLO' and p.status = 'succeeded' limit 1;
select set_config('test.refunded_line_id', l.id::text, true)
from public.invoice_lines l join public.invoices i on i.id = l.invoice_id
where i.number = 'MOBILE-2026-06-CASTILLO' limit 1;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.allocation_admin_id'), true);

insert into public.billing_annual_line_reviews (
  invoice_line_id, review_year, daycare_id, family_id, classification, note,
  reviewed_line_description, reviewed_line_amount_cents, reviewed_by
)
select l.id, 2025, i.daycare_id, i.family_id, 'care_service_candidate',
  'Test invoice service review', l.description, l.amount_cents,
  current_setting('test.allocation_admin_id')::uuid
from public.invoice_lines l join public.invoices i on i.id = l.invoice_id
where l.id = current_setting('test.allocation_line_id')::uuid;

do $$
declare
  v_amount integer;
  v_json jsonb;
  v_year integer;
begin
  select amount_cents into v_amount from public.payments
  where id = current_setting('test.allocation_payment_id')::uuid;
  v_json := jsonb_build_array(jsonb_build_object(
    'invoice_line_id', current_setting('test.allocation_line_id'),
    'amount_cents', v_amount));
  v_year := public.save_billing_annual_payment_allocation(
    current_setting('test.allocation_payment_id')::uuid, 'received', v_json);
  if v_year <> 2025 then raise exception 'Wrong allocation year'; end if;
  if (select sum(amount_cents) from public.billing_annual_payment_allocations
      where payment_id = current_setting('test.allocation_payment_id')::uuid
        and event_kind = 'received') <> v_amount then
    raise exception 'Owner allocation did not reconcile exactly';
  end if;
  begin
    perform public.save_billing_annual_payment_allocation(
      current_setting('test.allocation_payment_id')::uuid, 'received',
      jsonb_build_array(jsonb_build_object(
        'invoice_line_id', current_setting('test.allocation_line_id'),
        'amount_cents', v_amount + 1)));
    raise exception 'Over-allocation was accepted';
  exception when others then
    if sqlerrm = 'Over-allocation was accepted' then raise; end if;
  end;
  begin
    perform public.save_billing_annual_payment_allocation(
      current_setting('test.allocation_payment_id')::uuid, 'refunded', v_json);
    raise exception 'Refund without refund event was accepted';
  exception when others then
    if sqlerrm = 'Refund without refund event was accepted' then raise; end if;
  end;
end;
$$;

insert into public.billing_annual_line_reviews (
  invoice_line_id, review_year, daycare_id, family_id, classification, note,
  reviewed_line_description, reviewed_line_amount_cents, reviewed_by
)
select l.id, 2026, i.daycare_id, i.family_id, 'care_service_candidate',
  'Test refund review', l.description, l.amount_cents,
  current_setting('test.allocation_admin_id')::uuid
from public.invoice_lines l join public.invoices i on i.id = l.invoice_id
where l.id = current_setting('test.refunded_line_id')::uuid;

do $$
declare
  v_amount integer;
  v_json jsonb;
begin
  select amount_cents into v_amount from public.payments
  where id = current_setting('test.refunded_payment_id')::uuid;
  v_json := jsonb_build_array(jsonb_build_object(
    'invoice_line_id', current_setting('test.refunded_line_id'),
    'amount_cents', v_amount));
  perform public.save_billing_annual_payment_allocation(
    current_setting('test.refunded_payment_id')::uuid, 'received', v_json);
  begin
    perform public.save_billing_annual_payment_allocation(
      current_setting('test.replacement_payment_id')::uuid, 'received', v_json);
    raise exception 'Second receipt exceeded the line before refund allocation';
  exception when others then
    if sqlerrm = 'Second receipt exceeded the line before refund allocation' then raise; end if;
  end;
  perform public.save_billing_annual_payment_allocation(
    current_setting('test.refunded_payment_id')::uuid, 'refunded', v_json);
  perform public.save_billing_annual_payment_allocation(
    current_setting('test.replacement_payment_id')::uuid, 'received', v_json);
  if (select coalesce(sum(case when event_kind = 'received' then amount_cents
      else -amount_cents end), 0) from public.billing_annual_payment_allocations
      where invoice_line_id = current_setting('test.refunded_line_id')::uuid) <> v_amount then
    raise exception 'Refund and replacement receipt did not reconcile to one line amount';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', current_setting('test.allocation_parent_id'), true);
do $$
begin
  if exists (select 1 from public.billing_annual_payment_allocations
      where payment_id = current_setting('test.allocation_payment_id')::uuid) then
    raise exception 'Parent can read internal allocations';
  end if;
  begin
    perform public.save_billing_annual_payment_allocation(
      current_setting('test.allocation_payment_id')::uuid, 'received',
      jsonb_build_array(jsonb_build_object(
        'invoice_line_id', current_setting('test.allocation_line_id'),
        'amount_cents', 1398000)));
    raise exception 'Parent could write internal allocations';
  exception when others then
    if sqlerrm = 'Parent could write internal allocations' then raise; end if;
  end;
end;
$$;

reset role;
rollback;
