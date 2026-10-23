-- A private, non-financial explanation of an invoice/payment-year difference.
create table public.billing_annual_invoice_timing_reviews (
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  review_year integer not null check (review_year between 2000 and 2100),
  daycare_id uuid not null references public.daycares(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  disposition text not null check (disposition in (
    'explained_timing', 'explained_open_balance', 'accounting_followup'
  )),
  note text not null check (char_length(btrim(note)) between 8 and 500),
  reviewed_issued_on date,
  reviewed_invoice_status text not null,
  reviewed_invoice_total_cents integer not null,
  reviewed_billed_cents integer not null,
  reviewed_received_cents integer not null,
  reviewed_refunded_cents integer not null,
  reviewed_by uuid not null references public.profiles(id),
  reviewed_at timestamptz not null default now(),
  primary key (invoice_id, review_year)
);
create index billing_annual_invoice_timing_reviews_family_year_idx
  on public.billing_annual_invoice_timing_reviews (family_id, review_year);

alter table public.billing_annual_invoice_timing_reviews enable row level security;
revoke all on public.billing_annual_invoice_timing_reviews from anon, authenticated;
grant select on public.billing_annual_invoice_timing_reviews to authenticated;
create policy "billing editors read own invoice timing reviews"
  on public.billing_annual_invoice_timing_reviews for select to authenticated
  using (public.is_admin() and public.has_permission('billing', 'edit')
    and daycare_id = public.get_my_daycare_id());

create or replace function public.save_billing_annual_invoice_timing_review(
  p_invoice_id uuid, p_review_year integer, p_disposition text, p_note text
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_invoice public.invoices%rowtype;
  v_timezone text;
  v_received integer;
  v_refunded integer;
  v_billed integer;
  v_before public.billing_annual_invoice_timing_reviews%rowtype;
begin
  if not public.is_admin() or not public.has_permission('billing', 'edit') then
    raise exception 'Billing edit access is required';
  end if;
  if p_review_year not between 2000 and 2100
     or p_disposition not in ('explained_timing', 'explained_open_balance', 'accounting_followup')
     or char_length(btrim(coalesce(p_note, ''))) not between 8 and 500 then
    raise exception 'Invalid invoice timing review';
  end if;
  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if v_invoice.id is null or v_invoice.daycare_id <> public.get_my_daycare_id()
     or v_invoice.family_id is null or v_invoice.child_id is null
     or v_invoice.currency <> 'CAD' then
    raise exception 'A child-linked CAD invoice from your center is required';
  end if;
  select coalesce(timezone, 'America/Toronto') into v_timezone
    from public.daycares where id = v_invoice.daycare_id;
  select coalesce(sum(amount_cents) filter (
      where extract(year from paid_at at time zone v_timezone)::integer = p_review_year), 0),
    coalesce(sum(amount_cents) filter (
      where status = 'refunded'
        and extract(year from refunded_at at time zone v_timezone)::integer = p_review_year), 0)
    into v_received, v_refunded
    from public.payments
    where invoice_id = p_invoice_id and currency = 'CAD'
      and status in ('succeeded', 'refunded');
  if extract(year from v_invoice.issued_on)::integer is distinct from p_review_year
     and v_received = 0 and v_refunded = 0 then
    raise exception 'This invoice has no activity in the selected year';
  end if;
  v_billed := case when extract(year from v_invoice.issued_on)::integer = p_review_year
      and v_invoice.status not in ('void', 'draft') then v_invoice.total_cents else 0 end;
  if v_billed = v_received - v_refunded then
    raise exception 'No invoice/payment difference remains to explain';
  end if;
  select * into v_before from public.billing_annual_invoice_timing_reviews
    where invoice_id = p_invoice_id and review_year = p_review_year;
  insert into public.billing_annual_invoice_timing_reviews (
    invoice_id, review_year, daycare_id, family_id, disposition, note,
    reviewed_issued_on, reviewed_invoice_status, reviewed_invoice_total_cents,
    reviewed_billed_cents, reviewed_received_cents, reviewed_refunded_cents,
    reviewed_by, reviewed_at
  ) values (
    p_invoice_id, p_review_year, v_invoice.daycare_id, v_invoice.family_id,
    p_disposition, btrim(p_note), v_invoice.issued_on, v_invoice.status,
    v_invoice.total_cents, v_billed, v_received, v_refunded, auth.uid(), now()
  ) on conflict (invoice_id, review_year) do update set
    disposition = excluded.disposition, note = excluded.note,
    reviewed_issued_on = excluded.reviewed_issued_on,
    reviewed_invoice_status = excluded.reviewed_invoice_status,
    reviewed_invoice_total_cents = excluded.reviewed_invoice_total_cents,
    reviewed_billed_cents = excluded.reviewed_billed_cents,
    reviewed_received_cents = excluded.reviewed_received_cents,
    reviewed_refunded_cents = excluded.reviewed_refunded_cents,
    reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at;
  insert into public.audit_log (daycare_id, actor_id, action, entity_type, entity_id, before, after)
  values (v_invoice.daycare_id, auth.uid(),
    case when v_before.invoice_id is null then 'insert' else 'update' end,
    'billing_annual_invoice_timing_reviews', p_invoice_id,
    case when v_before.invoice_id is null then null else jsonb_build_object(
      'review_year', v_before.review_year, 'disposition', v_before.disposition,
      'note_recorded', v_before.note <> '') end,
    jsonb_build_object('review_year', p_review_year, 'disposition', p_disposition,
      'note_recorded', true));
end;
$$;
revoke execute on function public.save_billing_annual_invoice_timing_review(uuid, integer, text, text)
  from public, anon;
grant execute on function public.save_billing_annual_invoice_timing_review(uuid, integer, text, text)
  to authenticated;
