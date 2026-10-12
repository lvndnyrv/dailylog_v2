-- DailyLog mobile parent — Group 21 billing + Group 25 payment receipt.
--
-- Parent clients receive only family-scoped JSON from the RPCs below. Payment
-- mutation is intentionally limited to payment methods marked `demo`; a real
-- provider must settle a payment server-side before production charges exist.

create table if not exists public.family_payment_methods (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references public.daycares(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  method_type text not null check (method_type in ('card', 'bank')),
  brand text not null,
  last4 text not null check (last4 ~ '^[0-9]{4}$'),
  expiry_month int check (expiry_month between 1 and 12),
  expiry_year int check (expiry_year between 2020 and 2200),
  provider text not null default 'demo' check (provider in ('demo', 'stripe')),
  provider_payment_method_ref text,
  status text not null default 'active' check (status in ('active', 'expired', 'removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists family_payment_methods_family_idx
  on public.family_payment_methods(family_id, status, created_at);

create table if not exists public.family_billing_preferences (
  family_id uuid primary key references public.families(id) on delete cascade,
  daycare_id uuid not null references public.daycares(id) on delete cascade,
  autopay_enabled boolean not null default false,
  default_payment_method_id uuid references public.family_payment_methods(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.payments
  add column if not exists payment_method_id uuid references public.family_payment_methods(id) on delete set null,
  add column if not exists receipt_number text,
  add column if not exists receipt_emailed_to text;

create unique index if not exists payments_receipt_number_idx
  on public.payments(receipt_number) where receipt_number is not null;

drop trigger if exists family_payment_methods_updated_at on public.family_payment_methods;
create trigger family_payment_methods_updated_at
  before update on public.family_payment_methods
  for each row execute function public.update_updated_at();

drop trigger if exists family_billing_preferences_updated_at on public.family_billing_preferences;
create trigger family_billing_preferences_updated_at
  before update on public.family_billing_preferences
  for each row execute function public.update_updated_at();

alter table public.family_payment_methods enable row level security;
alter table public.family_billing_preferences enable row level security;

drop policy if exists "families read own payment methods" on public.family_payment_methods;
create policy "families read own payment methods"
  on public.family_payment_methods for select
  using (public.can_access_family(family_id));

drop policy if exists "families read own billing preferences" on public.family_billing_preferences;
create policy "families read own billing preferences"
  on public.family_billing_preferences for select
  using (public.can_access_family(family_id));

revoke insert, update, delete on public.family_payment_methods from anon, authenticated;
revoke insert, update, delete on public.family_billing_preferences from anon, authenticated;

create or replace function public.can_manage_family_billing(p_family_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.family_members member
    join public.families family on family.id = member.family_id
    where member.family_id = p_family_id
      and member.profile_id = auth.uid()
      and member.receives_billing
      and family.archived_at is null
  );
$$;

revoke execute on function public.can_manage_family_billing(uuid) from public, anon;
grant execute on function public.can_manage_family_billing(uuid) to authenticated;

create or replace function public.get_parent_billing_home()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_family public.families%rowtype;
  v_profile public.profiles%rowtype;
  v_payload jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in to view billing'; end if;

  select * into v_profile from public.profiles where id = auth.uid();
  select f.* into v_family
  from public.family_members fm
  join public.families f on f.id = fm.family_id
  where fm.profile_id = auth.uid()
    and fm.receives_billing
    and f.archived_at is null
  order by (fm.role = 'primary') desc, fm.created_at
  limit 1;

  if v_family.id is null then raise exception 'No family billing account is linked'; end if;

  select jsonb_build_object(
    'family_id', v_family.id,
    'family_name', v_family.display_name,
    'billing_email', coalesce(v_family.billing_email, v_profile.email),
    'daycare_name', (select d.name from public.daycares d where d.id = v_family.daycare_id),
    'current_balance_cents', coalesce((
      select sum(greatest(i.total_cents - coalesce(p.paid_cents, 0), 0))
      from public.invoices i
      left join lateral (
        select sum(amount_cents) as paid_cents from public.payments
        where invoice_id = i.id and status = 'succeeded'
      ) p on true
      where i.family_id = v_family.id and i.status in ('open', 'overdue')
    ), 0),
    'next_due_on', (
      select min(i.due_on) from public.invoices i
      where i.family_id = v_family.id and i.status in ('open', 'overdue')
    ),
    'preferences', coalesce((
      select jsonb_build_object(
        'autopay_enabled', pref.autopay_enabled,
        'default_payment_method_id', pref.default_payment_method_id
      )
      from public.family_billing_preferences pref where pref.family_id = v_family.id
    ), jsonb_build_object('autopay_enabled', false, 'default_payment_method_id', null)),
    'payment_methods', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', method.id,
        'method_type', method.method_type,
        'brand', method.brand,
        'last4', method.last4,
        'expiry_month', method.expiry_month,
        'expiry_year', method.expiry_year,
        'provider', method.provider,
        'status', method.status
      ) order by method.created_at)
      from public.family_payment_methods method
      where method.family_id = v_family.id and method.status = 'active'
    ), '[]'::jsonb),
    'invoices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', item.id,
        'number', item.number,
        'status', item.status,
        'issued_on', item.issued_on,
        'due_on', item.due_on,
        'total_cents', item.total_cents,
        'paid_cents', item.paid_cents,
        'balance_cents', greatest(item.total_cents - item.paid_cents, 0),
        'currency', item.currency,
        'child_name', item.child_name,
        'classroom_name', item.classroom_name,
        'summary', item.summary
      ) order by item.issued_on desc nulls last, item.created_at desc)
      from (
        select i.id, i.number, i.status, i.issued_on, i.due_on,
          i.total_cents, i.currency, i.created_at,
          coalesce(sum(p.amount_cents) filter (where p.status = 'succeeded'), 0)::int as paid_cents,
          concat_ws(' ', c.first_name, c.last_name) as child_name,
          room.name as classroom_name,
          (select line.description from public.invoice_lines line
            where line.invoice_id = i.id order by line.created_at limit 1) as summary
        from public.invoices i
        left join public.payments p on p.invoice_id = i.id
        left join public.children c on c.id = i.child_id
        left join public.classrooms room on room.id = c.classroom_id
        where i.family_id = v_family.id and i.status <> 'void'
        group by i.id, c.first_name, c.last_name, room.name
      ) item
    ), '[]'::jsonb),
    'statements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'period_start', s.period_start,
        'period_end', s.period_end,
        'total_cents', s.total_cents,
        'storage_path', s.storage_path
      ) order by s.period_start desc)
      from public.statements s where s.family_id = v_family.id
    ), '[]'::jsonb),
    'tax_receipt', jsonb_build_object(
      'year', extract(year from current_date)::int - 1,
      'total_cents', coalesce((
        select sum(p.amount_cents) from public.payments p
        where p.family_id = v_family.id and p.status = 'succeeded'
          and extract(year from p.paid_at) = extract(year from current_date) - 1
      ), 0)
    )
  ) into v_payload;

  return v_payload;
end;
$$;

create or replace function public.get_parent_billing_invoice(p_invoice_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_invoice public.invoices%rowtype;
  v_paid int;
  v_profile public.profiles%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in to view an invoice'; end if;
  select * into v_invoice from public.invoices where id = p_invoice_id;
  if v_invoice.id is null
     or v_invoice.family_id is null
     or not coalesce(public.can_manage_family_billing(v_invoice.family_id), false) then
    raise exception 'Invoice not found';
  end if;
  select * into v_profile from public.profiles where id = auth.uid();
  select coalesce(sum(amount_cents), 0)::int into v_paid
    from public.payments where invoice_id = v_invoice.id and status = 'succeeded';

  return jsonb_build_object(
    'id', v_invoice.id,
    'number', v_invoice.number,
    'status', v_invoice.status,
    'issued_on', v_invoice.issued_on,
    'due_on', v_invoice.due_on,
    'total_cents', v_invoice.total_cents,
    'paid_cents', v_paid,
    'balance_cents', greatest(v_invoice.total_cents - v_paid, 0),
    'currency', v_invoice.currency,
    'billing_email', coalesce((select billing_email from public.families where id = v_invoice.family_id), v_profile.email),
    'child_name', (select concat_ws(' ', first_name, last_name) from public.children where id = v_invoice.child_id),
    'classroom_name', (select room.name from public.children child join public.classrooms room on room.id = child.classroom_id where child.id = v_invoice.child_id),
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
      'id', line.id,
      'description', line.description,
      'quantity', line.quantity,
      'amount_cents', line.amount_cents
    ) order by line.created_at) from public.invoice_lines line where line.invoice_id = v_invoice.id), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object(
      'id', payment.id,
      'amount_cents', payment.amount_cents,
      'method', payment.method,
      'paid_at', payment.paid_at,
      'receipt_number', payment.receipt_number,
      'receipt_emailed_to', payment.receipt_emailed_to,
      'payment_method_id', payment.payment_method_id
    ) order by payment.paid_at desc) from public.payments payment
      where payment.invoice_id = v_invoice.id and payment.status = 'succeeded'), '[]'::jsonb),
    'payment_methods', coalesce((select jsonb_agg(jsonb_build_object(
      'id', method.id,
      'method_type', method.method_type,
      'brand', method.brand,
      'last4', method.last4,
      'expiry_month', method.expiry_month,
      'expiry_year', method.expiry_year,
      'provider', method.provider
    ) order by method.created_at) from public.family_payment_methods method
      where method.family_id = v_invoice.family_id and method.status = 'active'), '[]'::jsonb),
    'default_payment_method_id', (select pref.default_payment_method_id from public.family_billing_preferences pref where pref.family_id = v_invoice.family_id)
  );
end;
$$;

create or replace function public.set_parent_billing_preferences(
  p_autopay_enabled boolean,
  p_payment_method_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family public.families%rowtype;
  v_method public.family_payment_methods%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in to manage billing'; end if;
  select f.* into v_family
  from public.family_members fm join public.families f on f.id = fm.family_id
  where fm.profile_id = auth.uid() and fm.receives_billing and f.archived_at is null
  order by (fm.role = 'primary') desc, fm.created_at limit 1;
  if v_family.id is null then raise exception 'No family billing account is linked'; end if;

  if p_payment_method_id is not null then
    select * into v_method from public.family_payment_methods
    where id = p_payment_method_id and family_id = v_family.id and status = 'active';
    if v_method.id is null then raise exception 'Payment method not found'; end if;
  end if;
  if p_autopay_enabled and v_method.id is null then
    raise exception 'Choose a payment method before enabling autopay';
  end if;

  insert into public.family_billing_preferences (
    family_id, daycare_id, autopay_enabled, default_payment_method_id, updated_by
  ) values (
    v_family.id, v_family.daycare_id, p_autopay_enabled, p_payment_method_id, auth.uid()
  ) on conflict (family_id) do update set
    autopay_enabled = excluded.autopay_enabled,
    default_payment_method_id = excluded.default_payment_method_id,
    updated_by = auth.uid(),
    updated_at = now();

  return public.get_parent_billing_home()->'preferences';
end;
$$;

create or replace function public.complete_demo_parent_invoice_payment(
  p_invoice_id uuid,
  p_payment_method_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.invoices%rowtype;
  v_method public.family_payment_methods%rowtype;
  v_payment public.payments%rowtype;
  v_paid int;
  v_due int;
  v_email text;
  v_receipt text;
begin
  if auth.uid() is null then raise exception 'Sign in to pay an invoice'; end if;
  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if v_invoice.id is null
     or v_invoice.family_id is null
     or not coalesce(public.can_manage_family_billing(v_invoice.family_id), false) then
    raise exception 'Invoice not found';
  end if;

  select * into v_method from public.family_payment_methods
  where id = p_payment_method_id and family_id = v_invoice.family_id and status = 'active';
  if v_method.id is null then raise exception 'Payment method not found'; end if;
  if v_method.provider <> 'demo' then
    raise exception 'This payment method must be confirmed by the configured payment provider';
  end if;

  select coalesce(sum(amount_cents), 0)::int into v_paid
    from public.payments where invoice_id = v_invoice.id and status = 'succeeded';
  v_due := greatest(v_invoice.total_cents - v_paid, 0);
  if v_due = 0 or v_invoice.status = 'paid' then
    select * into v_payment from public.payments
      where invoice_id = v_invoice.id and status = 'succeeded'
      order by paid_at desc limit 1;
    if v_payment.id is null then raise exception 'This invoice is already settled'; end if;
    if v_payment.payment_method_id is not null then
      select * into v_method from public.family_payment_methods
      where id = v_payment.payment_method_id and family_id = v_invoice.family_id;
    end if;
  else
    v_email := coalesce(
      (select billing_email from public.families where id = v_invoice.family_id),
      (select email from public.profiles where id = auth.uid())
    );
    v_receipt := 'DL-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    insert into public.payments (
      daycare_id, family_id, invoice_id, paid_by, amount_cents, currency,
      method, status, external_ref, payment_method_id, receipt_number,
      receipt_emailed_to, paid_at
    ) values (
      v_invoice.daycare_id, v_invoice.family_id, v_invoice.id, auth.uid(), v_due,
      v_invoice.currency, v_method.method_type, 'succeeded',
      'demo_' || replace(gen_random_uuid()::text, '-', ''), v_method.id,
      v_receipt, v_email, now()
    ) returning * into v_payment;
    update public.invoices set status = 'paid', updated_at = now() where id = v_invoice.id;
  end if;

  return jsonb_build_object(
    'payment_id', v_payment.id,
    'invoice_id', v_invoice.id,
    'invoice_number', v_invoice.number,
    'invoice_label', to_char(coalesce(v_invoice.issued_on, current_date), 'FMMonth YYYY'),
    'amount_cents', v_payment.amount_cents,
    'currency', v_payment.currency,
    'paid_at', v_payment.paid_at,
    'receipt_number', v_payment.receipt_number,
    'receipt_email', v_payment.receipt_emailed_to,
    'payment_method', jsonb_build_object(
      'id', v_method.id,
      'method_type', v_method.method_type,
      'brand', v_method.brand,
      'last4', v_method.last4,
      'provider', v_method.provider
    )
  );
end;
$$;

grant execute on function public.get_parent_billing_home() to authenticated;
grant execute on function public.get_parent_billing_invoice(uuid) to authenticated;
grant execute on function public.set_parent_billing_preferences(boolean, uuid) to authenticated;
grant execute on function public.complete_demo_parent_invoice_payment(uuid, uuid) to authenticated;

revoke execute on function public.get_parent_billing_home() from anon;
revoke execute on function public.get_parent_billing_invoice(uuid) from anon;
revoke execute on function public.set_parent_billing_preferences(boolean, uuid) from anon;
revoke execute on function public.complete_demo_parent_invoice_payment(uuid, uuid) from anon;
