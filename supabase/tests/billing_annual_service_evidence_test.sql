-- Rollback-only check against the Sunny Grove development seed.
begin;

select set_config('test.evidence_admin_id', id::text, true)
from public.profiles where email = 'amara@sunnygrove.test' limit 1;
select set_config('test.evidence_parent_id', id::text, true)
from public.profiles where email = 'lucia.castillo@parent.test' limit 1;
select set_config('test.evidence_line_id', l.id::text, true)
from public.invoice_lines l join public.invoices i on i.id = l.invoice_id
where i.number = 'MOBILE-2025-TAX-CASTILLO' limit 1;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.evidence_admin_id'), true);

insert into public.billing_annual_line_reviews (
  invoice_line_id, review_year, daycare_id, family_id, classification, note,
  reviewed_line_description, reviewed_line_amount_cents, reviewed_by,
  service_start_on, service_end_on, service_evidence_note
)
select l.id, 2025, i.daycare_id, i.family_id, 'care_service_candidate',
  'Test service-date review', l.description, l.amount_cents,
  current_setting('test.evidence_admin_id')::uuid,
  date '2025-01-01', date '2025-12-31', 'Signed enrollment contract'
from public.invoice_lines l join public.invoices i on i.id = l.invoice_id
where l.id = current_setting('test.evidence_line_id')::uuid
on conflict (invoice_line_id, review_year) do update set
  classification = excluded.classification,
  note = excluded.note,
  service_start_on = excluded.service_start_on,
  service_end_on = excluded.service_end_on,
  service_evidence_note = excluded.service_evidence_note;

do $$
begin
  if not exists (select 1 from public.billing_annual_line_reviews
      where invoice_line_id = current_setting('test.evidence_line_id')::uuid
        and review_year = 2025 and service_start_on = date '2025-01-01'
        and service_end_on = date '2025-12-31') then
    raise exception 'Owner could not record service evidence';
  end if;
  begin
    update public.billing_annual_line_reviews
    set service_end_on = date '2024-12-31'
    where invoice_line_id = current_setting('test.evidence_line_id')::uuid and review_year = 2025;
    raise exception 'Reversed care dates were accepted';
  exception when others then
    if sqlerrm = 'Reversed care dates were accepted' then raise; end if;
  end;
  begin
    update public.billing_annual_line_reviews
    set service_evidence_note = 'short'
    where invoice_line_id = current_setting('test.evidence_line_id')::uuid and review_year = 2025;
    raise exception 'Missing evidence source was accepted';
  exception when others then
    if sqlerrm = 'Missing evidence source was accepted' then raise; end if;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', current_setting('test.evidence_parent_id'), true);
do $$
begin
  if exists (select 1 from public.billing_annual_line_reviews
      where invoice_line_id = current_setting('test.evidence_line_id')::uuid and review_year = 2025) then
    raise exception 'Parent could read internal service evidence';
  end if;
end;
$$;

reset role;
rollback;
