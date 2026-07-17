-- ============================================================================
-- DailyLog — P0 foundation: households / family accounts
-- ============================================================================
-- A family is the durable account shared by guardians and children. Existing
-- parent_children links remain the mobile compatibility contract; triggers
-- mirror those links into the family model while messaging and billing migrate
-- incrementally. This avoids a flag-day mobile release.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1 · Family account and membership graph
-- ─────────────────────────────────────────────────────────────────────────────

create table families (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references daycares(id) on delete cascade,
  display_name text not null,
  primary_contact_id uuid references profiles(id) on delete set null,
  billing_email text,
  billing_phone text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table family_members (
  family_id uuid not null references families(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  role text not null default 'guardian'
    check (role in ('primary', 'guardian', 'billing', 'other')),
  relationship text,
  receives_messages boolean not null default true,
  receives_billing boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (family_id, profile_id)
);

create table family_children (
  family_id uuid not null references families(id) on delete cascade,
  child_id uuid not null references children(id) on delete cascade,
  is_primary boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (family_id, child_id)
);

create index families_daycare_status_idx on families (daycare_id, status)
  where archived_at is null;
create index family_members_profile_idx on family_members (profile_id, family_id);
create index family_children_child_idx on family_children (child_id, family_id);

create trigger families_updated_at
  before update on families
  for each row execute function update_updated_at();

-- Helpers are SECURITY DEFINER so policies can inspect the membership graph
-- without recursive RLS evaluation. They expose ids/booleans only.
create or replace function my_family_ids()
returns setof uuid
language sql security definer stable
set search_path = public
as $$
  select fm.family_id
    from family_members fm
   where fm.profile_id = auth.uid()
$$;

create or replace function can_access_family(p_family_id uuid)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1
      from families f
     where f.id = p_family_id
       and f.archived_at is null
       and (
         exists (
           select 1 from family_members fm
            where fm.family_id = f.id and fm.profile_id = auth.uid()
         )
         or (is_staff() and f.daycare_id = get_my_daycare_id())
       )
  )
$$;

create or replace function shares_family_with(p_profile_id uuid)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1
      from family_members mine
      join family_members theirs on theirs.family_id = mine.family_id
     where mine.profile_id = auth.uid()
       and theirs.profile_id = p_profile_id
  )
$$;

create or replace function can_message_family(p_family_id uuid)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1
      from families f
     where f.id = p_family_id
       and f.archived_at is null
       and (
         exists (
           select 1 from family_members fm
            where fm.family_id = f.id and fm.profile_id = auth.uid()
         )
         or (is_admin() and f.daycare_id = get_my_daycare_id())
         or (
           get_my_role() = 'educator'
           and exists (
             select 1
               from family_children fc
               join children c on c.id = fc.child_id
              where fc.family_id = f.id
                and c.classroom_id in (select my_classroom_ids())
           )
         )
       )
  )
$$;

-- Family membership is now a first-class child-access path. The legacy
-- parent_children half of the union keeps pre-migration links working.
create or replace function my_child_ids()
returns setof uuid
language sql security definer stable
set search_path = public
as $$
  select pc.child_id from parent_children pc where pc.parent_id = auth.uid()
  union
  select fc.child_id
    from family_members fm
    join family_children fc on fc.family_id = fm.family_id
   where fm.profile_id = auth.uid()
$$;

revoke all on function my_family_ids() from public;
revoke all on function can_access_family(uuid) from public;
revoke all on function shares_family_with(uuid) from public;
revoke all on function can_message_family(uuid) from public;
grant execute on function my_family_ids() to authenticated, anon;
grant execute on function can_access_family(uuid) to authenticated, anon;
grant execute on function shares_family_with(uuid) to authenticated;
grant execute on function can_message_family(uuid) to authenticated;

alter table families enable row level security;
alter table family_members enable row level security;
alter table family_children enable row level security;

create policy "members read accessible families" on families
  for select using (can_access_family(id));

create policy "admins manage center families" on families
  for all using (is_admin() and daycare_id = get_my_daycare_id())
  with check (is_admin() and daycare_id = get_my_daycare_id());

create policy "members read accessible family members" on family_members
  for select using (can_access_family(family_id));

create policy "admins manage family members" on family_members
  for all using (
    is_admin() and family_id in (
      select id from families where daycare_id = get_my_daycare_id()
    )
  )
  with check (
    is_admin() and family_id in (
      select id from families where daycare_id = get_my_daycare_id()
    )
  );

create policy "members read accessible family children" on family_children
  for select using (can_access_family(family_id) or can_access_child(child_id));

create policy "admins manage family children" on family_children
  for all using (
    is_admin() and family_id in (
      select id from families where daycare_id = get_my_daycare_id()
    )
  )
  with check (
    is_admin() and family_id in (
      select id from families where daycare_id = get_my_daycare_id()
    )
  );

-- Parents may see the other guardians on their own household account. Without
-- this policy nested family reads would expose membership ids but redact the
-- co-guardian's name and contact details.
create policy "family members read co-guardians" on profiles
  for select using (
    get_my_role() = 'parent'
    and role = 'parent'
    and shares_family_with(id)
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2 · Keep the shipping parent_children contract synchronized
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function sync_parent_child_family()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_daycare uuid;
  v_family uuid;
  v_last_name text;
begin
  if tg_op = 'DELETE' then
    -- Remove a guardian from a family only when they no longer share any child
    -- in that family. The family-child link stays for billing/audit history.
    delete from family_members fm
     where fm.profile_id = old.parent_id
       and fm.family_id in (
         select fc.family_id from family_children fc where fc.child_id = old.child_id
       )
       and not exists (
         select 1
           from family_children fc
           join parent_children pc on pc.child_id = fc.child_id
          where fc.family_id = fm.family_id
            and pc.parent_id = old.parent_id
       );
    return old;
  end if;

  select c.daycare_id, c.last_name
    into v_daycare, v_last_name
    from children c
   where c.id = new.child_id;

  if v_daycare is null then
    raise exception 'Child not found for family synchronization';
  end if;

  -- Prefer the child's existing account, then a family the guardian already
  -- belongs to in this center. This naturally groups siblings.
  select fc.family_id into v_family
    from family_children fc
   where fc.child_id = new.child_id
   order by fc.is_primary desc, fc.created_at
   limit 1;

  if v_family is null then
    select fm.family_id into v_family
      from family_members fm
      join families f on f.id = fm.family_id
     where fm.profile_id = new.parent_id
       and f.daycare_id = v_daycare
       and f.archived_at is null
     order by (fm.role = 'primary') desc, fm.created_at
     limit 1;
  end if;

  if v_family is null then
    insert into families (daycare_id, display_name, primary_contact_id)
    values (v_daycare, coalesce(nullif(trim(v_last_name), ''), 'Family') || ' family', new.parent_id)
    returning id into v_family;
  end if;

  insert into family_children (family_id, child_id, is_primary)
  values (v_family, new.child_id, true)
  on conflict (family_id, child_id) do nothing;

  insert into family_members (family_id, profile_id, role, relationship)
  values (
    v_family,
    new.parent_id,
    case when new.is_primary then 'primary' else 'guardian' end,
    new.relationship
  )
  on conflict (family_id, profile_id) do update
    set role = case
                 when excluded.role = 'primary' then 'primary'
                 else family_members.role
               end,
        relationship = coalesce(excluded.relationship, family_members.relationship);

  if new.is_primary then
    update families
       set primary_contact_id = new.parent_id,
           billing_email = coalesce(families.billing_email, p.email),
           billing_phone = coalesce(families.billing_phone, nullif(p.phone, ''))
      from profiles p
     where families.id = v_family and p.id = new.parent_id;
  end if;

  return new;
end;
$$;

drop trigger if exists parent_children_sync_family on parent_children;
create trigger parent_children_sync_family
  after insert or update of relationship, is_primary or delete on parent_children
  for each row execute function sync_parent_child_family();

-- Backfill existing databases in a deterministic order. Primary guardians run
-- first, so a guardian shared by siblings produces one household.
do $$
declare
  r record;
  v_family uuid;
begin
  for r in
    select pc.*, c.daycare_id, c.last_name
      from parent_children pc
      join children c on c.id = pc.child_id
     order by pc.is_primary desc, pc.created_at, pc.parent_id, pc.child_id
  loop
    select fc.family_id into v_family
      from family_children fc
     where fc.child_id = r.child_id
     order by fc.is_primary desc, fc.created_at
     limit 1;

    if v_family is null then
      select fm.family_id into v_family
        from family_members fm
        join families f on f.id = fm.family_id
       where fm.profile_id = r.parent_id
         and f.daycare_id = r.daycare_id
         and f.archived_at is null
       order by (fm.role = 'primary') desc, fm.created_at
       limit 1;
    end if;

    if v_family is null then
      insert into families (
        daycare_id, display_name, primary_contact_id, billing_email, billing_phone
      )
      select r.daycare_id,
             coalesce(nullif(trim(r.last_name), ''), 'Family') || ' family',
             r.parent_id,
             p.email,
             nullif(p.phone, '')
        from profiles p where p.id = r.parent_id
      returning id into v_family;
    end if;

    insert into family_children (family_id, child_id, is_primary)
    values (v_family, r.child_id, true)
    on conflict (family_id, child_id) do nothing;

    insert into family_members (family_id, profile_id, role, relationship)
    values (
      v_family,
      r.parent_id,
      case when r.is_primary then 'primary' else 'guardian' end,
      r.relationship
    )
    on conflict (family_id, profile_id) do update
      set role = case
                   when excluded.role = 'primary' then 'primary'
                   else family_members.role
                 end,
          relationship = coalesce(excluded.relationship, family_members.relationship);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3 · Household identity on messages and billing
-- ─────────────────────────────────────────────────────────────────────────────

alter table conversations
  add column family_id uuid references families(id) on delete set null;
create index conversations_family_idx on conversations (family_id, last_message_at desc)
  where archived_at is null;

update conversations conv
   set family_id = (
     select fc.family_id
       from family_children fc
      where fc.child_id = conv.child_id
      order by fc.is_primary desc, fc.created_at
      limit 1
   )
 where conv.family_id is null
   and conv.child_id is not null;

alter table invoices
  add column family_id uuid references families(id) on delete set null;
alter table payments
  add column family_id uuid references families(id) on delete set null;
alter table statements
  add column family_id uuid references families(id) on delete set null;

create index invoices_family_status_idx on invoices (family_id, status);
create index payments_family_idx on payments (family_id, paid_at desc);
create index statements_family_idx on statements (family_id, period_start desc);

update invoices i
   set family_id = (
     select fc.family_id
       from family_children fc
      where fc.child_id = i.child_id
      order by fc.is_primary desc, fc.created_at
      limit 1
   )
 where i.family_id is null
   and i.child_id is not null;

update invoices i
   set family_id = (
     select fm.family_id
       from family_members fm
       join families f on f.id = fm.family_id
      where fm.profile_id = i.billed_to
        and f.daycare_id = i.daycare_id
      order by (fm.role = 'primary') desc, fm.created_at
      limit 1
   )
 where i.family_id is null
   and i.billed_to is not null;

update payments p
   set family_id = i.family_id
  from invoices i
 where i.id = p.invoice_id and p.family_id is null;

update statements s
   set family_id = (
     select fc.family_id
       from family_children fc
      where fc.child_id = s.child_id
      order by fc.is_primary desc, fc.created_at
      limit 1
   )
 where s.family_id is null
   and s.child_id is not null;

-- Parent reads now follow the family account while billed_to/child access stays
-- as a compatibility fallback during migration.
drop policy if exists "parents read own invoices" on invoices;
create policy "parents read family invoices" on invoices
  for select using (
    billed_to = auth.uid()
    or (family_id is not null and family_id in (select my_family_ids()))
  );

drop policy if exists "parents read own invoice lines" on invoice_lines;
create policy "parents read family invoice lines" on invoice_lines
  for select using (
    invoice_id in (
      select id from invoices
       where billed_to = auth.uid()
          or (family_id is not null and family_id in (select my_family_ids()))
    )
  );

drop policy if exists "parents read own payments" on payments;
create policy "parents read family payments" on payments
  for select using (
    paid_by = auth.uid()
    or (family_id is not null and family_id in (select my_family_ids()))
  );

drop policy if exists "parents read own child statements" on statements;
create policy "parents read family statements" on statements
  for select using (
    child_id in (select my_child_ids())
    or (family_id is not null and family_id in (select my_family_ids()))
  );

drop policy if exists "read conversations by child access" on conversations;
create policy "read conversations by family or child access" on conversations
  for select using (
    (child_id is not null and can_access_child(child_id))
    or (child_id is null and family_id is not null and can_message_family(family_id))
    or (family_id is null and child_id is null and is_staff() and daycare_id = get_my_daycare_id())
  );

drop policy if exists "participants create conversations" on conversations;
create policy "participants create family conversations" on conversations
  for insert with check (
    (child_id is not null and can_access_child(child_id))
    or (child_id is null and family_id is not null and can_message_family(family_id))
    or (family_id is null and child_id is null and is_staff() and daycare_id = get_my_daycare_id())
  );

-- Derive household identity for every new child-keyed conversation, including
-- current mobile inserts that know nothing about families yet.
create or replace function conversations_assign_family()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.family_id is null and new.child_id is not null then
    select fc.family_id into new.family_id
      from family_children fc
     where fc.child_id = new.child_id
     order by fc.is_primary desc, fc.created_at
     limit 1;
  end if;

  if new.family_id is not null and not exists (
    select 1 from families f
     where f.id = new.family_id and f.daycare_id = new.daycare_id
  ) then
    raise exception 'Conversation family must belong to the same center';
  end if;

  if new.family_id is not null and new.child_id is not null and not exists (
    select 1 from family_children fc
     where fc.family_id = new.family_id and fc.child_id = new.child_id
  ) then
    raise exception 'Conversation child is not in the selected family';
  end if;

  return new;
end;
$$;

create trigger conversations_assign_family
  before insert or update of child_id, family_id on conversations
  for each row execute function conversations_assign_family();

-- Inbox stays one row per current child-keyed conversation, but now carries a
-- stable household label and sibling count. A later UI slice can merge/create
-- true household-wide threads without another schema migration.
drop function if exists get_inbox_threads();
create function get_inbox_threads()
returns table (
  conversation_id uuid,
  family_id uuid,
  family_name text,
  family_child_count bigint,
  child_id uuid,
  child_first_name text,
  child_last_name text,
  room_name text,
  last_message_at timestamptz,
  last_message_body text,
  last_message_from_staff boolean,
  unread_count bigint
)
language sql security definer stable
set search_path = public
as $$
  select conv.id,
         f.id,
         coalesce(f.display_name, c.last_name || ' family'),
         coalesce((select count(*) from family_children fc where fc.family_id = f.id), 1),
         c.id,
         c.first_name,
         c.last_name,
         cl.name,
         conv.last_message_at,
         lm.body,
         coalesce(lp.role in ('owner_admin', 'admin', 'educator'), false),
         (select count(*) from messages m
           join profiles sp on sp.id = m.sender_id
          where m.conversation_id = conv.id
            and m.read_at is null
            and sp.role = 'parent')
    from conversations conv
    join children c on c.id = conv.child_id and c.archived_at is null
    left join families f on f.id = conv.family_id
    left join classrooms cl on cl.id = c.classroom_id
    left join lateral (
      select m.body, m.sender_id from messages m
       where m.conversation_id = conv.id
       order by m.created_at desc limit 1
    ) lm on true
    left join profiles lp on lp.id = lm.sender_id
   where conv.daycare_id = get_my_daycare_id()
     and conv.archived_at is null
     and is_staff()
   order by conv.last_message_at desc
$$;

-- Preserve the existing RPC signature. It now derives and stores family_id.
create or replace function create_invoice(
  p_child_id uuid,
  p_billed_to uuid,
  p_due_on date,
  p_lines jsonb
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_daycare uuid;
  v_family uuid;
  v_year text;
  v_number text;
  v_invoice uuid;
  v_line jsonb;
  v_total int := 0;
begin
  if not is_admin() then
    raise exception 'Only admins can create invoices';
  end if;
  v_daycare := get_my_daycare_id();
  v_year := to_char(center_today(), 'YYYY');

  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'An invoice needs at least one line';
  end if;

  if p_child_id is not null then
    select fc.family_id into v_family
      from family_children fc
      join families f on f.id = fc.family_id
     where fc.child_id = p_child_id and f.daycare_id = v_daycare
     order by fc.is_primary desc, fc.created_at
     limit 1;
  end if;

  if v_family is null and p_billed_to is not null then
    select fm.family_id into v_family
      from family_members fm
      join families f on f.id = fm.family_id
     where fm.profile_id = p_billed_to and f.daycare_id = v_daycare
     order by (fm.role = 'primary') desc, fm.created_at
     limit 1;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_daycare::text || ':inv:' || v_year, 0));

  select 'INV-' || v_year || '-' || lpad((count(*) + 1)::text, 3, '0')
    into v_number
    from invoices
   where daycare_id = v_daycare and number like 'INV-' || v_year || '-%';

  insert into invoices (
    daycare_id, family_id, child_id, billed_to, number, status,
    issued_on, due_on, subtotal_cents, total_cents
  )
  values (
    v_daycare, v_family, p_child_id, p_billed_to, v_number, 'open',
    center_today(), p_due_on, 0, 0
  )
  returning id into v_invoice;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into invoice_lines (
      daycare_id, invoice_id, description, quantity, unit_amount_cents, amount_cents
    )
    values (
      v_daycare,
      v_invoice,
      v_line->>'description',
      coalesce((v_line->>'quantity')::numeric, 1),
      coalesce((v_line->>'unit_amount_cents')::int, 0),
      round(coalesce((v_line->>'quantity')::numeric, 1)
            * coalesce((v_line->>'unit_amount_cents')::int, 0))::int
    );
    v_total := v_total + round(
      coalesce((v_line->>'quantity')::numeric, 1)
      * coalesce((v_line->>'unit_amount_cents')::int, 0)
    )::int;
  end loop;

  update invoices
     set subtotal_cents = v_total, total_cents = v_total
   where id = v_invoice;

  return v_invoice;
end;
$$;

create or replace function record_invoice_payment(
  p_invoice_id uuid,
  p_amount_cents int,
  p_method text default 'cash'
)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_invoice invoices%rowtype;
  v_paid int;
begin
  if not is_admin() then
    raise exception 'Only admins can record payments';
  end if;

  select * into v_invoice from invoices
   where id = p_invoice_id and daycare_id = get_my_daycare_id();
  if v_invoice.id is null then
    raise exception 'Invoice not found';
  end if;
  if p_amount_cents <= 0 then
    raise exception 'Amount must be positive';
  end if;

  insert into payments (
    daycare_id, family_id, invoice_id, paid_by, amount_cents,
    currency, method, status
  )
  values (
    v_invoice.daycare_id, v_invoice.family_id, v_invoice.id,
    v_invoice.billed_to, p_amount_cents, v_invoice.currency, p_method, 'succeeded'
  );

  select coalesce(sum(amount_cents), 0) into v_paid
    from payments
   where invoice_id = v_invoice.id and status = 'succeeded';

  if v_paid >= v_invoice.total_cents then
    update invoices set status = 'paid' where id = v_invoice.id;
    return 'paid';
  end if;
  return v_invoice.status;
end;
$$;

drop trigger if exists audit_families on families;
create trigger audit_families
  after insert or update on families
  for each row execute function audit_write();
