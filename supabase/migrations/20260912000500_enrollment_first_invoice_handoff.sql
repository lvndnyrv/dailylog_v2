-- Group 2f -> Billing: create tuition invoices from the durable enrollment rate
-- and apply enrollment payments exactly once. A prepaid first month settles the
-- first invoice; any remaining deposit credit carries to the next invoice.

create table public.enrollment_billing_schedules (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references public.daycares(id) on delete cascade,
  enrollment_id uuid not null unique references public.enrollments(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  family_id uuid references public.families(id) on delete set null,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'CAD' check (currency ~ '^[A-Z]{3}$'),
  cadence text not null default 'monthly' check (cadence = 'monthly'),
  anchor_day integer not null check (anchor_day between 1 and 31),
  starts_on date not null,
  next_invoice_on date not null,
  source_payment_id uuid references public.enrollment_offer_payments(id) on delete set null,
  remaining_credit_cents integer not null default 0 check (remaining_credit_cents >= 0),
  last_invoice_id uuid references public.invoices(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'active', 'paused', 'ended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.invoices
  add column if not exists enrollment_billing_schedule_id uuid
    references public.enrollment_billing_schedules(id) on delete set null,
  add column if not exists service_period_start date,
  add column if not exists service_period_end date;

create unique index enrollment_billing_invoice_period_idx
  on public.invoices(enrollment_billing_schedule_id, service_period_start)
  where enrollment_billing_schedule_id is not null and service_period_start is not null;
create unique index payments_enrollment_credit_idx
  on public.payments(external_ref)
  where external_ref like 'enrollment-credit:%';
create index enrollment_billing_schedules_due_idx
  on public.enrollment_billing_schedules(daycare_id, next_invoice_on)
  where status in ('pending', 'active');

create trigger enrollment_billing_schedules_updated_at
  before update on public.enrollment_billing_schedules
  for each row execute function public.update_updated_at();

alter table public.enrollment_billing_schedules enable row level security;
create policy "billing staff read enrollment schedules"
  on public.enrollment_billing_schedules for select
  using (
    public.is_staff()
    and public.has_permission('billing', 'view')
    and daycare_id = public.get_my_daycare_id()
  );
create policy "billing staff manage enrollment schedules"
  on public.enrollment_billing_schedules for all
  using (
    public.is_staff()
    and public.has_permission('billing', 'edit')
    and daycare_id = public.get_my_daycare_id()
  )
  with check (
    public.is_staff()
    and public.has_permission('billing', 'edit')
    and daycare_id = public.get_my_daycare_id()
  );
create policy "parents read family enrollment schedules"
  on public.enrollment_billing_schedules for select
  using (family_id in (select public.my_family_ids()));

create trigger audit_enrollment_billing_schedules
  after insert or update or delete on public.enrollment_billing_schedules
  for each row execute function public.audit_write();

create or replace function public._next_monthly_invoice_date(
  p_current date,
  p_anchor_day integer
)
returns date
language sql
immutable
set search_path = public
as $$
  with next_month as (
    select (date_trunc('month', p_current::timestamp) + interval '1 month')::date as first_day
  )
  select make_date(
    extract(year from first_day)::integer,
    extract(month from first_day)::integer,
    least(
      greatest(coalesce(p_anchor_day, 1), 1),
      extract(day from (first_day + interval '1 month - 1 day'))::integer
    )
  )
  from next_month
$$;

create or replace function public.sync_enrollment_billing_schedule()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family_id uuid;
  v_payment public.enrollment_offer_payments%rowtype;
  v_existing public.enrollment_billing_schedules%rowtype;
  v_schedule_id uuid;
begin
  select * into v_existing
    from public.enrollment_billing_schedules schedule
   where schedule.enrollment_id = new.id
   for update;

  if new.stage <> 'enrolled' or new.child_id is null or new.desired_start_date is null
     or coalesce(new.offer_tuition_cents, 0) <= 0 then
    if v_existing.id is not null and new.stage <> 'enrolled' then
      update public.enrollment_billing_schedules
         set status = 'ended'
       where id = v_existing.id and status <> 'ended';
    end if;
    return new;
  end if;

  select family_child.family_id into v_family_id
    from public.family_children family_child
    join public.families family on family.id = family_child.family_id
   where family_child.child_id = new.child_id
     and family.daycare_id = new.daycare_id
     and family.archived_at is null
   order by family_child.is_primary desc, family_child.created_at
   limit 1;

  if new.deposit_payment_id is not null then
    select * into v_payment
      from public.enrollment_offer_payments payment
     where payment.id = new.deposit_payment_id
       and payment.enrollment_id = new.id
       and payment.status = 'succeeded';
  end if;
  if v_payment.id is null then
    select * into v_payment
      from public.enrollment_offer_payments payment
     where payment.enrollment_id = new.id
       and payment.status = 'succeeded'
     order by payment.settled_at desc nulls last, payment.created_at desc
     limit 1;
  end if;

  insert into public.enrollment_billing_schedules (
    daycare_id, enrollment_id, child_id, family_id, amount_cents, currency,
    anchor_day, starts_on, next_invoice_on, source_payment_id,
    remaining_credit_cents, status
  ) values (
    new.daycare_id, new.id, new.child_id, v_family_id, new.offer_tuition_cents,
    coalesce(v_payment.currency, 'CAD'), extract(day from new.desired_start_date)::integer,
    new.desired_start_date, new.desired_start_date, v_payment.id,
    coalesce(v_payment.amount_cents, 0),
    case when v_existing.id is not null then v_existing.status else 'pending' end
  )
  on conflict (enrollment_id) do update set
    child_id = excluded.child_id,
    family_id = coalesce(excluded.family_id, enrollment_billing_schedules.family_id),
    amount_cents = excluded.amount_cents,
    currency = excluded.currency,
    anchor_day = excluded.anchor_day,
    starts_on = excluded.starts_on,
    next_invoice_on = case
      when enrollment_billing_schedules.last_invoice_id is null then excluded.next_invoice_on
      else enrollment_billing_schedules.next_invoice_on
    end,
    source_payment_id = coalesce(excluded.source_payment_id, enrollment_billing_schedules.source_payment_id),
    remaining_credit_cents = case
      when enrollment_billing_schedules.last_invoice_id is null then excluded.remaining_credit_cents
      else enrollment_billing_schedules.remaining_credit_cents
    end,
    status = case
      when enrollment_billing_schedules.status = 'ended' then 'ended'
      else enrollment_billing_schedules.status
    end
  returning id into v_schedule_id;

  update public.enrollments
     set onboarding_steps = coalesce(onboarding_steps, '{}'::jsonb)
       || jsonb_build_object(
         'billing_schedule_id', v_schedule_id,
         'billing_next_invoice_on', coalesce(v_existing.next_invoice_on, new.desired_start_date)
       )
   where id = new.id;
  return new;
end;
$$;

drop trigger if exists sync_enrollment_billing_schedule on public.enrollments;
create trigger sync_enrollment_billing_schedule
  after insert or update of stage, child_id, desired_start_date, offer_tuition_cents,
    deposit_payment_id, parent_account_linked_at
  on public.enrollments
  for each row execute function public.sync_enrollment_billing_schedule();

create or replace function public.process_due_enrollment_invoices(
  p_daycare_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_worker boolean := auth.role() = 'service_role'
    or (auth.uid() is null and auth.role() is null);
  v_center_id uuid;
  v_schedule public.enrollment_billing_schedules%rowtype;
  v_family public.families%rowtype;
  v_source_payment public.enrollment_offer_payments%rowtype;
  v_today date;
  v_period_start date;
  v_period_end date;
  v_year text;
  v_invoice_number text;
  v_invoice_id uuid;
  v_payment_id uuid;
  v_credit integer;
  v_due integer;
  v_created boolean;
  v_iterations integer;
  v_count integer := 0;
begin
  if not v_worker then
    if not public.is_admin() or not public.has_permission('billing', 'edit') then
      raise exception 'Administrator billing edit permission required';
    end if;
    v_center_id := public.get_my_daycare_id();
    if p_daycare_id is not null and p_daycare_id <> v_center_id then
      raise exception 'Cannot generate another center''s invoices';
    end if;
  else
    v_center_id := p_daycare_id;
  end if;

  for v_schedule in
    select schedule.*
      from public.enrollment_billing_schedules schedule
     where schedule.status in ('pending', 'active')
       and (v_center_id is null or schedule.daycare_id = v_center_id)
     order by schedule.daycare_id, schedule.next_invoice_on, schedule.id
     for update skip locked
  loop
    select (now() at time zone coalesce(daycare.timezone, 'UTC'))::date
      into v_today from public.daycares daycare where daycare.id = v_schedule.daycare_id;
    if v_schedule.next_invoice_on > v_today then continue; end if;

    if v_schedule.family_id is null then
      select family_child.family_id into v_schedule.family_id
        from public.family_children family_child
        join public.families family on family.id = family_child.family_id
       where family_child.child_id = v_schedule.child_id
         and family.daycare_id = v_schedule.daycare_id
         and family.archived_at is null
       order by family_child.is_primary desc, family_child.created_at
       limit 1;
      if v_schedule.family_id is null then continue; end if;
      update public.enrollment_billing_schedules
         set family_id = v_schedule.family_id where id = v_schedule.id;
    end if;

    select * into v_family from public.families where id = v_schedule.family_id;
    if v_family.id is null then continue; end if;
    if v_schedule.source_payment_id is not null then
      select * into v_source_payment from public.enrollment_offer_payments
       where id = v_schedule.source_payment_id and status = 'succeeded';
    end if;

    v_period_start := v_schedule.next_invoice_on;
    v_iterations := 0;
    while v_period_start <= v_today and v_iterations < 24 loop
      v_iterations := v_iterations + 1;
      v_period_end := public._next_monthly_invoice_date(v_period_start, v_schedule.anchor_day) - 1;
      v_created := false;
      v_invoice_id := null;
      v_year := to_char(v_today, 'YYYY');
      perform pg_advisory_xact_lock(hashtextextended(v_schedule.daycare_id::text || ':inv:' || v_year, 0));

      select invoice.id into v_invoice_id
        from public.invoices invoice
       where invoice.enrollment_billing_schedule_id = v_schedule.id
         and invoice.service_period_start = v_period_start;
      if v_invoice_id is null then
        select 'INV-' || v_year || '-' || lpad((count(*) + 1)::text, 3, '0')
          into v_invoice_number
          from public.invoices invoice
         where invoice.daycare_id = v_schedule.daycare_id
           and invoice.number like 'INV-' || v_year || '-%';
        insert into public.invoices (
          daycare_id, family_id, child_id, billed_to, number, status,
          issued_on, due_on, subtotal_cents, total_cents, currency,
          enrollment_billing_schedule_id, service_period_start, service_period_end
        ) values (
          v_schedule.daycare_id, v_schedule.family_id, v_schedule.child_id,
          v_family.primary_contact_id, v_invoice_number, 'open', v_today,
          greatest(v_today, v_period_start) + 7, v_schedule.amount_cents,
          v_schedule.amount_cents, v_schedule.currency, v_schedule.id,
          v_period_start, v_period_end
        ) returning id into v_invoice_id;
        insert into public.invoice_lines (
          daycare_id, invoice_id, description, quantity, unit_amount_cents, amount_cents
        ) values (
          v_schedule.daycare_id, v_invoice_id,
          'Tuition · ' || to_char(v_period_start, 'FMMonth YYYY'),
          1, v_schedule.amount_cents, v_schedule.amount_cents
        );
        v_created := true;
      end if;

      v_credit := least(v_schedule.remaining_credit_cents, v_schedule.amount_cents);
      if v_credit > 0 then
        insert into public.payments (
          daycare_id, family_id, invoice_id, paid_by, amount_cents, currency,
          method, status, external_ref, paid_at
        ) values (
          v_schedule.daycare_id, v_schedule.family_id, v_invoice_id,
          v_family.primary_contact_id, v_credit, v_schedule.currency, 'card',
          'succeeded', 'enrollment-credit:' || v_schedule.id || ':' || v_period_start,
          coalesce(v_source_payment.settled_at, now())
        ) on conflict (external_ref) where external_ref like 'enrollment-credit:%'
        do nothing returning id into v_payment_id;
        if v_payment_id is not null then
          v_schedule.remaining_credit_cents := v_schedule.remaining_credit_cents - v_credit;
        end if;
      end if;

      select greatest(invoice.total_cents - coalesce(sum(payment.amount_cents)
        filter (where payment.status = 'succeeded'), 0), 0)::integer
        into v_due
        from public.invoices invoice
        left join public.payments payment on payment.invoice_id = invoice.id
       where invoice.id = v_invoice_id
       group by invoice.total_cents;

      if v_created and v_due > 0 then
        insert into public.notifications(daycare_id, profile_id, kind, title, body, payload)
        select v_schedule.daycare_id, member.profile_id, 'invoice',
               'Tuition invoice available',
               format('%s is due by %s.', to_char(v_due / 100.0, 'FML999G999G990D00'), to_char(greatest(v_today, v_period_start) + 7, 'FMMonth FMDD')),
               jsonb_build_object('type', 'billing_invoice', 'invoiceId', v_invoice_id)
          from public.family_members member
         where member.family_id = v_schedule.family_id and member.receives_billing
           and not exists (
             select 1 from public.notifications notice
              where notice.profile_id = member.profile_id
                and notice.payload->>'invoiceId' = v_invoice_id::text
           );
        insert into public.notification_outbox(
          daycare_id, recipient_id, channel, kind, title, body, payload, dedupe_key
        )
        select v_schedule.daycare_id, member.profile_id, 'push', 'invoice',
               'Tuition invoice available',
               format('%s is due.', to_char(v_due / 100.0, 'FML999G999G990D00')),
               jsonb_build_object('type', 'billing_invoice', 'invoiceId', v_invoice_id),
               'enrollment-invoice:' || v_invoice_id
          from public.family_members member
         where member.family_id = v_schedule.family_id and member.receives_billing
        on conflict do nothing;
        if nullif(btrim(coalesce(v_family.billing_email, '')), '') is not null then
          insert into public.notification_outbox(
            daycare_id, recipient_email, channel, kind, title, body, payload, dedupe_key
          ) values (
            v_schedule.daycare_id, lower(btrim(v_family.billing_email)), 'email', 'invoice',
            'Tuition invoice available',
            format('%s is due by %s.', to_char(v_due / 100.0, 'FML999G999G990D00'), to_char(greatest(v_today, v_period_start) + 7, 'FMMonth FMDD, YYYY')),
            jsonb_build_object('type', 'billing_invoice', 'invoiceId', v_invoice_id),
            'enrollment-invoice:' || v_invoice_id
          ) on conflict do nothing;
        end if;
      end if;

      v_schedule.last_invoice_id := v_invoice_id;
      v_schedule.next_invoice_on := public._next_monthly_invoice_date(v_period_start, v_schedule.anchor_day);
      v_schedule.status := 'active';
      update public.enrollment_billing_schedules
         set last_invoice_id = v_schedule.last_invoice_id,
             next_invoice_on = v_schedule.next_invoice_on,
             remaining_credit_cents = v_schedule.remaining_credit_cents,
             status = 'active'
       where id = v_schedule.id;
      update public.enrollments
         set onboarding_steps = coalesce(onboarding_steps, '{}'::jsonb)
           || jsonb_build_object(
             'billing_status', 'effective',
             'first_invoice_id', coalesce(onboarding_steps->>'first_invoice_id', v_invoice_id::text),
             'billing_next_invoice_on', v_schedule.next_invoice_on,
             'billing_credit_remaining_cents', v_schedule.remaining_credit_cents
           )
       where id = v_schedule.enrollment_id;
      v_period_start := v_schedule.next_invoice_on;
      if v_created then v_count := v_count + 1; end if;
    end loop;
  end loop;
  return v_count;
end;
$$;

revoke all on function public._next_monthly_invoice_date(date, integer)
  from public, anon;
revoke all on function public.sync_enrollment_billing_schedule()
  from public, anon, authenticated;
revoke all on function public.process_due_enrollment_invoices(uuid)
  from public, anon;
grant execute on function public._next_monthly_invoice_date(date, integer)
  to authenticated, service_role;
grant execute on function public.process_due_enrollment_invoices(uuid)
  to authenticated, service_role;

update public.enrollments enrollment
   set offer_tuition_cents = enrollment.offer_tuition_cents
 where enrollment.stage = 'enrolled'
   and enrollment.child_id is not null
   and enrollment.desired_start_date is not null
   and coalesce(enrollment.offer_tuition_cents, 0) > 0;

do $$
declare
  v_job bigint;
begin
  select jobid into v_job from cron.job
   where jobname = 'dailylog-enrollment-invoices';
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule(
    'dailylog-enrollment-invoices',
    '25 * * * *',
    'select public.process_due_enrollment_invoices();'
  );
end;
$$;

notify pgrst, 'reload schema';
