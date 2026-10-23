-- Internal accounting triage for household-level manual ledger entries.
-- Linking an entry to an invoice line does not allocate money or change tax
-- eligibility; it only records an admin's review for later reconciliation.
create table public.billing_annual_adjustment_reviews (
  ledger_entry_id uuid primary key references public.family_ledger_entries(id) on delete cascade,
  review_year integer not null check (review_year between 2000 and 2100),
  daycare_id uuid not null references public.daycares(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  disposition text not null check (disposition in (
    'needs_review', 'possible_invoice_relation', 'not_child_care', 'accounting_followup'
  )),
  invoice_line_id uuid references public.invoice_lines(id) on delete restrict,
  note text not null default '' check (char_length(note) <= 500),
  reviewed_entry_amount_cents integer not null,
  reviewed_entry_description text not null,
  reviewed_entry_effective_at timestamptz not null,
  reviewed_line_description text,
  reviewed_line_amount_cents integer,
  reviewed_by uuid not null references public.profiles(id),
  reviewed_at timestamptz not null default now(),
  constraint billing_annual_adjustment_review_reason check (
    disposition = 'needs_review' or char_length(btrim(note)) >= 8
  ),
  constraint billing_annual_adjustment_review_line check (
    (disposition = 'possible_invoice_relation' and invoice_line_id is not null)
    or (disposition <> 'possible_invoice_relation' and invoice_line_id is null)
  )
);
create index billing_annual_adjustment_reviews_family_year_idx
  on public.billing_annual_adjustment_reviews (family_id, review_year);

create or replace function public.validate_billing_annual_adjustment_review()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_entry public.family_ledger_entries%rowtype;
  v_line public.invoice_lines%rowtype;
  v_invoice public.invoices%rowtype;
  v_year integer;
begin
  if not public.is_admin() or not public.has_permission('billing', 'edit') then
    raise exception 'Billing edit access is required';
  end if;
  select * into v_entry from public.family_ledger_entries where id = new.ledger_entry_id;
  if v_entry.id is null or v_entry.daycare_id <> public.get_my_daycare_id()
     or v_entry.entry_type not in ('credit', 'adjustment', 'writeoff')
     or v_entry.currency <> 'CAD' then
    raise exception 'Only own-center CAD manual ledger entries can be reviewed';
  end if;
  select extract(year from v_entry.effective_at at time zone coalesce(d.timezone, 'America/Toronto'))::integer
    into v_year from public.daycares d where d.id = v_entry.daycare_id;
  if new.review_year <> v_year then raise exception 'Review year does not match the ledger entry'; end if;
  if new.disposition = 'possible_invoice_relation' then
    select * into v_line from public.invoice_lines where id = new.invoice_line_id;
    select * into v_invoice from public.invoices where id = v_line.invoice_id;
    if v_line.id is null or v_invoice.id is null or v_invoice.status = 'void'
       or v_invoice.daycare_id <> v_entry.daycare_id
       or v_line.daycare_id <> v_entry.daycare_id
       or v_invoice.family_id <> v_entry.family_id or v_invoice.child_id is null
       or (v_entry.source_invoice_id is not null and v_entry.source_invoice_id <> v_invoice.id) then
      raise exception 'Invoice line must belong to the same child-linked family invoice';
    end if;
    new.reviewed_line_description := v_line.description;
    new.reviewed_line_amount_cents := v_line.amount_cents;
  else
    new.reviewed_line_description := null;
    new.reviewed_line_amount_cents := null;
  end if;
  new.daycare_id := v_entry.daycare_id;
  new.family_id := v_entry.family_id;
  new.reviewed_entry_amount_cents := v_entry.amount_cents;
  new.reviewed_entry_description := v_entry.description;
  new.reviewed_entry_effective_at := v_entry.effective_at;
  new.reviewed_by := auth.uid();
  new.reviewed_at := now();
  return new;
end;
$$;
revoke execute on function public.validate_billing_annual_adjustment_review() from public, anon, authenticated;
create trigger validate_billing_annual_adjustment_review
  before insert or update on public.billing_annual_adjustment_reviews
  for each row execute function public.validate_billing_annual_adjustment_review();

alter table public.billing_annual_adjustment_reviews enable row level security;
revoke all on public.billing_annual_adjustment_reviews from anon, authenticated;
grant select, insert, update on public.billing_annual_adjustment_reviews to authenticated;
create policy "billing editors read own annual adjustment reviews"
  on public.billing_annual_adjustment_reviews for select to authenticated
  using (public.is_admin() and public.has_permission('billing', 'edit')
    and daycare_id = public.get_my_daycare_id());
create policy "billing editors create own annual adjustment reviews"
  on public.billing_annual_adjustment_reviews for insert to authenticated
  with check (public.is_admin() and public.has_permission('billing', 'edit')
    and daycare_id = public.get_my_daycare_id());
create policy "billing editors update own annual adjustment reviews"
  on public.billing_annual_adjustment_reviews for update to authenticated
  using (public.is_admin() and public.has_permission('billing', 'edit')
    and daycare_id = public.get_my_daycare_id())
  with check (public.is_admin() and public.has_permission('billing', 'edit')
    and daycare_id = public.get_my_daycare_id());

create or replace function public.audit_billing_annual_adjustment_review()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log (daycare_id, actor_id, action, entity_type, entity_id, before, after)
  values (
    new.daycare_id, auth.uid(), lower(tg_op), 'billing_annual_adjustment_reviews', new.ledger_entry_id,
    case when tg_op = 'UPDATE' then jsonb_build_object(
      'review_year', old.review_year, 'disposition', old.disposition,
      'invoice_line_id', old.invoice_line_id, 'note_recorded', old.note <> ''
    ) else null end,
    jsonb_build_object('review_year', new.review_year, 'disposition', new.disposition,
      'invoice_line_id', new.invoice_line_id, 'note_recorded', new.note <> '')
  );
  return new;
end;
$$;
revoke execute on function public.audit_billing_annual_adjustment_review() from public, anon, authenticated;
create trigger billing_annual_adjustment_review_audit
  after insert or update on public.billing_annual_adjustment_reviews
  for each row execute function public.audit_billing_annual_adjustment_review();
