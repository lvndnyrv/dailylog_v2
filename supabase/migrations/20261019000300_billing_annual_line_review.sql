-- Internal evidence review only. A classification is not a tax determination,
-- payment allocation, receipt, or authorization to publish to a family.
create table public.billing_annual_line_reviews (
  invoice_line_id uuid not null references public.invoice_lines(id) on delete cascade,
  review_year integer not null check (review_year between 2000 and 2100),
  daycare_id uuid not null references public.daycares(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  classification text not null check (classification in ('needs_review', 'care_service_candidate', 'exclude')),
  note text not null default '' check (char_length(note) <= 500),
  reviewed_line_description text not null,
  reviewed_line_amount_cents integer not null,
  reviewed_by uuid not null references public.profiles(id),
  reviewed_at timestamptz not null default now(),
  primary key (invoice_line_id, review_year),
  constraint billing_annual_line_reviews_reason check (
    classification = 'needs_review' or char_length(btrim(note)) >= 5
  )
);
create index billing_annual_line_reviews_family_year_idx
  on public.billing_annual_line_reviews (family_id, review_year);

create or replace function public.validate_billing_annual_line_review()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_line public.invoice_lines%rowtype;
  v_invoice public.invoices%rowtype;
begin
  if not public.is_admin() or not public.has_permission('billing', 'edit') then
    raise exception 'Billing edit access is required';
  end if;
  select * into v_line from public.invoice_lines where id = new.invoice_line_id;
  if v_line.id is null then raise exception 'Invoice line not found'; end if;
  select * into v_invoice from public.invoices where id = v_line.invoice_id;
  if v_invoice.id is null or v_invoice.family_id is null or v_invoice.child_id is null
     or v_invoice.status = 'void' then
    raise exception 'Only active child-linked family invoice lines can be reviewed';
  end if;
  if v_line.daycare_id <> v_invoice.daycare_id
     or v_invoice.daycare_id <> public.get_my_daycare_id() then
    raise exception 'Invoice line belongs to another center';
  end if;
  if not exists (
    select 1 from public.payments p
    where p.invoice_id = v_invoice.id and p.family_id = v_invoice.family_id
      and p.currency = 'CAD' and p.status in ('succeeded', 'refunded')
      and (
        (p.paid_at is not null and extract(year from p.paid_at at time zone coalesce(
          (select timezone from public.daycares where id = v_invoice.daycare_id), 'America/Toronto'
        ))::integer = new.review_year)
        or (p.status = 'refunded' and p.refunded_at is not null
          and extract(year from p.refunded_at at time zone coalesce(
            (select timezone from public.daycares where id = v_invoice.daycare_id), 'America/Toronto'
          ))::integer = new.review_year)
      )
  ) then
    raise exception 'No recorded CAD payment or refund for this invoice in the review year';
  end if;
  new.daycare_id := v_invoice.daycare_id;
  new.family_id := v_invoice.family_id;
  new.reviewed_line_description := v_line.description;
  new.reviewed_line_amount_cents := v_line.amount_cents;
  new.reviewed_by := auth.uid();
  new.reviewed_at := now();
  return new;
end;
$$;
revoke execute on function public.validate_billing_annual_line_review() from public, anon, authenticated;
create trigger validate_billing_annual_line_review
  before insert or update on public.billing_annual_line_reviews
  for each row execute function public.validate_billing_annual_line_review();

alter table public.billing_annual_line_reviews enable row level security;
revoke all on public.billing_annual_line_reviews from anon, authenticated;
grant select, insert, update on public.billing_annual_line_reviews to authenticated;
create policy "billing editors read own annual line reviews"
  on public.billing_annual_line_reviews for select to authenticated
  using (public.is_admin() and public.has_permission('billing', 'edit')
    and daycare_id = public.get_my_daycare_id());
create policy "billing editors create own annual line reviews"
  on public.billing_annual_line_reviews for insert to authenticated
  with check (public.is_admin() and public.has_permission('billing', 'edit')
    and daycare_id = public.get_my_daycare_id());
create policy "billing editors update own annual line reviews"
  on public.billing_annual_line_reviews for update to authenticated
  using (public.is_admin() and public.has_permission('billing', 'edit')
    and daycare_id = public.get_my_daycare_id())
  with check (public.is_admin() and public.has_permission('billing', 'edit')
    and daycare_id = public.get_my_daycare_id());

create or replace function public.audit_billing_annual_line_review()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log (daycare_id, actor_id, action, entity_type, entity_id, before, after)
  values (
    new.daycare_id, auth.uid(), lower(tg_op), 'billing_annual_line_reviews', new.invoice_line_id,
    case when tg_op = 'UPDATE' then jsonb_build_object(
      'review_year', old.review_year, 'classification', old.classification,
      'note_recorded', old.note <> ''
    ) else null end,
    jsonb_build_object('review_year', new.review_year, 'classification', new.classification,
      'note_recorded', new.note <> '')
  );
  return new;
end;
$$;
revoke execute on function public.audit_billing_annual_line_review() from public, anon, authenticated;
create trigger billing_annual_line_review_audit
  after insert or update on public.billing_annual_line_reviews
  for each row execute function public.audit_billing_annual_line_review();
