-- Rollback-only; no invoice or review is left changed.
begin;

select set_config('test.timing_admin_id', id::text, true)
from public.profiles where email = 'amara@sunnygrove.test' limit 1;
select set_config('test.timing_parent_id', id::text, true)
from public.profiles where email = 'lucia.castillo@parent.test' limit 1;
select set_config('test.timing_invoice_id', id::text, true)
from public.invoices where number = 'MOBILE-2026-08-CASTILLO' limit 1;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.timing_admin_id'), true);
select public.save_billing_annual_invoice_timing_review(
  current_setting('test.timing_invoice_id')::uuid, 2026,
  'explained_open_balance', 'August balance remains unpaid; review only');

do $$
declare
  v public.billing_annual_invoice_timing_reviews%rowtype;
begin
  select * into v from public.billing_annual_invoice_timing_reviews
    where invoice_id = current_setting('test.timing_invoice_id')::uuid and review_year = 2026;
  if v.invoice_id is null or v.reviewed_billed_cents <> 124000
     or v.reviewed_received_cents <> 0 or v.reviewed_refunded_cents <> 0 then
    raise exception 'Snapshot did not match unpaid invoice';
  end if;
  if exists (select 1 from public.audit_log
      where entity_type = 'billing_annual_invoice_timing_reviews'
        and entity_id = v.invoice_id
        and after::text like '%August balance remains unpaid%') then
    raise exception 'Private explanation leaked into audit log';
  end if;
  begin
    perform public.save_billing_annual_invoice_timing_review(
      v.invoice_id, 2025, 'explained_timing', 'Wrong review year');
    raise exception 'Wrong-year review was accepted';
  exception when others then
    if sqlerrm = 'Wrong-year review was accepted' then raise; end if;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', current_setting('test.timing_parent_id'), true);
do $$
begin
  if exists (select 1 from public.billing_annual_invoice_timing_reviews
      where invoice_id = current_setting('test.timing_invoice_id')::uuid) then
    raise exception 'Parent could read private timing review';
  end if;
  begin
    perform public.save_billing_annual_invoice_timing_review(
      current_setting('test.timing_invoice_id')::uuid, 2026,
      'accounting_followup', 'Parent should not write');
    raise exception 'Parent could save timing review';
  exception when others then
    if sqlerrm = 'Parent could save timing review' then raise; end if;
  end;
end;
$$;

reset role;
rollback;
