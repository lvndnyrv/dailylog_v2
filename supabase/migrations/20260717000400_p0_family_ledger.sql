-- ============================================================================
-- P0 — family account ledger and payment allocation domain
-- ============================================================================
-- Gateways become adapters around this ledger. Charges are positive, payments
-- and credits are negative, and reversals are explicit entries.

create table family_ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references daycares(id) on delete cascade,
  family_id uuid not null references families(id) on delete cascade,
  currency text not null default 'CAD',
  status text not null default 'active' check (status in ('active', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id)
);

create index family_ledger_accounts_daycare_idx
  on family_ledger_accounts (daycare_id, status);

create table family_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references daycares(id) on delete cascade,
  account_id uuid not null references family_ledger_accounts(id) on delete restrict,
  family_id uuid not null references families(id) on delete cascade,
  entry_type text not null
    check (entry_type in ('invoice', 'payment', 'refund', 'credit', 'adjustment', 'writeoff', 'void')),
  amount_cents int not null check (amount_cents <> 0),
  currency text not null default 'CAD',
  description text not null,
  source_invoice_id uuid references invoices(id) on delete restrict,
  source_payment_id uuid references payments(id) on delete restrict,
  reverses_entry_id uuid references family_ledger_entries(id) on delete restrict,
  effective_at timestamptz not null default now(),
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create index family_ledger_entries_account_idx
  on family_ledger_entries (account_id, effective_at desc, created_at desc);
create unique index family_ledger_invoice_charge_unique
  on family_ledger_entries (source_invoice_id) where entry_type = 'invoice';
create unique index family_ledger_invoice_void_unique
  on family_ledger_entries (source_invoice_id) where entry_type = 'void';
create unique index family_ledger_payment_unique
  on family_ledger_entries (source_payment_id) where entry_type = 'payment';
create unique index family_ledger_refund_unique
  on family_ledger_entries (source_payment_id) where entry_type = 'refund';

create table payment_allocations (
  payment_id uuid not null references payments(id) on delete restrict,
  invoice_id uuid not null references invoices(id) on delete restrict,
  daycare_id uuid not null references daycares(id) on delete cascade,
  family_id uuid not null references families(id) on delete cascade,
  amount_cents int not null check (amount_cents > 0),
  created_at timestamptz not null default now(),
  primary key (payment_id, invoice_id)
);

create index payment_allocations_invoice_idx on payment_allocations (invoice_id);
create index payment_allocations_family_idx on payment_allocations (family_id, created_at desc);

alter table invoices add column if not exists account_id uuid
  references family_ledger_accounts(id) on delete restrict;
alter table payments add column if not exists account_id uuid
  references family_ledger_accounts(id) on delete restrict;
alter table statements add column if not exists account_id uuid
  references family_ledger_accounts(id) on delete restrict;

create or replace function ensure_family_ledger_account(p_family_id uuid)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_account uuid;
  v_daycare uuid;
begin
  if p_family_id is null then return null; end if;
  select daycare_id into v_daycare from families where id = p_family_id;
  if v_daycare is null then raise exception 'Family not found'; end if;
  insert into family_ledger_accounts (daycare_id, family_id)
  values (v_daycare, p_family_id)
  on conflict (family_id) do update set family_id = excluded.family_id
  returning id into v_account;
  return v_account;
end;
$$;

insert into family_ledger_accounts (daycare_id, family_id)
select daycare_id, id from families
on conflict (family_id) do nothing;

update invoices i set account_id = a.id
  from family_ledger_accounts a
 where a.family_id = i.family_id and i.account_id is null;
update payments p set account_id = a.id
  from family_ledger_accounts a
 where a.family_id = p.family_id and p.account_id is null;
update statements s set account_id = a.id
  from family_ledger_accounts a
 where a.family_id = s.family_id and s.account_id is null;

insert into family_ledger_entries (
  daycare_id, account_id, family_id, entry_type, amount_cents, currency,
  description, source_invoice_id, effective_at, created_by
)
select i.daycare_id, i.account_id, i.family_id, 'invoice', i.total_cents, i.currency,
       coalesce('Invoice ' || i.number, 'Invoice charge'), i.id,
       coalesce(i.issued_on::timestamptz, i.created_at, now()), null
  from invoices i
 where i.account_id is not null and i.family_id is not null and i.total_cents <> 0
   and i.status in ('open', 'paid', 'overdue')
on conflict (source_invoice_id) where entry_type = 'invoice' do nothing;

insert into family_ledger_entries (
  daycare_id, account_id, family_id, entry_type, amount_cents, currency,
  description, source_payment_id, effective_at, created_by
)
select p.daycare_id, p.account_id, p.family_id, 'payment', -p.amount_cents, p.currency,
       'Payment received', p.id, coalesce(p.paid_at, p.created_at, now()), null
  from payments p
 where p.account_id is not null and p.family_id is not null and p.amount_cents > 0
   and p.status in ('succeeded', 'refunded')
on conflict (source_payment_id) where entry_type = 'payment' do nothing;

insert into family_ledger_entries (
  daycare_id, account_id, family_id, entry_type, amount_cents, currency,
  description, source_payment_id, effective_at, created_by
)
select p.daycare_id, p.account_id, p.family_id, 'refund', p.amount_cents, p.currency,
       'Payment refunded', p.id, coalesce(p.paid_at, p.created_at, now()), null
  from payments p
 where p.account_id is not null and p.family_id is not null and p.amount_cents > 0
   and p.status = 'refunded'
on conflict (source_payment_id) where entry_type = 'refund' do nothing;

insert into payment_allocations (payment_id, invoice_id, daycare_id, family_id, amount_cents)
select p.id, p.invoice_id, p.daycare_id, p.family_id,
       least(p.amount_cents, greatest(i.total_cents, 1))
  from payments p
  join invoices i on i.id = p.invoice_id and i.family_id = p.family_id
 where p.family_id is not null and p.amount_cents > 0 and p.status in ('succeeded', 'refunded')
on conflict (payment_id, invoice_id) do nothing;

create or replace function set_billing_ledger_account()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_family uuid;
  v_daycare uuid;
begin
  if tg_table_name = 'payment_allocations' then
    select i.family_id, i.daycare_id into v_family, v_daycare
      from invoices i where i.id = new.invoice_id;
    if v_family is null or not exists (
      select 1 from payments p
       where p.id = new.payment_id and p.family_id = v_family and p.daycare_id = v_daycare
    ) then raise exception 'Payment and invoice must belong to the same family'; end if;
    new.family_id := v_family;
    new.daycare_id := v_daycare;
    return new;
  end if;

  if new.family_id is null and tg_table_name = 'payments' and new.invoice_id is not null then
    select family_id into new.family_id from invoices where id = new.invoice_id;
  end if;
  if new.family_id is not null then
    new.account_id := ensure_family_ledger_account(new.family_id);
  end if;
  return new;
end;
$$;

create trigger invoices_set_ledger_account before insert or update of family_id on invoices
  for each row execute function set_billing_ledger_account();
create trigger payments_set_ledger_account before insert or update of family_id, invoice_id on payments
  for each row execute function set_billing_ledger_account();
create trigger statements_set_ledger_account before insert or update of family_id on statements
  for each row execute function set_billing_ledger_account();
create trigger allocations_validate_family before insert or update on payment_allocations
  for each row execute function set_billing_ledger_account();

create or replace function sync_invoice_ledger()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_charge family_ledger_entries%rowtype;
begin
  if new.account_id is null or new.family_id is null or new.total_cents = 0 then return new; end if;

  if new.status in ('open', 'paid', 'overdue') then
    insert into family_ledger_entries (
      daycare_id, account_id, family_id, entry_type, amount_cents, currency,
      description, source_invoice_id, effective_at
    ) values (
      new.daycare_id, new.account_id, new.family_id, 'invoice', new.total_cents, new.currency,
      coalesce('Invoice ' || new.number, 'Invoice charge'), new.id,
      coalesce(new.issued_on::timestamptz, new.created_at, now())
    )
    on conflict (source_invoice_id) where entry_type = 'invoice'
    do update set amount_cents = excluded.amount_cents,
                  description = excluded.description,
                  currency = excluded.currency;
  end if;

  if new.status = 'void' and old.status is distinct from 'void' then
    select * into v_charge from family_ledger_entries
     where source_invoice_id = new.id and entry_type = 'invoice';
    if v_charge.id is not null then
      insert into family_ledger_entries (
        daycare_id, account_id, family_id, entry_type, amount_cents, currency,
        description, source_invoice_id, reverses_entry_id, effective_at
      ) values (
        new.daycare_id, new.account_id, new.family_id, 'void', -v_charge.amount_cents,
        new.currency, coalesce('Void ' || new.number, 'Invoice void'), new.id, v_charge.id, now()
      ) on conflict (source_invoice_id) where entry_type = 'void' do nothing;
    end if;
  elsif tg_op = 'UPDATE' and old.status = 'void' and new.status <> 'void' then
    raise exception 'A void invoice cannot be reopened; create a new invoice';
  end if;
  return new;
end;
$$;

create or replace function sync_payment_ledger()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_payment_entry uuid;
begin
  if tg_op = 'UPDATE' and old.status in ('succeeded', 'refunded') and new.status = 'failed' then
    raise exception 'A settled payment cannot become failed; refund it instead';
  end if;
  if new.account_id is null or new.family_id is null or new.amount_cents <= 0 then return new; end if;

  if new.status in ('succeeded', 'refunded') then
    insert into family_ledger_entries (
      daycare_id, account_id, family_id, entry_type, amount_cents, currency,
      description, source_payment_id, effective_at
    ) values (
      new.daycare_id, new.account_id, new.family_id, 'payment', -new.amount_cents,
      new.currency, 'Payment received', new.id, coalesce(new.paid_at, now())
    ) on conflict (source_payment_id) where entry_type = 'payment'
      do update set amount_cents = excluded.amount_cents, currency = excluded.currency
    returning id into v_payment_entry;

    if new.invoice_id is not null and exists (
      select 1 from invoices where id = new.invoice_id and total_cents > 0
    ) then
      insert into payment_allocations (payment_id, invoice_id, daycare_id, family_id, amount_cents)
      values (
        new.id, new.invoice_id, new.daycare_id, new.family_id,
        least(new.amount_cents, (select total_cents from invoices where id = new.invoice_id))
      )
      on conflict (payment_id, invoice_id) do update set amount_cents = excluded.amount_cents;
    end if;
  end if;

  if new.status = 'refunded' and (tg_op = 'INSERT' or old.status is distinct from 'refunded') then
    select id into v_payment_entry from family_ledger_entries
     where source_payment_id = new.id and entry_type = 'payment';
    insert into family_ledger_entries (
      daycare_id, account_id, family_id, entry_type, amount_cents, currency,
      description, source_payment_id, reverses_entry_id, effective_at
    ) values (
      new.daycare_id, new.account_id, new.family_id, 'refund', new.amount_cents,
      new.currency, 'Payment refunded', new.id, v_payment_entry, now()
    ) on conflict (source_payment_id) where entry_type = 'refund' do nothing;
  end if;
  return new;
end;
$$;

create trigger invoices_sync_ledger after insert or update of total_cents, status, number on invoices
  for each row execute function sync_invoice_ledger();
create trigger payments_sync_ledger after insert or update of amount_cents, status, invoice_id on payments
  for each row execute function sync_payment_ledger();

create or replace function create_ledger_adjustment(
  p_family_id uuid,
  p_amount_cents int,
  p_description text,
  p_entry_type text default 'adjustment'
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_family families%rowtype;
  v_account uuid;
  v_entry uuid;
begin
  if not is_admin() then raise exception 'Admin access required'; end if;
  select * into v_family from families
   where id = p_family_id and daycare_id = get_my_daycare_id() and archived_at is null;
  if v_family.id is null then raise exception 'Family not found'; end if;
  if p_amount_cents = 0 or nullif(btrim(p_description), '') is null then
    raise exception 'A non-zero amount and description are required';
  end if;
  if p_entry_type not in ('credit', 'adjustment', 'writeoff') then
    raise exception 'Unsupported manual entry type';
  end if;
  v_account := ensure_family_ledger_account(p_family_id);
  insert into family_ledger_entries (
    daycare_id, account_id, family_id, entry_type, amount_cents, description, created_by
  ) values (
    v_family.daycare_id, v_account, v_family.id, p_entry_type, p_amount_cents,
    btrim(p_description), auth.uid()
  ) returning id into v_entry;
  return v_entry;
end;
$$;

create or replace function get_family_ledger_balance(p_family_id uuid)
returns bigint
language plpgsql security definer stable
set search_path = public
as $$
begin
  if not can_access_family(p_family_id) then raise exception 'Family access required'; end if;
  return coalesce((select sum(amount_cents) from family_ledger_entries where family_id = p_family_id), 0);
end;
$$;

create or replace function create_family_ledger_account()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  perform ensure_family_ledger_account(new.id);
  return new;
end;
$$;

create trigger family_create_ledger_account after insert on families
  for each row execute function create_family_ledger_account();

create trigger family_ledger_accounts_updated_at before update on family_ledger_accounts
  for each row execute function update_updated_at();

alter table family_ledger_accounts enable row level security;
alter table family_ledger_entries enable row level security;
alter table payment_allocations enable row level security;

create policy "members read family ledger account" on family_ledger_accounts
  for select using (can_access_family(family_id));
create policy "members read family ledger entries" on family_ledger_entries
  for select using (can_access_family(family_id));
create policy "members read family payment allocations" on payment_allocations
  for select using (can_access_family(family_id));

revoke all on function ensure_family_ledger_account(uuid) from public, anon, authenticated;
grant execute on function ensure_family_ledger_account(uuid) to service_role;
grant execute on function create_ledger_adjustment(uuid, int, text, text) to authenticated;
grant execute on function get_family_ledger_balance(uuid) to authenticated;

drop trigger if exists audit_family_ledger_entries on family_ledger_entries;
create trigger audit_family_ledger_entries after insert on family_ledger_entries
  for each row execute function audit_write();
