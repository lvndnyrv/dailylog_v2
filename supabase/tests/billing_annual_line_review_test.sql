-- Rollback-only test against Sunny Grove development seed data.
begin;

select set_config('test.review_admin_id', id::text, true)
from public.profiles where email = 'amara@sunnygrove.test' limit 1;
select set_config('test.review_parent_id', id::text, true)
from public.profiles where email = 'lucia.castillo@parent.test' limit 1;
select set_config('test.review_line_id', l.id::text, true)
from public.invoice_lines l
join public.invoices i on i.id = l.invoice_id
where i.number = 'MOBILE-2025-TAX-CASTILLO' limit 1;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.review_admin_id'), true);

insert into public.billing_annual_line_reviews (
  invoice_line_id, review_year, daycare_id, family_id, classification, note,
  reviewed_line_description, reviewed_line_amount_cents, reviewed_by
)
select l.id, 2025, i.daycare_id, i.family_id, 'care_service_candidate',
  'TEST-REVIEW-NOTE-DO-NOT-LOG', l.description, l.amount_cents,
  current_setting('test.review_admin_id')::uuid
from public.invoice_lines l join public.invoices i on i.id = l.invoice_id
where l.id = current_setting('test.review_line_id')::uuid;

do $$
begin
  if not exists (
    select 1 from public.billing_annual_line_reviews
    where invoice_line_id = current_setting('test.review_line_id')::uuid
      and review_year = 2025 and classification = 'care_service_candidate'
  ) then raise exception 'Billing owner could not save line review'; end if;
  begin
    insert into public.billing_annual_line_reviews (
      invoice_line_id, review_year, daycare_id, family_id, classification, note,
      reviewed_line_description, reviewed_line_amount_cents, reviewed_by
    )
    select l.id, 2024, i.daycare_id, i.family_id, 'exclude',
      'Wrong review year', l.description, l.amount_cents,
      current_setting('test.review_admin_id')::uuid
    from public.invoice_lines l join public.invoices i on i.id = l.invoice_id
    where l.id = current_setting('test.review_line_id')::uuid;
    raise exception 'An unpaid review year was accepted';
  exception when others then
    if sqlerrm = 'An unpaid review year was accepted' then raise; end if;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', current_setting('test.review_parent_id'), true);
do $$
begin
  if exists (
    select 1 from public.billing_annual_line_reviews
    where invoice_line_id = current_setting('test.review_line_id')::uuid
  ) then raise exception 'Parent could read internal line review'; end if;
  begin
    update public.billing_annual_line_reviews set classification = 'exclude', note = 'test exclusion'
    where invoice_line_id = current_setting('test.review_line_id')::uuid;
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
do $$
begin
  if (select classification from public.billing_annual_line_reviews
      where invoice_line_id = current_setting('test.review_line_id')::uuid
        and review_year = 2025) <> 'care_service_candidate' then
    raise exception 'Parent changed an internal line review';
  end if;
  if exists (
    select 1 from public.audit_log
    where entity_type = 'billing_annual_line_reviews'
      and (coalesce(before::text, '') || coalesce(after::text, ''))
        like '%TEST-REVIEW-NOTE-DO-NOT-LOG%'
  ) then raise exception 'Review note leaked into audit log'; end if;
end;
$$;

rollback;
