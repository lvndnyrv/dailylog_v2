-- ============================================================================
-- DailyLog — core hardening: timezones, kiosk PINs, invoice numbering,
-- audit-log writers, nav badges
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1 · Center-local dates. current_date is the SERVER'S (UTC) date: a Toronto
-- check-in after 8 PM was landing on tomorrow's attendance record. Every
-- day-keyed RPC now resolves "today" in the center's timezone.
-- ─────────────────────────────────────────────────────────────────────────────

alter table daycares add column if not exists timezone text not null default 'America/Toronto';

create or replace function center_today()
returns date
language sql security definer stable
set search_path = public
as $$
  select (now() at time zone coalesce(
    (select timezone from daycares where id = get_my_daycare_id()), 'UTC'))::date
$$;

create or replace function get_rooms_live_status()
returns table (
  id uuid, name text, age_group text, min_age_months int, max_age_months int,
  capacity int, ratio_children_per_educator int,
  enrolled_count bigint, present_count bigint, last_log_at timestamptz, educators jsonb
)
language sql security definer stable
set search_path = public
as $$
  select cl.id, cl.name, cl.age_group, cl.min_age_months, cl.max_age_months,
         cl.capacity, cl.ratio_children_per_educator,
         (select count(*) from children c
           where c.classroom_id = cl.id and c.archived_at is null),
         (select count(*) from attendance_records ar
           join children c on c.id = ar.child_id
          where c.classroom_id = cl.id
            and ar.date = center_today()
            and ar.checked_in_at is not null
            and ar.checked_out_at is null),
         (select max(coalesce(dl.updated_at, dl.created_at))
            from daily_logs dl
            join children c on c.id = dl.child_id
           where c.classroom_id = cl.id and dl.log_date = center_today()),
         coalesce(
           (select jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name)
                             order by p.full_name)
              from profiles p
             where p.role = 'educator'
               and p.archived_at is null
               and (p.classroom_id = cl.id
                    or exists (select 1 from educator_classrooms ec
                                where ec.classroom_id = cl.id and ec.educator_id = p.id))),
           '[]'::jsonb)
  from classrooms cl
  where cl.daycare_id = get_my_daycare_id()
    and cl.archived_at is null
    and is_staff()
  order by cl.min_age_months nulls last, cl.name
$$;

create or replace function get_attendance_week()
returns table (day date, present_count bigint, absent_count bigint)
language sql security definer stable
set search_path = public
as $$
  select d::date,
         (select count(*) from attendance_records ar
           where ar.daycare_id = get_my_daycare_id()
             and ar.date = d::date and ar.checked_in_at is not null),
         (select count(*) from attendance_records ar
           where ar.daycare_id = get_my_daycare_id()
             and ar.date = d::date and ar.status in ('absent', 'excused'))
  from generate_series(center_today() - 6, center_today(), '1 day') d
  where is_staff()
$$;

create or replace function kiosk_lookup_pin(p_pin text)
returns table (
  pickup_name text, child_id uuid, first_name text, last_name text,
  room_name text, checked_in_at timestamptz, checked_out_at timestamptz
)
language sql security definer stable
set search_path = public
as $$
  select cp.full_name, c.id, c.first_name, c.last_name, cl.name,
         ar.checked_in_at, ar.checked_out_at
  from child_pickups cp
  join children c on c.id = cp.child_id and c.archived_at is null
  left join classrooms cl on cl.id = c.classroom_id
  left join attendance_records ar on ar.child_id = c.id and ar.date = center_today()
  where cp.pin = p_pin
    and cp.archived_at is null
    and cp.daycare_id = get_my_daycare_id()
    and is_staff()
$$;

create or replace function kiosk_check(p_child_id uuid, p_pin text)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_pickup child_pickups%rowtype;
  v_record attendance_records%rowtype;
  v_today date := center_today();
begin
  if not is_staff() then
    raise exception 'Kiosk must be signed in as staff';
  end if;

  select * into v_pickup
  from child_pickups
  where pin = p_pin and child_id = p_child_id and archived_at is null
    and daycare_id = get_my_daycare_id();
  if v_pickup.id is null then
    raise exception 'PIN does not match this child';
  end if;

  select * into v_record
  from attendance_records
  where child_id = p_child_id and date = v_today;

  if v_record.id is null or v_record.checked_in_at is null then
    insert into attendance_records (daycare_id, child_id, date, checked_in_at,
                                    method, status, dropped_off_by)
    values (v_pickup.daycare_id, p_child_id, v_today, now(),
            'kiosk', 'present', v_pickup.full_name)
    on conflict (child_id, date) do update
      set checked_in_at = now(), method = 'kiosk', status = 'present',
          dropped_off_by = v_pickup.full_name,
          checked_out_at = null, checked_out_by = null;
    return 'checked_in';
  end if;

  if v_record.checked_out_at is null then
    update attendance_records
       set checked_out_at = now(), picked_up_by = v_pickup.full_name,
           method = 'kiosk'
     where id = v_record.id;
    return 'checked_out';
  end if;

  update attendance_records
     set checked_in_at = now(), checked_out_at = null,
         dropped_off_by = v_pickup.full_name, method = 'kiosk'
   where id = v_record.id;
  return 'checked_in';
end;
$$;

create or replace function get_billing_summary()
returns table (
  collected_month_cents bigint, expected_month_cents bigint,
  outstanding_cents bigint, overdue_count bigint, open_count bigint
)
language sql security definer stable
set search_path = public
as $$
  select
    (select coalesce(sum(p.amount_cents), 0) from payments p
      where p.daycare_id = get_my_daycare_id() and p.status = 'succeeded'
        and date_trunc('month', p.paid_at) = date_trunc('month', now())),
    (select coalesce(sum(i.total_cents), 0) from invoices i
      where i.daycare_id = get_my_daycare_id() and i.status <> 'void'
        and date_trunc('month', i.issued_on) = date_trunc('month', center_today()::timestamp)),
    (select coalesce(sum(i.total_cents - coalesce(paid.cents, 0)), 0)
       from invoices i
       left join lateral (
         select sum(amount_cents) as cents from payments
         where invoice_id = i.id and status = 'succeeded'
       ) paid on true
      where i.daycare_id = get_my_daycare_id() and i.status = 'open'),
    (select count(*) from invoices i
      where i.daycare_id = get_my_daycare_id() and i.status = 'open'
        and i.due_on < center_today()),
    (select count(*) from invoices i
      where i.daycare_id = get_my_daycare_id() and i.status = 'open')
  where is_admin()
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2 · Kiosk PIN integrity. Two families sharing a PIN would see each other's
-- children on the door tablet. PINs are now unique per center and generated
-- server-side.
-- ─────────────────────────────────────────────────────────────────────────────

create unique index if not exists child_pickups_daycare_pin_unique
  on child_pickups (daycare_id, pin) where archived_at is null;

create or replace function create_pickup(
  p_child_id uuid,
  p_full_name text,
  p_relationship text default null,
  p_phone text default null
)
returns text  -- the generated PIN
language plpgsql security definer
set search_path = public
as $$
declare
  v_daycare uuid;
  v_pin text;
  v_attempts int := 0;
begin
  if not can_write_child(p_child_id) then
    raise exception 'No access to this child';
  end if;
  if coalesce(trim(p_full_name), '') = '' then
    raise exception 'Name is required';
  end if;

  select daycare_id into v_daycare from children where id = p_child_id;

  loop
    v_attempts := v_attempts + 1;
    if v_attempts > 25 then
      raise exception 'Could not allocate a unique PIN — try again';
    end if;
    v_pin := lpad((1000 + floor(random() * 9000))::int::text, 4, '0');
    begin
      insert into child_pickups (daycare_id, child_id, full_name, relationship,
                                 phone, pin, created_by)
      values (v_daycare, p_child_id, trim(p_full_name),
              nullif(trim(p_relationship), ''), nullif(trim(p_phone), ''),
              v_pin, auth.uid());
      return v_pin;
    exception when unique_violation then
      -- PIN taken in this center — roll the dice again
    end;
  end loop;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3 · Invoice numbering under concurrency. count(*)+1 hands two concurrent
-- admins the same number; an advisory lock serializes per center-year.
-- ─────────────────────────────────────────────────────────────────────────────

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

  perform pg_advisory_xact_lock(hashtextextended(v_daycare::text || ':inv:' || v_year, 0));

  select 'INV-' || v_year || '-' || lpad((count(*) + 1)::text, 3, '0')
    into v_number
  from invoices
  where daycare_id = v_daycare and number like 'INV-' || v_year || '-%';

  insert into invoices (daycare_id, child_id, billed_to, number, status,
                        issued_on, due_on, subtotal_cents, total_cents)
  values (v_daycare, p_child_id, p_billed_to, v_number, 'open',
          center_today(), p_due_on, 0, 0)
  returning id into v_invoice;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into invoice_lines (daycare_id, invoice_id, description, quantity,
                               unit_amount_cents, amount_cents)
    values (
      v_daycare, v_invoice,
      v_line->>'description',
      coalesce((v_line->>'quantity')::numeric, 1),
      coalesce((v_line->>'unit_amount_cents')::int, 0),
      round(coalesce((v_line->>'quantity')::numeric, 1)
            * coalesce((v_line->>'unit_amount_cents')::int, 0))::int
    );
    v_total := v_total + round(coalesce((v_line->>'quantity')::numeric, 1)
                               * coalesce((v_line->>'unit_amount_cents')::int, 0))::int;
  end loop;

  update invoices set subtotal_cents = v_total, total_cents = v_total
   where id = v_invoice;

  return v_invoice;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4 · Audit-log writers. The table existed with nothing writing to it. A
-- definer trigger records the transitions an inspector (or a dispute) asks
-- about; attached only where changes are sensitive, with WHEN guards so
-- routine noise stays out.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function audit_write()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_daycare uuid;
begin
  v_daycare := coalesce(
    (to_jsonb(new)->>'daycare_id')::uuid,
    (to_jsonb(old)->>'daycare_id')::uuid
  );
  if v_daycare is null then
    return coalesce(new, old);  -- e.g. a parent profile with no center yet
  end if;

  insert into audit_log (daycare_id, actor_id, action, entity_type, entity_id, before, after)
  values (
    v_daycare,
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    coalesce((to_jsonb(new)->>'id')::uuid, (to_jsonb(old)->>'id')::uuid),
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists audit_attendance on attendance_records;
create trigger audit_attendance
  after update on attendance_records
  for each row
  when (old.checked_in_at is distinct from new.checked_in_at
     or old.checked_out_at is distinct from new.checked_out_at
     or old.status is distinct from new.status)
  execute function audit_write();

drop trigger if exists audit_invoices on invoices;
create trigger audit_invoices
  after insert or update on invoices
  for each row execute function audit_write();

drop trigger if exists audit_incidents on incident_reports;
create trigger audit_incidents
  after update on incident_reports
  for each row
  when (old.status is distinct from new.status)
  execute function audit_write();

drop trigger if exists audit_profiles on profiles;
create trigger audit_profiles
  after update on profiles
  for each row
  when (old.role is distinct from new.role
     or old.daycare_id is distinct from new.daycare_id)
  execute function audit_write();

drop trigger if exists audit_children on children;
create trigger audit_children
  after update on children
  for each row
  when (old.archived_at is distinct from new.archived_at
     or old.classroom_id is distinct from new.classroom_id)
  execute function audit_write();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5 · Nav badges in one round trip (the shell was fetching the whole staff
-- list on every navigation just to count cert issues).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function get_nav_badges()
returns table (overdue_invoices bigint, cert_issues bigint)
language sql security definer stable
set search_path = public
as $$
  select
    (select count(*) from invoices i
      where i.daycare_id = get_my_daycare_id()
        and i.status = 'open' and i.due_on < center_today()),
    (select count(*) from staff_members sm
      where sm.daycare_id = get_my_daycare_id()
        and sm.archived_at is null and sm.status = 'active'
        and exists (
          select 1 from jsonb_array_elements(coalesce(sm.certifications, '[]'::jsonb)) cert
          where (cert->>'expires_on') is not null
            and (cert->>'expires_on')::date <= center_today() + 60))
  where is_staff()
$$;
