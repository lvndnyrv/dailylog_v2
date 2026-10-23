-- Rollback-only: creates a temporary household credit in the development seed.
begin;

select set_config('test.adjustment_admin_id', id::text, true)
from public.profiles where email = 'amara@sunnygrove.test' limit 1;
select set_config('test.adjustment_parent_id', id::text, true)
from public.profiles where email = 'lucia.castillo@parent.test' limit 1;
select set_config('test.adjustment_family_id', family_id::text, true)
from public.invoices where number = 'MOBILE-2025-TAX-CASTILLO' limit 1;
select set_config('test.adjustment_line_id', l.id::text, true)
from public.invoice_lines l join public.invoices i on i.id = l.invoice_id
where i.number = 'MOBILE-2025-TAX-CASTILLO' limit 1;
select set_config('test.adjustment_other_line_id', l.id::text, true)
from public.invoice_lines l join public.invoices i on i.id = l.invoice_id
where i.family_id <> current_setting('test.adjustment_family_id')::uuid
  and i.daycare_id = (select daycare_id from public.profiles
    where id = current_setting('test.adjustment_admin_id')::uuid)
limit 1;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.adjustment_admin_id'), true);
select set_config('test.adjustment_entry_id', public.create_ledger_adjustment(
  current_setting('test.adjustment_family_id')::uuid,
  -2500, 'Temporary annual review credit', 'credit')::text, true);

insert into public.billing_annual_adjustment_reviews (
  ledger_entry_id, review_year, daycare_id, family_id, disposition,
  invoice_line_id, note, reviewed_entry_amount_cents,
  reviewed_entry_description, reviewed_entry_effective_at,
  reviewed_by
)
select e.id,
  extract(year from e.effective_at at time zone coalesce(d.timezone, 'America/Toronto'))::integer,
  e.daycare_id, e.family_id, 'possible_invoice_relation',
  current_setting('test.adjustment_line_id')::uuid,
  'Possible relation for test; not applied',
  e.amount_cents, e.description, e.effective_at,
  current_setting('test.adjustment_admin_id')::uuid
from public.family_ledger_entries e join public.daycares d on d.id = e.daycare_id
where e.id = current_setting('test.adjustment_entry_id')::uuid;

do $$
declare
  v_entry public.family_ledger_entries%rowtype;
  v_review public.billing_annual_adjustment_reviews%rowtype;
begin
  select * into v_entry from public.family_ledger_entries
  where id = current_setting('test.adjustment_entry_id')::uuid;
  select * into v_review from public.billing_annual_adjustment_reviews
  where ledger_entry_id = v_entry.id;
  if v_review.ledger_entry_id is null
     or v_review.invoice_line_id <> current_setting('test.adjustment_line_id')::uuid
     or v_review.reviewed_entry_amount_cents <> -2500
     or v_entry.amount_cents <> -2500 then
    raise exception 'Owner review changed the ledger or did not save';
  end if;
  if exists (select 1 from public.audit_log
      where entity_type = 'billing_annual_adjustment_reviews'
        and entity_id = v_entry.id
        and after::text like '%Possible relation for test%') then
    raise exception 'Private review note copied into audit history';
  end if;
  begin
    update public.billing_annual_adjustment_reviews
    set invoice_line_id = current_setting('test.adjustment_other_line_id')::uuid
    where ledger_entry_id = v_entry.id;
    raise exception 'Cross-family invoice line was accepted';
  exception when others then
    if sqlerrm = 'Cross-family invoice line was accepted' then raise; end if;
  end;
  begin
    update public.billing_annual_adjustment_reviews
    set review_year = review_year - 1
    where ledger_entry_id = v_entry.id;
    raise exception 'Wrong review year was accepted';
  exception when others then
    if sqlerrm = 'Wrong review year was accepted' then raise; end if;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', current_setting('test.adjustment_parent_id'), true);
do $$
begin
  if exists (select 1 from public.billing_annual_adjustment_reviews
      where ledger_entry_id = current_setting('test.adjustment_entry_id')::uuid) then
    raise exception 'Parent can read adjustment review';
  end if;
  begin
    update public.billing_annual_adjustment_reviews
    set note = 'Parent should not write this'
    where ledger_entry_id = current_setting('test.adjustment_entry_id')::uuid;
    if found then raise exception 'Parent could update adjustment review'; end if;
  exception when others then
    if sqlerrm = 'Parent could update adjustment review' then raise; end if;
  end;
end;
$$;

reset role;
rollback;
